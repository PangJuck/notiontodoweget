# notiontodoweget — 작업 규칙

배경과 구조는 `PROJECT_CONTEXT.md`에 있다. 이 문서는 **고칠 때마다 지켜야 하는
것**만 담는다. 짧게 유지한다.

## 얼굴이 셋이다 — 고치면 세 군데를 챙긴다

같은 노션 DB를 세 군데가 본다. 코드는 한 군데를 고쳐도 **사람이 배포해야**
나머지가 따라온다.

| 얼굴 | 코드 | 반영되는 방법 |
|---|---|---|
| 웹판 (브라우저) | `worker/`, `ui/` | `npx.cmd wrangler deploy` ← **성준의 컴퓨터에서** |
| 바탕화면 위젯 | `scripts/todo_widget.py`, `ui/` | `scripts/build_exe.ps1`로 재빌드 |
| Claude 채팅 | `.claude/skills/scmtodo/SKILL.md` | **zip으로 묶어 claude.ai에 다시 올리기** |

## 작업을 끝낼 때 반드시 인계한다

성준은 **항상 잊는다.** 실제로 낡은 스킬 zip 때문에 없앤 업무 DB로 할 일이
새어 들어간 일이 있었다 — 코드는 맞는데 사람 쪽이 안 따라간 것이다.

그래서 무엇을 고쳤든, 답의 **맨 끝에** 이번 변경이 닿는 얼굴과 그 얼굴을
따라오게 하는 명령을 적는다. 안 고친 얼굴은 적지 않는다.

```
## 반영하려면 (성준 차례)
- 받기:  cd C:\Users\CONSTATN\Desktop\notiontodoweget
         git pull origin claude/github-connection-check-bryb2i
- 웹판:  cd C:\Users\CONSTATN\Desktop\notiontodoweget\worker ; npx.cmd wrangler deploy
- 위젯:  scripts\build_exe.ps1
- 스킬:  아래 zip 올리기 → claude.ai 설정 > 스킬 > 옛 것 지우기
- 컨텍스트: PROJECT_CONTEXT.md 통째로 claude.ai 프로젝트 지식에 다시 붙이기
```

**`git pull`을 맨 앞에 빠뜨리지 않는다.** 방금 푸시한 코드는 성준의 컴퓨터에
없다. 빼먹으면 배포는 성공했다고 나오면서 옛 코드가 그대로 올라간다 —
실제로 한 번 그랬다. `wrangler deploy` 출력의 `Total Upload:` 숫자가 지난
배포와 **한 바이트도 안 다르면** 못 받아온 것이다(`No updated asset files to
upload`도 같은 신호). 화면 좌상단의 `ui/body.html` 버전 표시로도 확인된다 —
코드를 고쳤으면 그 숫자를 같이 올려서 눈으로 확인할 수 있게 한다.

### 성준에게 주는 명령은 PowerShell 문법으로 쓴다

성준 환경은 Windows + **PowerShell 5.1**이다. 붙여넣을 명령을 줄 때:

- **`&&`를 쓰지 않는다.** PowerShell 5.1은 모른다
  (`'&&' 토큰은 이 버전에서 올바른 문 구분 기호가 아닙니다`). 줄을 나누거나
  `;`를 쓴다. 이걸로 성준이 배포가 실패한 줄 알고 두 번 더 돌린 적이 있다
- **시크릿은 `wrangler secret put`의 대화형 프롬프트에 붙여넣지 말고 파이프로
  넣는다.** Windows에서 그 프롬프트는 `Ctrl+V`를 제대로 안 받아서, 성준이
  세 번 넣었는데 세 번 다 값이 어긋났다(404). 변수에서 바로 보내면 사람 손이
  안 들어가 어긋날 수가 없다. PowerShell이 붙이는 줄바꿈은 wrangler가 떼어낸다:
  ```powershell
  $t = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
  $t | npx.cmd wrangler secret put SYNC_TOKEN
  $t | Set-Clipboard   # cron 서비스에 넣을 값은 클립보드로만 넘긴다
  ```
  **값을 화면에 찍는 줄(`$t` 단독)은 주지 않는다.** 성준은 터미널을 스크린샷으로
  보내기 때문에, 찍히면 그 순간 대화 기록에 남는다 — 실제로 한 번 새서 토큰을
  다시 만들었다
- **`npm`·`npx`는 실행정책에 막힌다**(`npm.ps1 파일을 로드할 수 없습니다`).
  `.cmd`를 붙여 **`npm.cmd`**, **`npx.cmd`**로 부른다. `npx.cmd`만 적고 `npm`을
  그냥 적어서 성준이 두 번 헛돌린 적이 있다 — 둘 다 붙인다
- `cd`는 **절대 경로**로 준다. 성준은 이미 그 폴더에 있는 경우가 많고, 상대
  경로를 주면 `worker\worker`를 찾다가 실패한다
- 프로젝트는 `C:\Users\CONSTATN\Desktop\notiontodoweget`

### claude.ai 쪽은 이렇게 적용한다 (매번 적어 준다)

