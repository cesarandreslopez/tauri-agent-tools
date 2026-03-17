mod dev_bridge;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Only start bridge in development
            if cfg!(debug_assertions) {
                if let Err(e) = dev_bridge::start_bridge(app.handle()) {
                    eprintln!("Warning: Failed to start dev bridge: {e}");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
