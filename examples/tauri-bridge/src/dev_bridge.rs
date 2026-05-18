use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Response, Server};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

/// Bridge protocol version exposed via `GET /version`. Bumped whenever the
/// HTTP surface changes shape so CLI clients can feature-detect.
pub const BRIDGE_VERSION: &str = "0.7.0";

#[derive(Deserialize)]
struct EvalRequest {
    js: String,
    token: String,
    #[serde(default)]
    window: Option<String>,
}

#[derive(Deserialize)]
struct LogRequest {
    token: String,
}

#[derive(Serialize)]
struct EvalResponse {
    result: serde_json::Value,
}

#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub timestamp: u64,
    pub level: String,
    pub target: String,
    pub message: String,
    pub source: String,
}

#[derive(Serialize)]
struct LogResponse {
    entries: Vec<LogEntry>,
}

#[derive(Deserialize)]
struct DescribeRequest {
    token: String,
}

#[derive(Serialize, Default)]
struct DescribeResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    windows: Option<Vec<String>>,
    capabilities: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    surfaces: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    exports: Option<HashMap<String, String>>,
}

#[derive(Serialize)]
struct VersionResponse {
    version: String,
    endpoints: Vec<String>,
}

#[derive(Deserialize)]
struct AuthedRequest {
    token: String,
}

#[derive(Serialize, Clone)]
struct SidecarSummary {
    name: String,
    pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    exe: Option<String>,
    args: Vec<String>,
    alive: Option<bool>,
}

#[derive(Serialize)]
struct ProcessResponse {
    tauri: TauriProcessInfo,
    sidecars: Vec<SidecarSummary>,
}

#[derive(Serialize)]
struct TauriProcessInfo {
    pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    exe: Option<String>,
    args: Vec<String>,
    uptime_ms: u64,
}

#[derive(Serialize, Clone)]
struct CapabilityEntry {
    identifier: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    windows: Vec<String>,
    permissions: Vec<String>,
}

#[derive(Serialize)]
struct CapabilitiesResponse {
    /// Capabilities as declared in tauri.conf.json (best-effort: tauri 2 stores
    /// these as either bare strings or inline objects; we surface both shapes).
    declared: Vec<CapabilityEntry>,
    /// Window labels currently registered with Tauri.
    windows: Vec<String>,
}

#[derive(Serialize)]
struct DevtoolsResponse {
    platform: String,
    inspectable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    hint: String,
}

#[derive(Serialize)]
struct HealthResponse {
    uptime_ms: u64,
    webview_ready: bool,
    sidecars_alive: bool,
    sidecars: Vec<SidecarSummary>,
}

#[derive(Serialize)]
struct TokenFile {
    port: u16,
    token: String,
    pid: u32,
}

/// Per-process sidecar metadata captured at spawn time. Used by `/process`
/// and `/health` so an external diagnostic tool can see the process tree
/// without scraping `ps`.
struct SidecarRecord {
    name: String,
    pid: u32,
    exe: Option<String>,
    args: Vec<String>,
}

/// Thread-safe registry of sidecars known to this bridge. Populated by
/// `spawn_sidecar_monitored` automatically; users with their own spawn flow
/// can call `register_sidecar` after spawning. Aliveness is computed at
/// request time via a cheap signal-0 check.
pub struct SidecarRegistry {
    records: Mutex<Vec<SidecarRecord>>,
}

impl SidecarRegistry {
    pub fn new() -> Self {
        Self {
            records: Mutex::new(Vec::new()),
        }
    }

    fn add(&self, record: SidecarRecord) {
        let mut recs = self.records.lock().unwrap();
        recs.push(record);
    }

    fn snapshot(&self) -> Vec<SidecarSummary> {
        let recs = self.records.lock().unwrap();
        recs.iter()
            .map(|r| SidecarSummary {
                name: r.name.clone(),
                pid: r.pid,
                exe: r.exe.clone(),
                args: r.args.clone(),
                alive: pid_alive(r.pid),
            })
            .collect()
    }
}