claude.ai는 이 저장소를 **안 본다.** 파일을 사람이 옮겨야 한다.

**스킬** — `설정 > 기능 > 스킬`에서 zip을 올린다. 폴더명이 스킬 이름이 되므로
`scmtodo/SKILL.md` 구조여야 한다. **올린 뒤 옛 스킬을 지운다** — 같은 일을 하는
스킬이 둘이면 어느 쪽이 걸릴지 알 수 없다.

**프로젝트 지식** — claude.ai 프로젝트(`Ulick To-do`)의 지식에
`PROJECT_CONTEXT.md` 내용을 넣는다. 고쳤으면 옛 것을 지우고 새로 붙인다.

스킬이나 `PROJECT_CONTEXT.md`를 고쳤으면 **zip을 직접 만들어 파일로
건네준다**. 말로 "다시 올려라"만 하면 안 올린다.

### 올리는 파일에는 버전을 찍는다

이름이 늘 같아서 어느 것이 새것인지 성준이 헷갈렸다. 그래서 **두 군데**에 적는다:

1. **파일명** — `scmtodo-v3-20260916.zip`, `PROJECT_CONTEXT-v3-20260916.md`
   (zip **안의** 폴더는 항상 `scmtodo/`여야 한다. 그게 스킬 이름이 된다)
2. **파일 안** — 파일명은 올리는 순간 사라지므로, 문서 맨 앞의 인용 줄에
   `스킬 v3 (2026-09-16, 커밋 abc1234)`를 남긴다. 그래야 나중에 채팅에서
   "지금 버전 뭐야?"를 물어 확인할 수 있다

**둘을 고칠 때마다 번호를 하나 올린다.** 번호는 각자 따로 센다(스킬만 고쳤으면
스킬만 올린다). 커밋 해시는 `git rev-parse --short HEAD`로 그때 값을 넣는다.

## 화면 로직은 두 번 구현돼 있다

`ui/`가 부르는 노션 호출 로직은 `scripts/todo_widget.py`(파이썬)와
`worker/index.js`(JS)에 **따로** 있다. 한쪽만 고치면 위젯과 웹판이 다르게
동작한다. 새 기능을 넣으면 세 군데를 같이 본다:

1. `worker/index.js`의 `HANDLERS` (+ 팀원 Claude용 `MCP_TOOLS`/`runTool`)
2. `scripts/todo_widget.py`의 `Api`
3. `ui/adapter-web.js`와 `ui/adapter-widget.js`의 `METHODS` 목록
   — 여기 빠지면 `can()`이 false가 되어 화면에서 단추가 조용히 사라진다

## 지켜야 하는 것

- **노션 토큰·구글 서비스 계정 키 값을 채팅에도 코드에도 커밋에도 남기지
  않는다.** 넣는 자리는 늘 사람이 직접 채우게 안내한다 (`wrangler secret put`)
- `.env`, `.dev.vars`, `guides/`는 `.gitignore`다. 커밋되려 하면 멈추고 확인한다
- **개인 DB 항목은 주간 보고에도 팀원에게도 절대 안 보인다.** 팀 DB에 올라간
  것은 팀원끼리 서로 다 본다
- 웹판 URL 공유나 Cloudflare Access 설정은 자체 판단으로 안내하지 않는다
- 신원·권한 쪽을 고쳤으면 배포 전에 `worker/`에서 `npm test`를 돌린다
  (이건 Claude가 이 리눅스 샌드박스에서 직접 돌린다. 성준에게 시키지 않는다)
- **PowerShell로 한글을 파이프로 넘기면 `?`로 뭉개진다.** 시크릿에 한글이
  들어가면 `\uXXXX`로 escape해 ASCII로 만들어 넘긴다 (이걸로 한 시간 날렸다)

## 알아두면 좋은 함정

- Cloudflare **Cron 트리거가 등록은 되는데 안 깬다.** 대신 `/api/*` 요청 끝의
  `maybeSync`(받침)와 `/sync/<SYNC_TOKEN>`(밖에서 두드리기)이 있다.
  자세한 건 `worker/README.md`의 "시계가 도는지 확인하기"
- 대시보드 Logs가 `0 Success / 0 Errors`로 통째로 비어 있으면 시계 얘기가
  아니라 **배포가 안 된 것**이다. 웹 화면을 한 번 열고 fetch가 찍히는지 본다
- `ui/app.js`는 `window.Backend` 하나만 알고 뒤가 위젯인지 웹인지 모른다.
  OS 창에서만 의미 있는 조작은 `Backend.chrome`으로 가린다
- pywebview + WebView2에서 창을 직접 건드리는 호출(`on_top`/`resize`/`hide`/
  `destroy`)을 js_api 콜백 안에서 곧장 실행하면 위젯이 멈춘다. 반드시
  `threading.Thread`로 넘기고 즉시 `{"ok": True}`를 돌려준다
- 노션 REST API 버전은 `2022-06-28` 고정이다. 올리면 `databases/{id}/query`가
  `data_sources/{id}/query`로 바뀌므로 위젯·워커를 같이 고쳐야 한다
