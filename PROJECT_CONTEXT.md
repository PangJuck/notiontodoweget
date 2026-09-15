# notiontodoweget — 프로젝트 컨텍스트

이 문서는 claude.ai **Project 지식**과 **메모리**에 넣어두는 용도다. 성준(GitHub:
PangJuck, 이 저장소의 소유자)의 개인 할 일 관리 시스템에 대해, 다른 세션(특히
파일시스템·git 접근이 없는 웹 채팅)이 맥락 없이도 도와줄 수 있게 적어둔다.

**이 문서는 스냅샷이다.** 코드가 실제로 어떻게 생겼는지는 항상 저장소가 기준이고,
이 문서는 뒤처질 수 있다. 코드를 고치는 작업이면 반드시 저장소를 먼저 확인한다.

## 이게 뭔지

말로 던진 할 일을 노션 DB에 4사분면(중요×시급)으로 정리해 기록하고, 세 군데에서
같은 데이터를 본다.

1. **Claude 채팅 (스킬)** — 아무 세션에서나 "할 일 추가해줘", "아침 정리" 같은
   말로 노션에 직접 기록/조회
2. **바탕화면 위젯 (Windows)** — 항상 떠 있는 작은 창. pywebview
3. **웹판 (브라우저)** — 위젯과 화면을 완전히 같이 쓰는 브라우저 버전. Cloudflare
   Workers에 배포

로컬 저장소가 없다. 세 군데 다 노션을 그 자리에서 읽고 쓴다 — 노션이 유일한
진짜 데이터다.

## 저장소

- GitHub: `PangJuck/notiontodoweget`
- 작업 브랜치: `claude/github-connection-check-bryb2i` (Claude Code 세션이 계속
  써온 브랜치. 병합 여부는 저장소에서 확인)

## 노션 구조

DB가 셋이다. 속성 구조는 거의 같고 용도만 다르다.

| 용도 | database_id (REST API) | data_source_id (MCP) | 위치 |
|---|---|---|---|
| 업무 | `0e928040351d4fdfae49f77e67e914e6` | `5ead04e6-65a7-4e98-9b3c-a8dfffdf5001` | 회사 팀 페이지 (링크 있으면 누구나 봄) |
| 개인 | `1730d225784340f88e15f9af9d51ea78` | `bd927ce1-075b-4b3a-b98a-7c823cbb6cfd` | 개인 워크스페이스 |
| 팀 | `6f9008aa63f249109b6ed29a374b529d` | `4045c7f7-673a-4f36-a60e-6c6e0fd05b02` | 개인 워크스페이스 비공개 (팀원에게 공유 안 함) |

**팀 DB는 성준의 개인/업무 DB와 완전히 분리된 별개다.** 팀원에게는 노션을
공유하지 않는다 — 웹판(워커)만이 Integration 토큰으로 이 DB를 읽고 쓰고,
로그인한 사람의 이메일로 `담당자`를 걸러 자기 것만 내보낸다. 노션을 공유해
버리면 그 순간 격리가 깨진다.

팀 DB에만 있는 속성:

| 속성 | 타입 | 비고 |
|---|---|---|
| `담당자` | 선택 | `성준` / `가영` / `창준` / `여림`. 웹판이 로그인 이메일과 대조한다 |
| `비공개` | 체크박스 | 켜져 있으면 **주인 말고 아무에게도 안 보인다**(관리자도) |

팀 DB에는 `분류` 속성이 없다 (업무/개인 구분이 필요 없으므로).

### 노션 뷰

세 DB 모두 `오늘의 3` · `매트릭스`(우선순위 보드) · `캘린더`(마감일) · `할 일` ·
`기록`(완료일 내림차순) 뷰를 같은 구성으로 갖는다. 그 밖에 업무 DB에는 `분류별`
보드가, 팀 DB에는 `담당자별` 보드가 있다 (팀 DB에는 `분류` 속성이 없다). 개인
DB에는 둘 다 없다.

뷰는 사람이 노션에서 직접 볼 때 쓰는 것이다 — 위젯·웹판·스킬은 뷰를 거치지 않고
DB를 직접 질의하므로, 뷰를 고치거나 지워도 그쪽 동작은 바뀌지 않는다.

### 팀 모드

워커에 `TEAM` 시크릿이 있으면 켜진다. 없으면 성준 혼자 쓰는 예전 동작 그대로다.

- 신원은 Cloudflare Access가 서명한 JWT에서만 꺼낸다. 브라우저가 보낸 값은
  헤더든 본문이든 믿지 않는다
