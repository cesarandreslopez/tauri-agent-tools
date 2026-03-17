use rand::Rng;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Response, Server};

#[derive(Deserialize)]
struct EvalRequest {
    js: String,
    token: String,
}

#[derive(Serialize)]
struct EvalResponse {
    result: serde_json::Value,
}

#[derive(Serialize)]
struct TokenFile {
    port: u16,
    token: String,
    pid: u32,
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
/// Returns the port number on success.
pub fn start_bridge(app: &AppHandle) -> Result<u16, String> {
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

    // Create shared pending-results state and register it with Tauri
    let pending = Arc::new(PendingResults {
        results: Mutex::new(HashMap::new()),
        notify: Condvar::new(),
    });
    app.manage(pending.clone());

    let app_handle = app.clone();
    let expected_token = token.clone();

    thread::spawn(move || {
        // Keep _guard alive for the lifetime of the server thread
        let _cleanup = _guard;

        for request in server.incoming_requests() {
            if request.method().as_str() != "POST" || request.url() != "/eval" {
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

            // Parse request
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

            if let Some(window) = app_handle.get_webview_window("main") {
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

    Ok(port)
}
