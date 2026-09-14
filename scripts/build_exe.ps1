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

# assets\app.png -> assets\app.ico (16~256px를 한 파일에 담는다)
python make_icon.py

pyinstaller --noconfirm --onefile --windowed --name TodoWidget `
    --icon assets\app.ico `
    --add-data "assets;assets" `
    --add-data "..\ui;ui" `
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

# exe 옆에도 아이콘과 화면 코드를 풀어둔다. 이걸 갈아끼우면 다시 빌드하지
# 않고도 트레이 아이콘이나 화면이 바뀐다.
New-Item -ItemType Directory -Force -Path dist\assets | Out-Null
Copy-Item assets\app.png dist\assets\app.png -Force -ErrorAction SilentlyContinue
Copy-Item assets\app.small.png dist\assets\app.small.png -Force -ErrorAction SilentlyContinue
Copy-Item assets\app.ico dist\assets\app.ico -Force

# dist\ui가 이미 있으면 Copy-Item -Recurse가 그 안에 ui\ui\로
# 한 겹 더 넣어버려 바깥쪽 dist\ui는 옛날 그대로 남는다. 매번 통째로
# 지우고 새로 복사해야 실제로 갱신된다.
if (Test-Path dist\ui) { Remove-Item dist\ui -Recurse -Force }
Copy-Item ..\ui dist\ui -Recurse -Force

Write-Host ""
Write-Host "완료: dist\TodoWidget.exe"
Write-Host "이제부터는 파이썬 설치 없이 이 exe를 더블클릭하면 위젯이 뜬다."
Write-Host "아이콘이 예전 것으로 보이면 바탕화면에서 F5, 그래도 그대로면"
Write-Host "  ie4uinit.exe -show  를 한 번 돌려 아이콘 캐시를 비운다."
Write-Host "시작프로그램에 등록하려면 dist\TodoWidget.exe의 바로가기를 만들어"
Write-Host "  Win+R -> shell:startup 폴더에 넣는다."
