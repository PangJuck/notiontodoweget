# todo_widget.py를 파이썬 없이 더블클릭으로 실행되는 단일 exe로 묶는다.
# Windows에서 한 번만 실행하면 된다. (Claude Code가 리눅스 서버에서는
# Windows용 exe를 만들 수 없어서, 이 단계는 사람이 직접 돌려야 한다)
#
# 사용법:
#   cd scripts
#   powershell -ExecutionPolicy Bypass -File build_exe.ps1
#
# 끝나면 scripts\dist\TodoWidget.exe 가 생긴다.
# .env 파일을 TodoWidget.exe와 같은 폴더에 넣어야 토큰을 읽는다.
# exe를 다른 폴더로 옮길 거면 .env도 같이 옮긴다.

$ErrorActionPreference = "Stop"

pip install --quiet -r requirements.txt
pip install --quiet pyinstaller

pyinstaller --noconfirm --onefile --windowed --name TodoWidget `
    --hidden-import clr_loader `
    --hidden-import pythonnet `
    todo_widget.py

if (Test-Path .env) {
    Copy-Item .env dist\.env -Force
    Write-Host "dist\.env 로 토큰 파일을 같이 복사했다."
} else {
    Copy-Item .env.example dist\.env.example -Force
    Write-Host ".env가 아직 없다. dist\.env.example을 dist\.env로 복사해 토큰을 채운다."
}

Write-Host ""
Write-Host "완료: dist\TodoWidget.exe"
Write-Host "이제부터는 파이썬 설치 없이 이 exe를 더블클릭하면 위젯이 뜬다."
Write-Host "시작프로그램에 등록하려면 dist\TodoWidget.exe의 바로가기를 만들어"
Write-Host "  Win+R -> shell:startup 폴더에 넣는다."
