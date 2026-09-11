# notiontodoweget

말로 던진 할 일을 노션 To-do DB에 정리해 기록하고, 바탕화면 위젯이 그 DB를 읽어 보여주는 개인 도구다.
설계 배경과 함정은 [`HANDOFF.md`](./HANDOFF.md)에 있다.

## 4사분면

할 일을 중요도와 시급성으로 나눈다. 노션 `우선순위` 속성과 위젯이 같은 값을 쓴다.

| 값 | 뜻 | 다루는 법 |
|---|---|---|
| `1 지금 당장 (중요+시급)` | 오늘 안 하면 터지는 일 | 오전에 먼저 |
| `2 핵심 업무 (중요+안시급)` | 아무도 안 재촉하는데 안 하면 나중에 1번이 되는 일 | 매일 한 칸씩 |
| `3 빠르게 쳐낼 (안중요+시급)` | 누가 기다리지만 오래 붙들 가치는 없는 잡무 | 모아서 오후에 |
| `4 언젠가 (안중요+안시급)` | 지금은 아닌데 버리기도 아까운 것 | 한 달에 한 번 정리 |

옵션 이름은 노션에서 자유롭게 바꿔도 된다. 위젯은 **앞 숫자 1~4로만** 판단하고, 칸 제목은 노션에 들어 있는 이름을 그대로 따라간다.

곁들인 속성 둘:

- `오늘의 3` — 오늘 반드시 끝낼 것. 최대 3개. 위젯 맨 위에 고정된다
- `대기중` — 남의 회신을 기다리는 일. 내 손을 떠난 일과 지금 할 일을 섞지 않는다

노션에는 `매트릭스`(4칸 보드)와 `오늘의 3` 뷰가 DB마다 하나씩 있다.

## 기능

- 매트릭스 보기(기본)와 날짜 보기를 상단 버튼으로 전환한다
- 항목 위에 마우스를 올리면 `1~4` 버튼으로 사분면 이동, `★`로 오늘의 3 지정, `×`로 삭제
- 노션 두 DB(업무/개인)를 읽어 지난 것/오늘/이번 주/날짜 미정으로 묶어 보여준다
- 위젯 안에서 바로 **추가**, **완료**(체크), **삭제**가 된다 — 전부 그 자리에서 노션 API를 호출하므로
  로컬에는 아무것도 저장하지 않고 항상 노션 상태 그대로다. 여러 컴퓨터에서 같은 토큰으로 띄워도 안전하다
- 창 크기 조절 가능 (`resizable`), 최소 크기 260×320
- **트레이로 숨기기** — 완전히 닫지 않고 시스템 트레이 아이콘으로 보내둘 수 있다 (트레이 아이콘 우클릭 → 열기/종료)
- 삭제는 노션 휴지통으로 보내는 것(archive)이라 실수해도 노션에서 복구 가능

## 루틴

클로드에게 말하면 스킬이 돌린다.

**아침** (`아침 정리`, `오늘 뭐부터`) — 10분
1. 어제 `오늘의 3` 초기화, 못 끝낸 것 먼저 알림
2. 미분류 항목 사분면 배치
3. 지난 마감 정리
4. 오늘 끝낼 3개 선정 (`2 핵심 업무`에서 최소 하나)
5. 오전=머리 쓰는 일, 오후=잡무 배치 제안
6. 사흘 넘게 묶인 `대기중` 항목 짚기

**퇴근** (`퇴근 정리`, `오늘 마무리`) — 10분
1. 오늘 완료한 것 3줄 요약
2. 못 끝낸 `오늘의 3` 처리
3. 내일의 첫 행동 3가지 미리 지정
4. `4 언젠가` 정리
5. 새 일은 벌이지 않고 내일로

## 구성

