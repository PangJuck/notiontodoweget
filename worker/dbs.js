/* 노션 DB id. 워커 본체와 커넥터가 같이 본다.
   index.js가 connectors/를 부르고 connectors/가 이 값을 알아야 해서, 둘 다
   여기서 가져간다 — 서로를 import 하면 고리가 생긴다. */

// 성준 개인 DB. 팀원에게는 이 문이 열리지 않는다.
export const PERSONAL_DB = "1730d225784340f88e15f9af9d51ea78";

// 팀 공용. 회사 일은 성준 것까지 전부 여기 있고, `담당자`로 구분한다.
export const TEAM_DB = "6f9008aa63f249109b6ed29a374b529d";
