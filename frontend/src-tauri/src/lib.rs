//! Tauri 셸 — 번들된 백엔드(sidecar)를 자식 프로세스로 기동/종료한다.
//!
//! 흐름: 앱 시작 시 :8787 이 이미 응답하면(개발 모드에서 uvicorn 별도 실행 등) 스폰을
//! 생략하고 재사용한다. 아니면 Resources 안의 동결 백엔드(kis-hts-backend, PyInstaller
//! onedir)를 스폰하고 env(모의/포트)를 주입한다. 앱이 종료되면 자식을 kill 한다.
//!
//! 백엔드 자체 로그는 ~/KIS/config/kis-hts-sidecar.log 로 남겨 패키징 실행을 디버깅한다.
use std::fs::OpenOptions;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent};

const BACKEND_PORT: u16 = 8787;

/// 종료 시 kill 하기 위해 자식 핸들을 보관.
struct BackendHandle(Mutex<Option<Child>>);

/// :8787 에 이미 백엔드가 응답하는지(개발 모드 등) 확인.
fn backend_already_running() -> bool {
    let addr = format!("127.0.0.1:{BACKEND_PORT}");
    addr.parse()
        .ok()
        .and_then(|a| TcpStream::connect_timeout(&a, Duration::from_millis(300)).ok())
        .is_some()
}

/// 번들된 백엔드를 스폰. 이미 떠 있으면(None) 스폰하지 않는다.
fn spawn_backend(app: &tauri::App) -> Option<Child> {
    if backend_already_running() {
        log::info!("backend already on :{BACKEND_PORT}, skip spawn");
        return None;
    }
    let exe: PathBuf = app
        .path()
        .resolve("resources/backend/kis-hts-backend", BaseDirectory::Resource)
        .ok()?;
    if !exe.exists() {
        log::error!("bundled backend not found at {exe:?} — 백엔드를 따로 실행하세요");
        return None;
    }
    // 번들 복사 과정에서 실행권한이 유실될 수 있어 보장.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&exe) {
            let mut perm = meta.permissions();
            perm.set_mode(perm.mode() | 0o755);
            let _ = std::fs::set_permissions(&exe, perm);
        }
    }

    // 백엔드 stdout/stderr → ~/KIS/config/kis-hts-sidecar.log (패키징 실행 디버깅용)
    let (out, err) = open_log(app);

    match Command::new(&exe)
        .env("KIS_HTS_ENV", "vps") // 패키징 기본 = 모의투자(안전)
        .env("KIS_HTS_PORT", BACKEND_PORT.to_string())
        .stdout(out)
        .stderr(err)
        .spawn()
    {
        Ok(child) => {
            log::info!("spawned backend pid={} at {exe:?}", child.id());
            Some(child)
        }
        Err(e) => {
            log::error!("failed to spawn backend: {e}");
            None
        }
    }
}

/// sidecar 로그 파일 stdio 한 쌍을 연다(실패하면 null 로 폴백).
fn open_log(app: &tauri::App) -> (Stdio, Stdio) {
    let file = app.path().home_dir().ok().and_then(|home| {
        let path = home.join("KIS/config/kis-hts-sidecar.log");
        std::fs::create_dir_all(path.parent()?).ok()?;
        OpenOptions::new().create(true).append(true).open(path).ok()
    });
    match file {
        Some(f) => {
            let err = f.try_clone().map(Stdio::from).unwrap_or_else(|_| Stdio::null());
            (Stdio::from(f), err)
        }
        None => (Stdio::null(), Stdio::null()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(BackendHandle(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let child = spawn_backend(app);
            *app.state::<BackendHandle>().0.lock().unwrap() = child;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|handle, event| {
        // 앱 종료 시 백엔드 자식을 정리(고아 프로세스 방지).
        if let RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<BackendHandle>() {
                if let Some(mut child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
