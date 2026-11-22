# JUNJA LAND CASINO · SEASON 2 — CELESTIA

준자랜드 카지노 시즌 2. 시즌 1(junja-GAME-CLUB2)과 완전히 분리된 독립 서비스입니다.

- 배포: Vercel (`junja-casino-s2`, 리전 sin1) · DB: Neon Postgres (`junja-casino-s2`, Singapore)
- 환경 변수: `DATABASE_URL`, `ADMIN_CODE`
- 구조: `api/index.js`(단일 API 라우터) · `lib/`(서버 로직) · `public/`(화면) · `schema.sql`(DB 스키마)

## 게임
- 멀티: 라이브 크래시, 라이브 바카라, 텍사스 홀덤(PvP), 섯다(PvP)
- 싱글: 헤븐 릴(슬롯), 블랙잭, 스타폴(플링코), 하이로우, 다이아 마인즈, 다이스, 비디오 포커
- 모든 결과와 잔액은 서버에서 처리 · 게임머니는 현금 가치 없는 가상 재화

## 관리자
`/admin` → 로그인한 계정에 관리자 코드(ADMIN_CODE)를 한 번 입력하면 권한 연결.

## 로컬 테스트
`LOCAL_PSQL=<db> node tests/server.js` 후 `node tests/api-test.js`, `node tests/unit.js`