- 거르는 일은 전부 워커가 한다. 남의 항목은 브라우저로 나가지 않는다
- 관리자(성준)는 업무·개인·팀 전체 + 담당자별 필터, 팀원은 팀 DB에서 자기 것만
- 고치기 전에 워커가 노션에 그 페이지의 주인을 직접 물어본다. 화면이 보낸
  page_id를 그대로 믿지 않는다
- `비공개`가 켜진 항목은 노션 **질의 단계에서** 빠진다. 주인이 아니면 워커
  메모리에도 안 올라온다. 관리자도 남의 비공개는 보지도 고치지도 못한다.
  **다만 노션을 직접 열면 성준에게는 보인다** — 팀 DB가 성준 개인 워크스페이스에
  있기 때문이다. 웹판·MCP에서 가려질 뿐이고, 진짜 비밀을 담는 곳이 아니다.
  채팅 스킬(`.claude/skills/todo/SKILL.md`)은 이 사정 때문에 팀 DB를 통째로 읽을 때
  `비공개`를 빼도록 따로 적어 두었다 — 특히 주간 보고
- 설정 방법은 `worker/README.md`의 "팀 모드" 절에 있다

**어디에 넣을지가 중요하다.** 결혼 준비, 학업, 병원, 가족, 개인 재정은 반드시
개인 DB로. 회사 업무는 업무 DB로. 업무 DB가 있는 페이지는 회사 사람 누구나 볼 수
있기 때문이다.

속성명은 정확히 이대로다 (양쪽 DB 동일):

| 속성 | 타입 | 비고 |
|---|---|---|
| `할 일` | 제목 | 가운데 공백 있음 |
| `우선순위` | 선택 | 4사분면. 앞 숫자 1~4가 기준, 뒤 글자는 노션에서 바뀔 수 있음 |
| `완료` | 체크박스 | |
| `오늘의 3` | 체크박스 | 오늘 반드시 끝낼 것. 최대 3개 |
| `대기중` | 체크박스 | 남의 회신을 기다리는 중 |
| `마감일` | 날짜 | |
| `완료일` | 날짜 | 완료 처리 시 같이 채운다 |
| `분류` | 선택 | 옵션은 성준이 노션에서 직접 늘림 |
| `메모` | 텍스트 | 결과물 정의 등 |

### 4사분면

| 값 | 뜻 |
|---|---|
| `1 지금 당장 (중요+시급)` | 오늘 안 하면 터지는 일 |
| `2 핵심 업무 (중요+안시급)` | 안 하면 나중에 1번이 되는 일 |
| `3 빠르게 쳐낼 (안중요+시급)` | 잡무 |
| `4 언젠가 (안중요+안시급)` | 지금은 아닌데 버리기 아까운 것 |

옵션 이름 뒤쪽 글자는 노션에서 자유롭게 바뀔 수 있다. 판단은 항상 **앞 숫자
1~4**로 한다.

## 시스템 구성 (파일 레이아웃)

```
.claude/skills/todo/SKILL.md   Claude 채팅용 스킬. 노션 MCP(data_source_id) 사용
ui/                             위젯과 웹판이 같이 쓰는 화면 코드
  app.css, body.html, app.js    화면 자체 (뒤가 위젯인지 웹인지 모른다)
  adapter-widget.js             window.Backend = pywebview.api 호출
  adapter-web.js                window.Backend = fetch("/api/*") 호출
scripts/
  todo_widget.py                위젯 본체. ui/를 읽어 화면 조립, 노션 REST API(2022-06-28) 호출
  build_exe.ps1                 PyInstaller로 TodoWidget.exe 빌드 (Windows에서 사람이 직접 실행)
  make_icon.py                  아이콘(app.png/app.small.png) → app.ico
  .env                          NOTION_TODO_TOKEN=... (gitignore, 커밋 안 됨)
worker/
  index.js                      Cloudflare Worker. 노션 호출 로직을 JS로 재구현, 토큰을 시크릿으로 쥐고 /api/*를 대신 불러줌
  connectors/calendar.js        캘린더 커넥터 자리. 아직 안 붙어 있다 (docs/구글-캘린더-연동-계획.md)
  test/worker.test.js           워커를 실제로 돌려 보는 시험. `cd worker && npm test`. 노션·토큰 없이 돈다
  wrangler.toml                 [assets] directory = "../ui" 로 화면 코드를 같이 서빙
  .dev.vars                     로컬 개발용 토큰 (gitignore, 커밋 안 됨)
README.md, HANDOFF.md           설계 배경. HANDOFF.md는 최초 설계 당시 기록이라 일부 낡음
```

