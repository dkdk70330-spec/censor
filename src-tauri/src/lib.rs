use std::{fs, path::{Path, PathBuf}};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewWindow};
use std::sync::Mutex;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};

fn widget(app: &AppHandle) -> Result<WebviewWindow, String> { app.get_webview_window("widget").ok_or("위젯 창을 찾을 수 없습니다.".into()) }

#[tauri::command]
fn copy_character_image(app: AppHandle, source_path: String, character: String) -> Result<String, String> {
  let source = PathBuf::from(&source_path);
  let metadata = fs::metadata(&source).map_err(|_| "이미지 파일을 읽을 수 없습니다.")?;
  if metadata.len() > 10 * 1024 * 1024 { return Err("이미지는 파일당 10MB 이하여야 합니다.".into()); }
  let ext = source.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
  if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) { return Err("PNG, JPG, WebP 파일만 선택할 수 있습니다.".into()); }
  let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("characters");
  fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
  for old in fs::read_dir(&data_dir).map_err(|e| e.to_string())?.flatten() { if old.file_name().to_string_lossy().starts_with(&format!("{character}.")) { let _ = fs::remove_file(old.path()); } }
  let target = data_dir.join(format!("{character}.{ext}"));
  fs::copy(source, &target).map_err(|e| e.to_string())?;
  Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
fn set_always_on_top(app: AppHandle, value: bool) -> Result<(), String> { widget(&app)?.set_always_on_top(value).map_err(|e| e.to_string()) }

struct LockState(Mutex<bool>);
fn update_lock(app: &AppHandle, locked: bool) -> Result<(), String> {
  widget(app)?.set_ignore_cursor_events(locked).map_err(|e| e.to_string())?;
  *app.state::<LockState>().0.lock().map_err(|_| "잠금 상태를 갱신하지 못했습니다.")? = locked;
  app.emit("lock-changed", locked).map_err(|e| e.to_string())
}
#[tauri::command]
fn set_locked(app: AppHandle, locked: bool) -> Result<(), String> { update_lock(&app, locked) }
#[tauri::command]
fn persist_widget_position(app: AppHandle) -> Result<(), String> {
  let position = widget(&app)?.outer_position().map_err(|e| e.to_string())?;
  let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("widget-position.json");
  fs::create_dir_all(path.parent().unwrap_or(Path::new("."))).map_err(|e| e.to_string())?;
  fs::write(path, format!("{{\"x\":{},\"y\":{}}}", position.x, position.y)).map_err(|e| e.to_string())
}
fn restore_widget_position(app: &AppHandle) {
  let Ok(dir) = app.path().app_data_dir() else { return; };
  let Ok(text) = fs::read_to_string(dir.join("widget-position.json")) else { return; };
  let fields: Vec<i32> = text.split(|c: char| !c.is_ascii_digit() && c != '-').filter_map(|s| s.parse().ok()).collect();
  if fields.len() == 2 { let _ = widget(app).and_then(|w| w.set_position(PhysicalPosition::new(fields[0], fields[1])).map_err(|e| e.to_string())); }
}
pub fn run() {
  tauri::Builder::default().manage(LockState(Mutex::new(false))).plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_store::Builder::default().build()).invoke_handler(tauri::generate_handler![copy_character_image, set_always_on_top, set_locked, persist_widget_position]).setup(|app| {
    restore_widget_position(&app.handle());
    let settings = MenuItem::with_id(app, "settings", "설정 열기", true, None::<&str>)?;
    let lock = MenuItem::with_id(app, "lock", "잠금 전환", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "위젯 숨기기", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&settings, &lock, &hide, &quit])?;
    let tray = TrayIconBuilder::new().menu(&menu);
    let tray = if let Some(icon) = app.default_window_icon() { tray.icon(icon.clone()) } else { tray };
    tray.on_menu_event(|app, event| match event.id.as_ref() { "settings" => { if let Some(w) = app.get_webview_window("settings") { let _ = w.show(); let _ = w.set_focus(); } }, "lock" => { let current = *app.state::<LockState>().0.lock().unwrap_or_else(|e| e.into_inner()); let _ = update_lock(app, !current); }, "hide" => { if let Some(w) = app.get_webview_window("widget") { let _ = w.hide(); } }, "quit" => app.exit(0), _ => {} }).on_tray_icon_event(|tray, event| { if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { if let Some(w) = tray.app_handle().get_webview_window("settings") { let _ = w.show(); let _ = w.set_focus(); } } }).build(app)?;
    Ok(())
  }).run(tauri::generate_context!()).expect("error while running Charpet");
}
