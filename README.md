# notiontodoweget

말로 던진 할 일을 노션 To-do DB에 정리해 기록하고, 바탕화면 위젯이 그 DB를 읽어 보여주는 개인 도구다.
설계 배경과 함정은 [`HANDOFF.md`](./HANDOFF.md)에 있다.

## 구성

- `.claude/skills/todo/SKILL.md` — 할 일을 노션에 기록/조회/완료 처리하는 Claude 스킬
- `scripts/todo_widget.py` — 바탕화면 상주 위젯 본체 (pywebview)
- `scripts/todo_widget.pyw` — 콘솔 창 없이 실행하는 런처 (시작프로그램용)
- `scripts/.env.example` — 위젯용 노션 토큰 설정 예시
- `scripts/install_startup.ps1` — Windows 로그인 시 위젯 자동 실행 등록 (선택)

## 위젯 실행 (Windows)

```powershell
cd scripts
pip install -r requirements.txt
copy .env.example .env
notepad .env   # NOTION_TODO_TOKEN=발급받은_토큰 으로 채우기
python todo_widget.py
```

`.env`는 git에 올라가지 않는다 (`.gitignore` 참고). 토큰을 소스 코드에 직접 넣지 않는다.

사전 준비 (사람이 직접 해야 함, 자동화 불가):

1. https://www.notion.so/profile/integrations 에서 Internal Integration 발급, Capabilities에서 Read content / Update content 켜기
2. 업무 DB, 개인 DB 페이지 각각에서 `... > 연결` 로 이 Integration 추가 (한쪽만 하면 404)
3. DB별로 `완료` 버튼 속성 만들기 (자동화: `완료` 체크 + `완료일` 오늘로 채우기)

## 로그인 시 자동 실행 (선택)

```powershell
cd scripts
powershell -ExecutionPolicy Bypass -File install_startup.ps1
```

`shell:startup`에 `todo_widget.pyw`로 가는 바로가기를 만든다. pythonw.exe로 실행되어 콘솔 창이 뜨지 않는다.
