use futures_util::StreamExt;
use serde::Serialize;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicBool, Ordering},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{fs::File, io::AsyncWriteExt};

const HQ_SAM2_FILE: &str = "sam2.1_hq_hiera_large.pt";
const HQ_SAM2_URL: &str =
    "https://huggingface.co/lkeab/hq-sam/resolve/main/sam2.1_hq_hiera_large.pt?download=true";
const HQ_SAM2_BYTES: u64 = 898_844_313;

struct DownloadState(AtomicBool);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelStatus {
    installed: bool,
    downloading: bool,
    bytes: u64,
    path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    received: u64,
    total: Option<u64>,
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("models")
        .join(HQ_SAM2_FILE))
}

#[tauri::command]
fn hq_sam2_status(
    app: AppHandle,
    state: tauri::State<DownloadState>,
) -> Result<ModelStatus, String> {
    let path = model_path(&app)?;
    let bytes = fs::metadata(&path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    Ok(ModelStatus {
        installed: bytes == HQ_SAM2_BYTES,
        downloading: state.0.load(Ordering::Relaxed),
        bytes,
        path: (bytes == HQ_SAM2_BYTES).then(|| path.to_string_lossy().to_string()),
    })
}

struct DownloadGuard<'a>(&'a AtomicBool);
impl Drop for DownloadGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Relaxed);
    }
}

#[tauri::command]
async fn download_hq_sam2(
    app: AppHandle,
    state: tauri::State<'_, DownloadState>,
) -> Result<ModelStatus, String> {
    if state.0.swap(true, Ordering::Relaxed) {
        return Err("HQ-SAM 2 모델을 이미 다운로드하고 있습니다.".into());
    }
    let _guard = DownloadGuard(&state.0);
    let target = model_path(&app)?;
    if let Ok(metadata) = fs::metadata(&target) {
        if metadata.len() == HQ_SAM2_BYTES {
            return Ok(ModelStatus {
                installed: true,
                downloading: false,
                bytes: metadata.len(),
                path: Some(target.to_string_lossy().to_string()),
            });
        }
    }
    tokio::fs::create_dir_all(
        target
            .parent()
            .ok_or("모델 저장 경로를 만들 수 없습니다.")?,
    )
    .await
    .map_err(|error| error.to_string())?;
    let partial = target.with_extension("pt.part");
    let response = reqwest::Client::new()
        .get(HQ_SAM2_URL)
        .send()
        .await
        .map_err(|error| format!("모델 다운로드 연결 실패: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("모델 서버 응답 오류: {}", response.status()));
    }
    let total = response.content_length();
    let mut file = File::create(&partial)
        .await
        .map_err(|error| error.to_string())?;
    let mut stream = response.bytes_stream();
    let mut received = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("모델 다운로드 중 오류: {error}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        received += chunk.len() as u64;
        let _ = app.emit(
            "hq-sam2-download-progress",
            DownloadProgress { received, total },
        );
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    if received != HQ_SAM2_BYTES {
        return Err(format!(
            "모델 파일 크기가 올바르지 않습니다: {received}/{HQ_SAM2_BYTES}"
        ));
    }
    tokio::fs::rename(&partial, &target)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ModelStatus {
        installed: true,
        downloading: false,
        bytes: received,
        path: Some(target.to_string_lossy().to_string()),
    })
}

pub fn run() {
    tauri::Builder::default()
        .manage(DownloadState(AtomicBool::new(false)))
        .invoke_handler(tauri::generate_handler![hq_sam2_status, download_hq_sam2])
        .run(tauri::generate_context!())
        .expect("error while running Veil");
}
