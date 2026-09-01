$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $env:TEMP "veil-hqsam2-build"
$python = "py"

if (-not (Test-Path (Join-Path $buildRoot "Scripts\python.exe"))) {
  & $python -3.10 -m venv $buildRoot
}
$venvPython = Join-Path $buildRoot "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
& $venvPython -m pip install "git+https://github.com/SysCV/sam-hq.git#subdirectory=sam-hq2" pillow pyinstaller

$output = Join-Path $workspace "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$pyiRoot = Join-Path $buildRoot "pyinstaller"
& $venvPython -m PyInstaller --noconfirm --clean --onefile --name veil-hqsam2 --collect-all sam2 --collect-all hydra --collect-all omegaconf --collect-all iopath --hidden-import portalocker --distpath (Join-Path $pyiRoot "dist") --workpath (Join-Path $pyiRoot "build") --specpath (Join-Path $pyiRoot "spec") (Join-Path $workspace "src-sidecar\hqsam2_worker.py")
Copy-Item -Force (Join-Path $pyiRoot "dist\veil-hqsam2.exe") (Join-Path $output "veil-hqsam2-x86_64-pc-windows-msvc.exe")