impl Default for SidecarRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Best-effort liveness probe for a sidecar PID. Returns `Some(true)` if the
/// process is running, `Some(false)` if it has exited, and `None` when we
/// can't determine (e.g., on Windows where we don't ship a probe in v1).
#[cfg(unix)]
fn pid_alive(pid: u32) -> Option<bool> {
    // SAFETY: libc::kill with signal 0 just checks process existence and never
    // delivers a signal. Returns 0 on success, -1 on error (e.g., ESRCH).
    let rc = unsafe { libc::kill(pid as libc::pid_t, 0) };
    Some(rc == 0)
}

#[cfg(not(unix))]
fn pid_alive(_pid: u32) -> Option<bool> {
    None
}

/// Register a sidecar process with the bridge so it shows up in `/process`
/// and `/health` responses. Callers that use `spawn_sidecar_monitored` get
/// this for free; callers who spawn their own children can register them
/// here. Idempotent in the sense that re-registering a name is allowed
/// (both entries will be reported).
pub fn register_sidecar(
    registry: &Arc<SidecarRegistry>,
    name: &str,
    pid: u32,
    exe: Option<String>,
    args: Vec<String>,
) {
    registry.add(SidecarRecord {
        name: name.to_string(),
        pid,
        exe,
        args,
    });
}

/// Ring buffer for log entries. Thread-safe, capped at 1000 entries.
pub struct LogBuffer {
    entries: Mutex<VecDeque<LogEntry>>,
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(VecDeque::new()),
        }
    }

    pub fn push(&self, entry: LogEntry) {
        let mut buf = self.entries.lock().unwrap();
        if buf.len() >= 1000 {
            buf.pop_front();
        }
        buf.push_back(entry);
    }

    pub fn drain(&self) -> Vec<LogEntry> {
        let mut buf = self.entries.lock().unwrap();
        buf.drain(..).collect()
    }
}

/// A tracing layer that captures log events into a `LogBuffer`.
struct BridgeLogLayer {
    buffer: Arc<LogBuffer>,
}

impl<S> tracing_subscriber::Layer<S> for BridgeLogLayer
where
    S: tracing::Subscriber,
{
    fn on_event(
        &self,
        event: &tracing::Event<'_>,
        _ctx: tracing_subscriber::layer::Context<'_, S>,
    ) {
        let mut visitor = MessageVisitor {
            message: String::new(),
        };
        event.record(&mut visitor);

        let entry = LogEntry {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            level: event.metadata().level().to_string().to_lowercase(),
            target: event.metadata().target().to_string(),
            message: visitor.message,
            source: "rust".to_string(),
        };

        self.buffer.push(entry);
    }
}

struct MessageVisitor {
    message: String,
}

impl tracing::field::Visit for MessageVisitor {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        if field.name() == "message" {
            self.message = format!("{:?}", value);
            // Remove surrounding quotes if present
            if self.message.starts_with('"') && self.message.ends_with('"') {
                self.message = self.message[1..self.message.len() - 1].to_string();
            }
        }
    }

    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            self.message = value.to_string();
        }
    }
}

/// Create a tracing layer that captures logs into the given buffer.
/// Use this if you already have a tracing subscriber and want to add log capture.
///
/// ```rust
/// use tracing_subscriber::layer::SubscriberExt;
/// use tracing_subscriber::util::SubscriberInitExt;
///
/// let buffer = std::sync::Arc::new(dev_bridge::LogBuffer::new());
/// tracing_subscriber::registry()
///     .with(dev_bridge::create_log_layer(buffer.clone()))
///     .with(tracing_subscriber::fmt::layer())
///     .init();
/// ```
pub fn create_log_layer(
    buffer: Arc<LogBuffer>,
) -> impl tracing_subscriber::Layer<tracing_subscriber::Registry> {
    BridgeLogLayer { buffer }
}

