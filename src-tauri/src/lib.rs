mod audio_meter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_webview2_widevine_args();

    tauri::Builder::default()
        .setup(|app| {
            audio_meter::start_audio_meter(app.handle().clone());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "windows")]
fn configure_webview2_widevine_args() {
    const WEBVIEW2_ARGS_ENV: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

    let default_args = [
        "--autoplay-policy=no-user-gesture-required",
        "--enable-widevine-cdm",
    ]
    .join(" ");

    let args = match std::env::var("SKINDECK_WEBVIEW2_ARGS") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => default_args,
    };

    std::env::set_var(WEBVIEW2_ARGS_ENV, args);
}

#[cfg(not(target_os = "windows"))]
fn configure_webview2_widevine_args() {}
