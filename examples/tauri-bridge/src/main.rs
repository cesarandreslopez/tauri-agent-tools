mod dev_bridge;

fn main() {
    let mut builder = tauri::Builder::default();

    if cfg!(debug_assertions) {
        builder = builder.invoke_handler(tauri::generate_handler![
            dev_bridge::__dev_bridge_result
        ]);
    }

    builder
        .setup(|app| {
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
