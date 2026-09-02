use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{fs::File, io::AsyncWriteExt};

const HQ_SAM2_FILE: &str = "sam2.1_hq_hiera_large.pt";
const HQ_SAM2_URL: &str =
    "https://huggingface.co/lkeab/hq-sam/resolve/main/sam2.1_hq_hiera_large.pt?download=true";
const HQ_SAM2_BYTES: u64 = 898_844_313;

struct DownloadState(AtomicBool);

struct HqSam2Worker {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

struct HqSam2WorkerState(Arc<Mutex<Option<HqSam2Worker>>>);

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

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefineBox {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Deserialize, Serialize)]
struct RefineRequest {
    boxes: Vec<RefineBox>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MaskSegment {
    id: String,
    width: u32,
    height: u32,
    runs: Vec<u32>,
    score: f32,
}

#[derive(Deserialize, Serialize)]
struct RefineError {
    id: String,
    message: String,
}

#[derive(Deserialize, Serialize)]
struct RefineResult {
    device: String,
    segments: Vec<MaskSegment>,
    #[serde(default)]
    errors: Vec<RefineError>,
}

fn sidecar_path(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = if cfg!(target_os = "windows") {
        "veil-hqsam2.exe"
    } else {
        "veil-hqsam2"
    };
    let bundled = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .unwrap_or(Path::new("."))
        .join(executable);
    if bundled.exists() {
        return Ok(bundled);
    }
    Ok(app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join(executable))
}

fn sidecar_command(path: PathBuf) -> Command {
    let mut command = Command::new(path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn start_hq_sam2_worker(sidecar: &Path, checkpoint: &Path) -> Result<HqSam2Worker, String> {
    let mut child = sidecar_command(sidecar.to_path_buf())
        .arg("--checkpoint")
        .arg(checkpoint)
        .arg("--serve")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| format!("HQ-SAM 2 워커 시작 실패: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or("HQ-SAM 2 워커 입력을 열 수 없습니다.")?;
    let stdout = BufReader::new(
        child
            .stdout
            .take()
            .ok_or("HQ-SAM 2 워커 출력을 열 수 없습니다.")?,
    );
    Ok(HqSam2Worker {
        child,
        stdin,
        stdout,
    })
}

fn run_hq_sam2_worker(
    state: &Arc<Mutex<Option<HqSam2Worker>>>,
    sidecar: &Path,
    checkpoint: &Path,
    image: &Path,
    request: &Path,
    output: &Path,
) -> Result<(), String> {
    let job = serde_json::json!({
        "image": image,
        "request": request,
        "output": output,
    });
    let encoded = serde_json::to_string(&job).map_err(|error| error.to_string())?;
    for attempt in 0..2 {
        let mut slot = state
            .lock()
            .map_err(|_| "HQ-SAM 2 워커 잠금 오류".to_string())?;
        let stopped = slot
            .as_mut()
            .and_then(|worker| worker.child.try_wait().ok())
            .flatten()
            .is_some();
        if slot.is_none() || stopped {
            *slot = Some(start_hq_sam2_worker(sidecar, checkpoint)?);
        }
        let worker = slot.as_mut().expect("worker initialized");
        let response = (|| -> Result<String, String> {
            writeln!(worker.stdin, "{encoded}").map_err(|error| error.to_string())?;
            worker.stdin.flush().map_err(|error| error.to_string())?;
            let mut line = String::new();
            if worker
                .stdout
                .read_line(&mut line)
                .map_err(|error| error.to_string())?
                == 0
            {
                return Err("HQ-SAM 2 워커가 응답 없이 종료되었습니다.".into());
            }
            Ok(line)
        })();
        match response {
            Ok(line) => {
                let value: serde_json::Value = serde_json::from_str(&line)
                    .map_err(|error| format!("HQ-SAM 2 워커 응답 오류: {error}"))?;
                if value.get("ok").and_then(|item| item.as_bool()) == Some(true) {
                    return Ok(());
                }
                return Err(value
                    .get("error")
                    .and_then(|item| item.as_str())
                    .unwrap_or("HQ-SAM 2 처리 실패")
                    .to_string());
            }
            Err(error) if attempt == 0 => {
                if let Some(mut failed) = slot.take() {
                    let _ = failed.child.kill();
                }
                drop(slot);
                eprintln!("HQ-SAM 2 워커를 다시 시작합니다: {error}");
            }
            Err(error) => return Err(error),
        }
    }
    Err("HQ-SAM 2 워커를 시작할 수 없습니다.".into())
}

#[tauri::command]
async fn refine_hq_sam2(
    app: AppHandle,
    worker_state: tauri::State<'_, HqSam2WorkerState>,
    image_bytes: Vec<u8>,
    boxes: Vec<RefineBox>,
) -> Result<RefineResult, String> {
    if boxes.is_empty() {
        return Ok(RefineResult {
            device: "none".into(),
            segments: vec![],
            errors: vec![],
        });
    }
    let checkpoint = model_path(&app)?;
    if fs::metadata(&checkpoint)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
        != HQ_SAM2_BYTES
    {
        return Err("HQ-SAM 2 모델을 먼저 다운로드해 주세요.".into());
    }
    let sidecar = sidecar_path(&app)?;
    if !sidecar.exists() {
        return Err("HQ-SAM 2 추론 엔진이 설치되어 있지 않습니다.".into());
    }
    let work = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join(format!("hq-sam2-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir_all(&work)
        .await
        .map_err(|error| error.to_string())?;
    let image_path = work.join("image.png");
    let request_path = work.join("request.json");
    let output_path = work.join("output.json");
    tokio::fs::write(&image_path, image_bytes)
        .await
        .map_err(|error| error.to_string())?;
    tokio::fs::write(
        &request_path,
        serde_json::to_vec(&RefineRequest { boxes }).map_err(|error| error.to_string())?,
    )
    .await
    .map_err(|error| error.to_string())?;
    let worker_state = worker_state.0.clone();
    let sidecar_clone = sidecar.clone();
    let checkpoint_clone = checkpoint.clone();
    let image_clone = image_path.clone();
    let request_clone = request_path.clone();
    let output_clone = output_path.clone();
    let worker_result = tauri::async_runtime::spawn_blocking(move || {
        run_hq_sam2_worker(
            &worker_state,
            &sidecar_clone,
            &checkpoint_clone,
            &image_clone,
            &request_clone,
            &output_clone,
        )
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = worker_result {
        let _ = tokio::fs::remove_dir_all(&work).await;
        return Err(error);
    }
    let result: RefineResult = serde_json::from_slice(
        &tokio::fs::read(&output_path)
            .await
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let _ = tokio::fs::remove_dir_all(&work).await;
    Ok(result)
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
async fn save_batch_output(
    output_dir: String,
    file_name: String,
    image_bytes: Vec<u8>,
) -> Result<String, String> {
    let directory = PathBuf::from(output_dir);
    let target = batch_output_path(&directory, &file_name)?;
    tokio::fs::write(&target, image_bytes)
        .await
        .map_err(|error| format!("결과 저장 실패: {error}"))?;
    Ok(target.to_string_lossy().to_string())
}

fn batch_output_path(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    if !directory.is_dir() {
        return Err("선택한 출력 폴더를 찾을 수 없습니다.".into());
    }
    let supplied = Path::new(file_name);
    if file_name.contains('/')
        || file_name.contains('\\')
        || supplied.file_name().and_then(|name| name.to_str()) != Some(file_name)
    {
        return Err("출력 파일명이 올바르지 않습니다.".into());
    }
    let extension = supplied
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg") {
        return Err("PNG 또는 JPEG 파일만 저장할 수 있습니다.".into());
    }
    let stem = supplied
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("censored");
    let mut target = directory.join(file_name);
    let mut copy = 2u32;
    while target.exists() {
        target = directory.join(format!("{stem}-{copy}.{extension}"));
        copy += 1;
    }
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::batch_output_path;
    use std::fs;

    #[test]
    fn batch_output_stays_in_directory_and_avoids_overwrite() {
        let directory =
            std::env::temp_dir().join(format!("veil-batch-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        fs::write(directory.join("photo.png"), b"existing").unwrap();
        assert_eq!(
            batch_output_path(&directory, "photo.png").unwrap(),
            directory.join("photo-2.png")
        );
        assert!(batch_output_path(&directory, "..\\escape.png").is_err());
        assert!(batch_output_path(&directory, "result.txt").is_err());
        fs::remove_dir_all(directory).unwrap();
    }
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
        .plugin(tauri_plugin_dialog::init())
        .manage(DownloadState(AtomicBool::new(false)))
        .manage(HqSam2WorkerState(Arc::new(Mutex::new(None))))
        .invoke_handler(tauri::generate_handler![
            hq_sam2_status,
            download_hq_sam2,
            refine_hq_sam2,
            save_batch_output
        ])
        .run(tauri::generate_context!())
        .expect("error while running Veil");
}
