# 위젯을 Windows 로그인 시 자동 실행되게 등록한다 (선택 사항).
#
# 사용법 (PowerShell에서):
#   cd scripts
#   powershell -ExecutionPolicy Bypass -File install_startup.ps1
#
# shell:startup 폴더에 todo_widget.pyw로 가는 바로가기를 만든다.
# pythonw.exe로 실행되므로 콘솔 창이 뜨지 않는다.
# 제거하려면 %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup 에서
# "할 일 위젯.lnk"를 지우면 된다.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $scriptDir "todo_widget.pyw"

if (-not (Test-Path $target)) {
    Write-Error "todo_widget.pyw를 찾을 수 없다: $target"
    exit 1
}

$pythonw = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $pythonw) {
    Write-Error "pythonw.exe를 못 찾았다. 파이썬 설치 경로가 PATH에 있는지 확인한다."
    exit 1
}

$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "할 일 위젯.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonw
$shortcut.Arguments = '"' + $target + '"'
$shortcut.WorkingDirectory = $scriptDir
$shortcut.Description = "노션 To-do 위젯"
$shortcut.Save()

Write-Host "등록 완료: $shortcutPath"
Write-Host "다음 로그인부터 자동으로 뜬다. 지금 바로 확인하려면:"
Write-Host "  & '$pythonw' '$target'"
