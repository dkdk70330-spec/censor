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

# The upstream wheel currently omits Hydra's YAML configs. Restore them from
# the same official source revision before PyInstaller collects package data.
$sourceRoot = Join-Path $buildRoot "sam-hq-source"
if (-not (Test-Path (Join-Path $sourceRoot ".git"))) {
  & git clone --depth 1 https://github.com/SysCV/sam-hq.git $sourceRoot
} else {
  & git -C $sourceRoot pull --ff-only
}
$sitePackages = & $venvPython -c "import site; print(site.getsitepackages()[0])"
$sam2Configs = Join-Path $sitePackages "sam2\configs"
New-Item -ItemType Directory -Force -Path $sam2Configs | Out-Null
Copy-Item -Recurse -Force (Join-Path $sourceRoot "sam-hq2\sam2\configs\*") $sam2Configs

$output = Join-Path $workspace "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$pyiRoot = Join-Path $buildRoot "pyinstaller"
& $venvPython -m PyInstaller --noconfirm --clean --onefile --name veil-hqsam2 --collect-all sam2 --collect-all hydra --collect-all omegaconf --collect-all iopath --add-data "$sam2Configs;sam2/configs" --hidden-import portalocker --distpath (Join-Path $pyiRoot "dist") --workpath (Join-Path $pyiRoot "build") --specpath (Join-Path $pyiRoot "spec") (Join-Path $workspace "src-sidecar\hqsam2_worker.py")
Copy-Item -Force (Join-Path $pyiRoot "dist\veil-hqsam2.exe") (Join-Path $output "veil-hqsam2-x86_64-pc-windows-msvc.exe")