## 배포된 것

- 웹판: `https://todo-widget-web.pangtodo.workers.dev`
- Cloudflare Access로 잠겨 있다 — `ghaos009@naver.com` 계정으로 로그인해야만 접속됨
- 노션 토큰은 `wrangler secret put NOTION_TOKEN`으로 Cloudflare에 저장돼 있고, 코드
  어디에도 값 자체는 없다

## 보안 규칙 — 항상 지킬 것

- **노션 토큰 값 자체를 채팅에도, 코드에도, 커밋에도 남기지 않는다.** 넣어야 할
  자리는 늘 사람이 직접 채우게 안내한다 (`scripts/.env`, `wrangler secret put`,
  `worker/.dev.vars`)
- `.env`, `.dev.vars`는 `.gitignore`에 있다. 이 파일들을 커밋하려는 시도가 보이면
  멈추고 확인한다
- 웹판 URL을 다른 사람과 공유하는 건 Cloudflare Access 설정과 별개 문제다 —
  자체 판단으로 공유 관련 안내를 하지 않는다

## 유지보수는 이렇게 진행한다

**기본은 Claude Code**(이 저장소에 직접 붙어 파일을 읽고 고치고 커밋·푸시할 수 있는
세션)에서 한다. 성준이 claude.ai **웹 채팅**(파일시스템·git 접근이 없는 일반
Project 대화)에서 유지보수를 요청하면:

1. 코드 변경이 필요한 요청이면, 이 문서의 파일 레이아웃을 참고해 **어떤 파일을
   어떻게 고쳐야 하는지 구체적으로 제시**한다 (diff나 전체 코드 블록으로)
2. **직접 커밋·푸시·배포는 못 한다**고 분명히 안내한다. 실제 반영은 성준이
   Claude Code 세션(터미널이 있는 claude.ai 환경 또는 로컬 CLI)에 그 내용을
   전달해서 처리해야 한다
3. 배포 자체(`npx wrangler deploy`, `build_exe.ps1`)는 Claude Code에서도 결국
   성준의 컴퓨터에서 사람이 명령어를 실행해야 끝난다 — Windows/Cloudflare 계정
   접근이 필요하기 때문이다

## 디버깅할 때 알아두면 좋은 함정들

- **pywebview + WebView2에서 창을 직접 건드리는 호출**(`window.on_top`,
  `window.resize`, `window.hide`, `window.destroy`)을 js_api 콜백 안에서 곧장
  실행하면 서로 물려 위젯이 멈춘다. 반드시 `threading.Thread`로 백그라운드에
  넘기고 즉시 `{"ok": True}`를 반환해야 한다 (`scripts/todo_widget.py`의 `Api`
  클래스가 이미 이렇게 되어 있다 — 되돌리지 않는다)
- CSS `[hidden]`은 `display:flex` 같은 명시적 display에 진다.
  `[hidden]{display:none!important}`가 `ui/app.css`에 있어야 한다
- Pillow로 `.ico`를 저장할 때 원본보다 큰 사이즈를 요청하면 조용히 빠진다.
  `scripts/make_icon.py`처럼 각 사이즈를 직접 렌더링해 `append_images`로 넘겨야
  한다
- Windows PowerShell 5.1은 UTF-8 **BOM**이 없으면 한글이 든 `.ps1`이 깨진다
- 노션 REST API 버전은 `2022-06-28`로 고정돼 있다 (`scripts/todo_widget.py`,
  `worker/index.js` 둘 다). 그 이후 버전은 `databases/{id}/query`가
  `data_sources/{id}/query`로 바뀌므로, 버전을 올리면 두 파일 다 같이 고쳐야
  한다. 반면 **스킬은 노션 MCP**를 쓰기 때문에 `data_source_id`를 쓰고 이 제약이
  없다 — 서로 다른 두 체계다
- `ui/`의 노션 호출 로직은 `scripts/todo_widget.py`(파이썬)와
  `worker/index.js`(JS)에 **각각 따로 구현**돼 있다. 필터·정렬·에러 메시지를
  한쪽만 고치면 위젯과 웹판이 서로 다르게 동작한다

## 스킬 파일

`.claude/skills/todo/SKILL.md`를 claude.ai에 올리려면 zip으로 묶어야 한다
(`todo/SKILL.md` 구조로, 폴더명이 스킬 이름과 같아야 한다). **스킬 파일이
바뀔 때마다 다시 압축해서 새로 올려야 한다** — Claude Code와 claude.ai 사이에
스킬이 자동으로 동기화되지 않는다.