/// Spawn a sidecar process with monitored stdout/stderr.
/// Lines from stdout are logged as "info", lines from stderr as "warn".
/// Returns the `std::process::Child` handle. If a `SidecarRegistry` is
/// supplied (recommended), the child is also recorded for `/process` and
/// `/health` responses; pass `None` to opt out of registry tracking.
pub fn spawn_sidecar_monitored(
    name: &str,
    command: &str,
    args: &[&str],
    log_buffer: &Arc<LogBuffer>,
    registry: Option<&Arc<SidecarRegistry>>,
) -> Result<std::process::Child, String> {
    let mut child = Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar {name}: {e}"))?;

    if let Some(reg) = registry {
        reg.add(SidecarRecord {
            name: name.to_string(),
            pid: child.id(),
            exe: Some(command.to_string()),
            args: args.iter().map(|s| s.to_string()).collect(),
        });
    }

    let source = format!("sidecar:{name}");

    // Monitor stdout
    if let Some(stdout) = child.stdout.take() {
        let buffer = log_buffer.clone();
        let source = source.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                buffer.push(LogEntry {
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                    level: "info".to_string(),
                    target: "stdout".to_string(),
                    message: line,
                    source: source.clone(),
                });
            }
        });
    }

    // Monitor stderr
    if let Some(stderr) = child.stderr.take() {
        let buffer = log_buffer.clone();
        let source = source.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                let Ok(line) = line else { break };
                buffer.push(LogEntry {
                    timestamp: std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                    level: "warn".to_string(),
                    target: "stderr".to_string(),
                    message: line,
                    source: source.clone(),
                });
            }
        });
    }

    Ok(child)
}

/// Shared state for pending eval results.
/// The HTTP handler thread waits on the Condvar; the Tauri command inserts
/// the result and signals.
pub struct PendingResults {
    results: Mutex<HashMap<String, serde_json::Value>>,
    notify: Condvar,
}

/// Tauri command invoked from injected JS to deliver eval results back to Rust.
#[tauri::command]
pub fn __dev_bridge_result(
    id: String,
    value: serde_json::Value,
    state: tauri::State<'_, Arc<PendingResults>>,
) {
    let mut results = state.results.lock().unwrap();
    results.insert(id, value);
    state.notify.notify_all();
}

const EVAL_TIMEOUT_MESSAGE: &str = "Eval timeout: no result callback received. Re-copy examples/tauri-bridge/src/dev_bridge.rs from tauri-agent-tools 0.7.0+ and verify Tauri IPC is available.";

fn build_eval_callback_js(js: &str, request_id: &str) -> String {
    format!(
        r#"
                    (async () => {{
                        const __getDevBridgeInvoke = () => {{
                            if (window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === "function") {{
                                return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
                            }}
                            if (window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === "function") {{
                                return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
                            }}
                            return null;
                        }};

                        let __devBridgeInvoke = __getDevBridgeInvoke();
                        try {{
                            if (!__devBridgeInvoke) {{
                                throw new Error("Tauri invoke API not found: expected window.__TAURI_INTERNALS__.invoke or window.__TAURI__.core.invoke");
                            }}
                            let __result = await eval({js});
                            if (typeof __result === "undefined") {{
                                __result = null;
                            }} else if (typeof __result === "object" && __result !== null) {{
                                __result = JSON.stringify(__result);
                            }} else if (typeof __result !== "string") {{
                                __result = String(__result);
                            }}
                            await __devBridgeInvoke("__dev_bridge_result", {{
                                id: {id},
                                value: __result
                            }});
                        }} catch(e) {{
                            __devBridgeInvoke = __devBridgeInvoke || __getDevBridgeInvoke();
                            if (!__devBridgeInvoke) {{
                                throw e;
                            }}
                            const __message = e && e.message ? e.message : String(e);
                            await __devBridgeInvoke("__dev_bridge_result", {{
                                id: {id},
                                value: "ERROR: " + __message
                            }});
                        }}
                    }})();
                    "#,
        js = serde_json::to_string(js).unwrap(),
        id = serde_json::to_string(request_id).unwrap(),
    )
}