- `.claude/skills/todo/SKILL.md` — 할 일을 노션에 4사분면으로 기록/조회/완료 처리하고 아침·퇴근 루틴을 돌리는 Claude 스킬
- `scripts/todo_widget.py` — 바탕화면 상주 위젯 본체 (pywebview + pystray)
- `scripts/todo_widget.pyw` — 콘솔 창 없이 실행하는 런처 (시작프로그램용, 파이썬으로 돌릴 때)
- `scripts/build_exe.ps1` — 파이썬 없이 더블클릭으로 실행되는 `TodoWidget.exe`를 만드는 스크립트
- `scripts/assets/app.png` — exe/트레이/창에 쓰는 아이콘 원본 (이 파일만 갈아끼우면 된다)
- `scripts/make_icon.py` — `app.png`를 윈도우용 `app.ico`(16~256px)로 굽는다. 빌드가 알아서 부른다
- `scripts/.env.example` — 위젯용 노션 토큰 설정 예시
- `scripts/install_startup.ps1` — Windows 로그인 시 위젯 자동 실행 등록 (선택, 파이썬으로 돌릴 때용)

## 위젯 실행 (Windows, 파이썬으로)

```powershell
cd scripts
pip install -r requirements.txt
copy .env.example .env
notepad .env   # NOTION_TODO_TOKEN=발급받은_토큰 으로 채우기
python todo_widget.py
```

`.env`는 git에 올라가지 않는다 (`.gitignore` 참고). 토큰을 소스 코드에 직접 넣지 않는다.

사전 준비 (사람이 직접 해야 함, 자동화 불가):

1. https://www.notion.so/profile/integrations 에서 Internal Integration 발급, Capabilities에서 Read content / Update content / Insert content 켜기 (Insert content가 없으면 위젯에서 항목 추가가 안 된다)
2. 업무 DB, 개인 DB 페이지 각각에서 `... > 연결` 로 이 Integration 추가 (한쪽만 하면 404)
3. DB별로 `완료` 버튼 속성 만들기 (자동화: `완료` 체크 + `완료일` 오늘로 채우기) — 위젯에서도 체크로 완료 처리가 되니 이건 노션 화면에서 직접 처리할 때를 위한 보조 수단

## 실행 파일(.exe)로 쓰기 (선택, 파이썬 설치 없이 쓰고 싶을 때)

Windows에서 딱 한 번:

```powershell
cd scripts
powershell -ExecutionPolicy Bypass -File build_exe.ps1
```

`scripts\dist\TodoWidget.exe`가 생기고, 그 옆에 `.env`가 같이 복사된다. 이후로는 파이썬 없이 그 exe를 더블클릭하면 된다. exe를 다른 폴더로 옮기면 `.env`도 같이 옮긴다.

## 아이콘 바꾸기

`scripts/assets/app.png` 하나만 갈아끼우면 exe 아이콘, 작업표시줄, 트레이, 창이 전부 따라온다.
정사각형이 아니어도 되고(비율 유지한 채 투명 여백을 채운다), 512x512 이상을 권한다.

빌드할 때 `make_icon.py`가 `app.ico`를 자동으로 굽는다. `.ico`를 직접 만들 필요는 없다.
`app.png`가 없으면 4사분면 모양을 임시로 그려 쓴다. 파이썬 기본 깃털 아이콘은 뜨지 않는다.

이미 만들어둔 exe의 트레이 아이콘만 바꾸고 싶으면 `dist\assets\app.png`를 교체하고 위젯을 다시 켠다.
exe 파일 자체의 아이콘은 다시 빌드해야 바뀐다.

바꿨는데 옛날 아이콘이 보이면 윈도우 아이콘 캐시 탓이다. 바탕화면에서 F5, 그래도 그대로면:

```powershell
ie4uinit.exe -show
```

## 로그인 시 자동 실행 (선택)

**파이썬으로 돌리는 경우**:
```powershell
cd scripts
powershell -ExecutionPolicy Bypass -File install_startup.ps1
```
`shell:startup`에 `todo_widget.pyw`로 가는 바로가기를 만든다. pythonw.exe로 실행되어 콘솔 창이 뜨지 않는다.

**exe로 쓰는 경우**: `TodoWidget.exe`를 우클릭 → 바로가기 만들기 → 그 바로가기를 `Win+R` → `shell:startup` 폴더에 넣는다.
