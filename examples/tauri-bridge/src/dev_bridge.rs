use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Response, Server};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

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

#[derive(Serialize)]
struct TokenFile {
    port: u16,
    token: String,
    pid: u32,
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
/// Returns the `std::process::Child` handle.
pub fn spawn_sidecar_monitored(
    name: &str,
    command: &str,
    args: &[&str],
    log_buffer: &Arc<LogBuffer>,
) -> Result<std::process::Child, String> {
    let mut child = Command::new(command)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn sidecar {name}: {e}"))?;

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

/// Start the development bridge HTTP server.
/// Returns the port number and log buffer on success.
/// The log buffer can be used with `spawn_sidecar_monitored()` to capture sidecar output.
pub fn start_bridge(app: &AppHandle) -> Result<(u16, Arc<LogBuffer>), String> {
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

    let app_handle = app.clone();
    let expected_token = token.clone();
    let server_log_buffer = log_buffer.clone();

    thread::spawn(move || {
        // Keep _guard alive for the lifetime of the server thread
        let _cleanup = _guard;

        for request in server.incoming_requests() {
            let is_post = request.method().as_str() == "POST";
            let url = request.url().to_string();

            // Handle GET /version (no auth needed)
            if url == "/version" && request.method().as_str() == "GET" {
                let resp = VersionResponse {
                    version: "0.6.0".to_string(),
                    endpoints: vec![
                        "/eval".to_string(),
                        "/logs".to_string(),
                        "/describe".to_string(),
                        "/version".to_string(),
                    ],
                };
                let json = serde_json::to_string(&resp).unwrap();
                let header = Header::from_bytes("Content-Type", "application/json").unwrap();
                let _ = request.respond(Response::from_string(json).with_header(header));
                continue;
            }

            if !is_post || (url != "/eval" && url != "/logs" && url != "/describe") {
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
                // via __TAURI__.core.invoke() to deliver the result.
                let callback_js = format!(
                    r#"
                    (async () => {{
                        try {{
                            let __result = await eval({js});
                            if (typeof __result === "undefined") {{
                                __result = null;
                            }} else if (typeof __result === "object" && __result !== null) {{
                                __result = JSON.stringify(__result);
                            }} else if (typeof __result !== "string") {{
                                __result = String(__result);
                            }}
                            await window.__TAURI__.core.invoke("__dev_bridge_result", {{
                                id: {id},
                                value: __result
                            }});
                        }} catch(e) {{
                            await window.__TAURI__.core.invoke("__dev_bridge_result", {{
                                id: {id},
                                value: "ERROR: " + e.message
                            }});
                        }}
                    }})();
                    "#,
                    js = serde_json::to_string(&eval_req.js).unwrap(),
                    id = serde_json::to_string(&request_id).unwrap(),
                );

                let _ = window.eval(&callback_js);

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
                            Response::from_string("Eval timeout").with_status_code(504),
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
                            Response::from_string("Eval timeout").with_status_code(504),
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

    eprintln!("Dev bridge started on port {port}");
    eprintln!("Token file: {token_path}");

    Ok((port, log_buffer))
}