/// Start the development bridge HTTP server.
///
/// Returns the bound port, a shared log buffer, and a sidecar registry. Both
/// the buffer and registry are intended to be passed back to
/// `spawn_sidecar_monitored` for any sidecar processes you launch; the
/// registry is what powers the `/process` and `/health` endpoints' visibility
/// into the process tree. Callers that don't spawn sidecars can ignore the
/// registry handle.
pub fn start_bridge(
    app: &AppHandle,
) -> Result<(u16, Arc<LogBuffer>, Arc<SidecarRegistry>), String> {
    let server =
        Server::http("127.0.0.1:0").map_err(|e| format!("Failed to start bridge: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("Failed to get server address")?
        .port();

    // Generate random token
    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    // Write token file
    let token_file = TokenFile {
        port,
        token: token.clone(),
        pid: std::process::id(),
    };
    let token_path = format!("/tmp/tauri-dev-bridge-{}.token", std::process::id());
    let token_json = serde_json::to_string_pretty(&token_file).unwrap();
    fs::write(&token_path, &token_json).map_err(|e| format!("Failed to write token file: {e}"))?;

    // Clean up token file on exit
    let cleanup_path = token_path.clone();
    let _guard = scopeguard::guard((), move |_| {
        let _ = fs::remove_file(&cleanup_path);
    });

    // Create log buffer and install tracing layer
    let log_buffer = Arc::new(LogBuffer::new());
    let layer = BridgeLogLayer {
        buffer: log_buffer.clone(),
    };
    let _ = tracing_subscriber::registry().with(layer).try_init();

    // Create shared pending-results state and register it with Tauri
    let pending = Arc::new(PendingResults {
        results: Mutex::new(HashMap::new()),
        notify: Condvar::new(),
    });
    app.manage(pending.clone());

    // Sidecar registry — exposed to integrators via the return tuple and
    // consulted by /process and /health.
    let sidecar_registry = Arc::new(SidecarRegistry::new());
    app.manage(sidecar_registry.clone());

    // Capture process start metadata once so /process and /health don't pay
    // for the lookup on every request.
    let start_instant = Instant::now();
    let tauri_pid = std::process::id();
    let tauri_exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()));
    let tauri_args: Vec<String> = std::env::args().collect();

    let app_handle = app.clone();
    let expected_token = token.clone();
    let server_log_buffer = log_buffer.clone();
    let server_registry = sidecar_registry.clone();

    thread::spawn(move || {
        // Keep _guard alive for the lifetime of the server thread
        let _cleanup = _guard;

        for mut request in server.incoming_requests() {
            let is_post = request.method().as_str() == "POST";
            let url = request.url().to_string();

            // Handle GET /version (no auth needed). Clients feature-detect
            // newer endpoints by checking the `endpoints` array.
            if url == "/version" && request.method().as_str() == "GET" {
                let resp = VersionResponse {
                    version: BRIDGE_VERSION.to_string(),
                    endpoints: vec![
                        "/eval".to_string(),
                        "/logs".to_string(),
                        "/describe".to_string(),
                        "/version".to_string(),
                        "/process".to_string(),
                        "/capabilities".to_string(),
                        "/devtools".to_string(),
                        "/health".to_string(),
                    ],
                };
                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
                continue;
            }

            let known_post = matches!(
                url.as_str(),
                "/eval" | "/logs" | "/describe" | "/process" | "/capabilities" | "/devtools" | "/health"
            );
            if !is_post || !known_post {
                let _ = request.respond(Response::from_string("Not found").with_status_code(404));
                continue;
            }

            // Read body
            let mut body = String::new();
            if let Err(_) = request.as_reader().read_to_string(&mut body) {
                let _ =
                    request.respond(Response::from_string("Bad request").with_status_code(400));
                continue;
            }

            // Handle /logs endpoint
            if url == "/logs" {
                let log_req: LogRequest = match serde_json::from_str(&body) {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = request
                            .respond(Response::from_string("Invalid JSON").with_status_code(400));
                        continue;
                    }
                };

                if log_req.token != expected_token {
                    let _ = request
                        .respond(Response::from_string("Unauthorized").with_status_code(401));
                    continue;
                }

                let entries = server_log_buffer.drain();
                let resp = LogResponse { entries };
                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
                continue;
            }

            // Handle /process endpoint — Tauri PID + sidecar registry snapshot.
            if url == "/process" {
                let req: AuthedRequest = match serde_json::from_str(&body) {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = request
                            .respond(Response::from_string("Invalid JSON").with_status_code(400));
                        continue;
                    }
                };
                if req.token != expected_token {
                    let _ = request
                        .respond(Response::from_string("Unauthorized").with_status_code(401));
                    continue;
                }
                let resp = ProcessResponse {
                    tauri: TauriProcessInfo {
                        pid: tauri_pid,
                        exe: tauri_exe.clone(),
                        args: tauri_args.clone(),
                        uptime_ms: start_instant.elapsed().as_millis() as u64,
                    },
                    sidecars: server_registry.snapshot(),
                };
                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
                continue;
            }

            // Handle /capabilities endpoint — declared Tauri capability set per window.
            if url == "/capabilities" {
                let req: AuthedRequest = match serde_json::from_str(&body) {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = request
                            .respond(Response::from_string("Invalid JSON").with_status_code(400));
                        continue;
                    }
                };
                if req.token != expected_token {
                    let _ = request
                        .respond(Response::from_string("Unauthorized").with_status_code(401));
                    continue;
                }

                let windows: Vec<String> = app_handle.webview_windows().keys().cloned().collect();
                let declared = collect_declared_capabilities(&app_handle);
                let resp = CapabilitiesResponse { declared, windows };
                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
                continue;
            }

            // Handle /devtools endpoint — inspector URL or platform hint.
            if url == "/devtools" {
                let req: AuthedRequest = match serde_json::from_str(&body) {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = request
                            .respond(Response::from_string("Invalid JSON").with_status_code(400));
                        continue;
                    }
                };
                if req.token != expected_token {
                    let _ = request
                        .respond(Response::from_string("Unauthorized").with_status_code(401));
                    continue;
                }
                let resp = devtools_response();
                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
                continue;
            }

            // Handle /health endpoint — quick "is this app sick" check.
            if url == "/health" {
                let req: AuthedRequest = match serde_json::from_str(&body) {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = request
                            .respond(Response::from_string("Invalid JSON").with_status_code(400));
                        continue;
                    }
                };
                if req.token != expected_token {
                    let _ = request
                        .respond(Response::from_string("Unauthorized").with_status_code(401));
                    continue;
                }
                let sidecars = server_registry.snapshot();
                let sidecars_alive = sidecars.iter().all(|s| matches!(s.alive, Some(true) | None));
                let webview_ready = !app_handle.webview_windows().is_empty();
                let resp = HealthResponse {
                    uptime_ms: start_instant.elapsed().as_millis() as u64,
                    webview_ready,
                    sidecars_alive,
                    sidecars,
                };
                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
                continue;
            }

            // Handle /describe endpoint
            if url == "/describe" {
                let desc_req: DescribeRequest = match serde_json::from_str(&body) {
                    Ok(r) => r,
                    Err(_) => {
                        let _ = request
                            .respond(Response::from_string("Invalid JSON").with_status_code(400));
                        continue;
                    }
                };

                if desc_req.token != expected_token {
                    let _ = request
                        .respond(Response::from_string("Unauthorized").with_status_code(401));
                    continue;
                }

                let windows: Vec<String> = app_handle
                    .webview_windows()
                    .keys()
                    .cloned()
                    .collect();

                let resp = DescribeResponse {
                    pid: Some(std::process::id()),
                    windows: Some(windows),
                    capabilities: vec![
                        "eval".to_string(),
                        "logs".to_string(),
                        "describe".to_string(),
                    ],
                    ..Default::default()
                };

                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
                continue;
            }

            // Handle /eval endpoint
            let eval_req: EvalRequest = match serde_json::from_str(&body) {
                Ok(r) => r,
                Err(_) => {
                    let _ = request
                        .respond(Response::from_string("Invalid JSON").with_status_code(400));
                    continue;
                }
            };

            // Verify token
            if eval_req.token != expected_token {
                let _ =
                    request.respond(Response::from_string("Unauthorized").with_status_code(401));
                continue;
            }

            // Evaluate JS in webview via callback pattern
            let request_id = uuid::Uuid::new_v4().to_string();

            let window_label = eval_req.window.as_deref().unwrap_or("main");
            if let Some(window) = app_handle.get_webview_window(window_label) {
                // Build JS that evaluates the expression, then calls back into Rust
                // via Tauri's invoke API to deliver the result. Prefer the
                // internal global because Tauri 2 does not expose __TAURI__
                // unless app.withGlobalTauri is enabled.
                let callback_js = build_eval_callback_js(&eval_req.js, &request_id);

                if let Err(e) = window.eval(&callback_js) {
                    let _ = request.respond(
                        Response::from_string(format!("Eval injection failed: {e}"))
                            .with_status_code(500),
                    );
                    continue;
                }

                // Wait for the result with a 5-second timeout
                let mut results = pending.results.lock().unwrap();
                let deadline = std::time::Duration::from_secs(5);
                let start = std::time::Instant::now();

                loop {
                    if let Some(value) = results.remove(&request_id) {
                        let resp = EvalResponse { result: value };
                        let json = serde_json::to_string(&resp).unwrap();
                        let header =
                            Header::from_bytes("Content-Type", "application/json").unwrap();
                        let _ =
                            request.respond(Response::from_string(json).with_header(header));
                        break;
                    }

                    let elapsed = start.elapsed();
                    if elapsed >= deadline {
                        // Timeout — clean up and respond with 504
                        results.remove(&request_id);
                        let _ = request.respond(
                            Response::from_string(EVAL_TIMEOUT_MESSAGE).with_status_code(504),
                        );
                        break;
                    }

                    let remaining = deadline - elapsed;
                    let (guard, timeout_result) =
                        pending.notify.wait_timeout(results, remaining).unwrap();
                    results = guard;

                    if timeout_result.timed_out() && !results.contains_key(&request_id) {
                        results.remove(&request_id);
                        let _ = request.respond(
                            Response::from_string(EVAL_TIMEOUT_MESSAGE).with_status_code(504),
                        );
                        break;
                    }
                }
            } else {
                let resp = EvalResponse {
                    result: serde_json::Value::Null,
                };
                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
            }
        }
    });

    eprintln!("Dev bridge {BRIDGE_VERSION} started on port {port}");
    eprintln!("Token file: {token_path}");

    Ok((port, log_buffer, sidecar_registry))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eval_callback_prefers_tauri_internals() {
        let script = build_eval_callback_js("document.title", "request-1");
        let internals = script.find("window.__TAURI_INTERNALS__.invoke").unwrap();
        let global = script.find("window.__TAURI__.core.invoke").unwrap();

        assert!(internals < global);
    }

    #[test]
    fn eval_callback_keeps_global_tauri_fallback() {
        let script = build_eval_callback_js("document.title", "request-1");

        assert!(script.contains("window.__TAURI__.core.invoke"));
        assert!(!script.contains("app.withGlobalTauri"));
    }

    #[test]
    fn eval_callback_safely_embeds_js_and_request_id() {
        let js = r#"document.querySelector("[data-name=\"x\"]").textContent"#;
        let request_id = r#"request-"quoted""#;
        let script = build_eval_callback_js(js, request_id);

        assert!(script.contains(&serde_json::to_string(js).unwrap()));
        assert!(script.contains(&serde_json::to_string(request_id).unwrap()));
    }

    #[test]
    fn eval_callback_uses_dev_bridge_result_command() {
        let script = build_eval_callback_js("1 + 1", "request-1");

        assert!(script.contains("__dev_bridge_result"));
        assert!(!script.contains("await window.__TAURI__.core.invoke"));
    }

    #[test]
    fn eval_timeout_message_is_actionable() {
        assert!(EVAL_TIMEOUT_MESSAGE.contains("no result callback received"));
        assert!(EVAL_TIMEOUT_MESSAGE.contains("Re-copy"));
        assert!(EVAL_TIMEOUT_MESSAGE.contains("dev_bridge.rs"));
    }
}

