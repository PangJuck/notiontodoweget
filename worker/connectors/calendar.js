/* 캘린더 커넥터 자리.
 *
 * **아직 아무 데도 연결되어 있지 않다.** `CALENDAR` 시크릿이 없으면
 * getCalendar()가 null을 돌려주고, 워커는 지금까지처럼 노션만 상대한다.
 * 이 파일이 있는 이유는 나중에 구글 캘린더를 붙일 때 worker/index.js를
 * 헤집지 않으려는 것뿐이다 — 붙일 자리는 이미 index.js에 나 있다.
 *
 * 무엇을 채워야 하는지는 docs/구글-캘린더-연동-계획.md에 적어 뒀다.
 *
 * 설계에서 물러서지 말아야 할 두 가지:
 *
 * 1. **할 일이 먼저다.** 캘린더 쪽이 실패해도 노션 기록은 그대로 끝나야 한다.
 *    그래서 index.js는 syncTodo를 await 하지 않고, 이 파일이 스스로 삼킨다.
 *    캘린더가 안 맞는 것은 불편이고, 할 일이 안 들어가는 것은 고장이다.
 * 2. **누구의 캘린더인지는 워커가 정한다.** 화면이 보낸 값으로 남의 캘린더에
 *    쓰지 않는다. 신원은 Access 토큰에서 나온 who.name / who.email 뿐이다.
 */

/* 설정이 없으면 없는 것이다. 반쯤 켜진 상태를 만들지 않는다 —
 * 켜졌다고 믿고 쓰다가 조용히 안 나가는 쪽이 훨씬 나쁘다. */
export function getCalendar(env) {
  if (!env.CALENDAR) return null;
  let cfg;
  try {
    cfg = JSON.parse(env.CALENDAR);
  } catch (_) {
    console.log("[calendar] CALENDAR 시크릿이 JSON이 아니다. 연동을 끈 채로 간다");
    return null;
  }
  if (cfg.provider !== "google") {
    console.log(`[calendar] 모르는 provider다: ${cfg.provider}`);
    return null;
  }
  return new GoogleCalendar(cfg, env);
}

/* index.js가 부르는 유일한 문. 커넥터가 없으면 아무 일도 안 일어난다.
 *
 * kind: "upsert" — 마감일이 생겼거나 옮겨졌다
 *       "remove" — 완료됐거나 지워졌다, 또는 마감일이 비워졌다
 * item: { pageId, title, due, owner } — 부르는 쪽이 아는 만큼만 채워 보낸다.
 *       모자란 값은 커넥터가 노션에서 다시 읽어 채운다.
 */
export function syncTodo(env, kind, item) {
  const cal = getCalendar(env);
  if (!cal) return;
  // 일부러 await 하지 않는다. 캘린더 때문에 할 일 저장이 늦어지면 안 된다.
  Promise.resolve()
    .then(() => (kind === "remove" ? cal.remove(item) : cal.upsert(item)))
    .catch((e) => console.log(`[calendar] ${kind} 실패: ${e && e.message}`));
}

/* ── 구글 캘린더 ───────────────────────
   여기부터가 나중에 채울 부분이다. 지금은 불리면 던진다 — 조용히 아무것도
   안 하면 "붙인 줄 알았는데 안 붙은" 상태를 못 알아챈다. 던지면 위의 catch가
   로그로 남긴다.

   채울 때 필요한 것(자세한 것은 docs/구글-캘린더-연동-계획.md):
   - 서비스 계정 키로 JWT를 만들어 oauth2.googleapis.com/token 에서
     access_token을 받는다 (워커에는 googleapis 라이브러리가 없다. fetch로 직접)
   - 사람마다 다른 캘린더에 쓰려면 도메인 전체 위임(domain-wide delegation)으로
     그 사람을 sub에 넣어 토큰을 받는다
   - 이벤트 id는 노션 page_id에서 만들어 낸다(구글 이벤트 id 규칙: 소문자와
     숫자 a-v0-9, 5~1024자). 그래야 같은 할 일을 두 번 넣지 않는다
*/
class GoogleCalendar {
  constructor(cfg, env) {
    this.cfg = cfg;
    this.env = env;
  }

  async upsert(_item) {
    throw new Error("구글 캘린더는 아직 붙이지 않았다 (worker/connectors/calendar.js)");
  }

  async remove(_item) {
    throw new Error("구글 캘린더는 아직 붙이지 않았다 (worker/connectors/calendar.js)");
  }
}
