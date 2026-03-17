use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::sync::Arc;
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

/// Start the development bridge HTTP server.
/// Returns the port number on success.
pub fn start_bridge(app: &AppHandle) -> Result<u16, String> {
    let server = Server::http("127.0.0.1:0").map_err(|e| format!("Failed to start bridge: {e}"))?;
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

            // Evaluate JS in webview
            let (tx, rx) = std::sync::mpsc::channel();
            let js = eval_req.js.clone();

            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.eval(&format!(
                    r#"
                    try {{
                        const __result = eval({js});
                        window.__tauriDevBridgeResult = __result;
                    }} catch(e) {{
                        window.__tauriDevBridgeResult = "ERROR: " + e.message;
                    }}
                    "#,
                    js = serde_json::to_string(&js).unwrap()
                ));

                // Give the webview a moment to evaluate
                thread::sleep(std::time::Duration::from_millis(50));

                // For simplicity, return the JS expression — in production,
                // use a Tauri command callback to get the actual result
                let _ = tx.send(serde_json::Value::String(js));
            } else {
                let _ = tx.send(serde_json::Value::Null);
            }

            match rx.recv_timeout(std::time::Duration::from_secs(5)) {
                Ok(result) => {
                    let resp = EvalResponse { result };
                    let json = serde_json::to_string(&resp).unwrap();
                    let header =
                        Header::from_bytes("Content-Type", "application/json").unwrap();
                    let _ = request.respond(Response::from_string(json).with_header(header));
                }
                Err(_) => {
                    let _ = request
                        .respond(Response::from_string("Eval timeout").with_status_code(504));
                }
            }
        }
    });

    eprintln!("Dev bridge started on port {port}");
    eprintln!("Token file: {token_path}");

    Ok(port)
}
