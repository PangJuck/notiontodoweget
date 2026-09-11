# 웹판 배포 (Cloudflare Workers)

바탕화면 위젯과 화면 코드(`ui/`)를 완전히 같이 쓰는 브라우저판이다. 서버는
토큰을 쥐고 노션과 이야기하는 얇은 중계층 하나뿐이고, 데이터는 노션 그
자체이니 별도 DB가 없다.

**로그인 기능이 없다.** URL을 아는 사람은 누구든 내 노션 할 일을 읽고 쓸
수 있으므로, 배포하자마자 아래 3번(Cloudflare Access)까지 반드시 끝낸다.
그 전까지는 URL을 아무에게도 공유하지 않는다.

## 사전 준비 (사람이 직접, 한 번만)

1. https://dash.cloudflare.com 에 무료 계정 (신용카드 필요 없음)
2. Node.js 설치 (wrangler가 필요로 한다)

## 배포

```bash
cd worker
npm install
npx wrangler login          # 브라우저가 뜨고 Cloudflare 로그인
npx wrangler secret put NOTION_TOKEN
# 프롬프트가 뜨면 노션 Integration 토큰을 붙여넣는다.
# 이 토큰은 wrangler가 Cloudflare에 암호화해 저장할 뿐, 이 저장소
# 어디에도, 이 터미널 기록에도 평문으로 남지 않는다.
npx wrangler deploy
```

배포가 끝나면 `https://todo-widget-web.<계정이름>.workers.dev` 같은
주소가 나온다. **이 주소를 아직 아무에게도 주지 않는다.**

## Cloudflare Access로 잠그기 (필수)

Cloudflare 대시보드 → Zero Trust → Access → Applications → **Add an
application** → Self-hosted.

- Application domain: 위에서 받은 `*.workers.dev` 주소
- Policy: `Include` → `Emails` → 본인 이메일 하나만
- 세션 길이는 편한 대로 (예: 24시간)

저장하면 그 주소에 접속할 때마다 Cloudflare 로그인 화면이 먼저 뜨고,
등록한 이메일로만 통과한다. 50명까지 무료다.

## 로컬에서 미리 보기

```bash
cd worker
cp .dev.vars.example .dev.vars   # NOTION_TODO_TOKEN 대신 NOTION_TOKEN 키로 채운다
npx wrangler dev
```

`.dev.vars`는 로컬 전용이고 git에 올라가지 않는다 (`.gitignore` 참고).
배포된 워커에는 영향을 주지 않는다 — 그쪽은 `wrangler secret put`으로
넣은 값을 쓴다.

## 업데이트

화면(`ui/`)이나 노션 호출 로직(`worker/index.js`)을 고친 뒤:

```bash
cd worker
npx wrangler deploy
```

토큰을 다시 넣을 필요는 없다. 시크릿은 배포와 별개로 유지된다.

## 위젯과 다른 점

`ui/app.js`는 `window.Backend`라는 창구 하나만 알고, 그 뒤가 위젯인지
웹인지는 모른다.

- 위젯: `ui/adapter-widget.js`가 `pywebview.api`를 부른다
- 웹: `ui/adapter-web.js`가 `fetch("/api/...")`로 이 워커를 부른다

`Backend.chrome`이 `false`면 항상 위 / 트레이로 숨기기 / 종료 / 크기 조절
손잡이처럼 OS 창에서만 의미 있는 조작을 화면에서 숨긴다(`app.css`의
`.widget.web` 규칙). 브라우저 탭은 원래 있는 새로고침·닫기로 충분하다.