/// Read declared capabilities from tauri.conf.json via `app.config()`. Returns
/// a flat list of capability entries. Tauri 2 lets capabilities be either bare
/// permission identifiers (strings) or full inline definitions; we surface
/// both as `CapabilityEntry` rows with `permissions` populated where possible.
fn collect_declared_capabilities(app: &AppHandle) -> Vec<CapabilityEntry> {
    let config = app.config();
    let security = &config.app.security;
    let mut out = Vec::new();
    for cap in &security.capabilities {
        let raw = serde_json::to_value(cap).unwrap_or(serde_json::Value::Null);
        match &raw {
            serde_json::Value::String(s) => {
                // Capability declared by reference to a JSON file. We don't have
                // the resolved contents at runtime here, but we surface the
                // identifier so callers know what was requested.
                out.push(CapabilityEntry {
                    identifier: s.clone(),
                    description: None,
                    windows: Vec::new(),
                    permissions: Vec::new(),
                });
            }
            serde_json::Value::Object(map) => {
                let identifier = map
                    .get("identifier")
                    .and_then(|v| v.as_str())
                    .unwrap_or("<inline>")
                    .to_string();
                let description = map
                    .get("description")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                let windows: Vec<String> = map
                    .get("windows")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();
                let permissions: Vec<String> = map
                    .get("permissions")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| match v {
                                serde_json::Value::String(s) => Some(s.clone()),
                                serde_json::Value::Object(o) => o
                                    .get("identifier")
                                    .and_then(|i| i.as_str())
                                    .map(|s| s.to_string()),
                                _ => None,
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                out.push(CapabilityEntry {
                    identifier,
                    description,
                    windows,
                    permissions,
                });
            }
            _ => {}
        }
    }
    out
}

/// Build a `/devtools` response for the current platform. v1 emits useful
/// hints rather than always producing a hot inspector URL — Safari attach on
/// macOS requires UI activation, Windows WebView2 needs a launch-time arg.
fn devtools_response() -> DevtoolsResponse {
    if cfg!(target_os = "macos") {
        DevtoolsResponse {
            platform: "wkwebview".to_string(),
            inspectable: cfg!(debug_assertions),
            url: None,
            hint: "Open Safari > Develop > <Mac name> > <App name> to attach. \
                Requires the app to be built with debug_assertions (i.e., `tauri dev`)."
                .to_string(),
        }
    } else if cfg!(target_os = "windows") {
        let port = std::env::var("WEBVIEW2_REMOTE_DEBUGGING_PORT").ok();
        let url = port.as_ref().map(|p| format!("http://127.0.0.1:{p}"));
        DevtoolsResponse {
            platform: "webview2".to_string(),
            inspectable: url.is_some(),
            url,
            hint: "Set WEBVIEW2_REMOTE_DEBUGGING_PORT=9222 before launching, \
                then open http://127.0.0.1:9222 in Chrome/Edge to inspect."
                .to_string(),
        }
    } else {
        let inspector = std::env::var("WEBKIT_INSPECTOR_SERVER").ok();
        DevtoolsResponse {
            platform: "webkitgtk".to_string(),
            inspectable: inspector.is_some(),
            url: inspector.as_ref().map(|s| format!("http://{s}")),
            hint: "Export WEBKIT_INSPECTOR_SERVER=127.0.0.1:9222 before launching, \
                then open http://127.0.0.1:9222 to inspect."
                .to_string(),
        }
    }
}
