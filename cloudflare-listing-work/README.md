# Cloudflare Korea Autoparts Listing Desk

2026-10-13 사용자 승인으로 작업표와 eBay 연결을 Cloudflare Workers/D1으로 전환했다.

운영 주소: https://korea-autoparts-listing-desk.kongee7425.workers.dev/listing-work

운영 방법과 Hermes 요청 형식: [docs/CLOUDFLARE_OPERATION.md](../docs/CLOUDFLARE_OPERATION.md).

- 랜딩페이지/작업표는 사용자 지시에 따라 암호 없이 사용한다. 등록 API는 비공개 admin 인증이 필요하다.
- eBay 연결 설정은 Workers secrets에 있으며 저장소·Git·사진 패키지에 넣지 않는다.
- 사진은 로컬 완성본→eBay EPS. Workers는 요청 메모리로만 바이너리를 중계하고 D1/Assets/R2/KV/Blob에는 사진을 저장하지 않는다.
- D1에는 작업표, 문자 상품 메타데이터, 해시, EPS URL, 실행 시도/결과만 보관한다. public board와 protected executor를 구분한다.
- US 실제 계정·등록·공개 갤러리 검수 전체 완료 후 AU로 진행한다. 실행 시도는 날짜/작업UUID/계정 단위로 독점 기록하며 모호한 결과를 새 실행으로 우회하지 않는다.
- 등록 작업은 컴퓨터의 Hermes/Codex에서 시작한다. 웹 버튼은 작업 요청 저장이다. 컴퓨터가 켜져 있어야 한다.
- 확인된 라이브 검증: 실제 US/AU 판매자 인증과 참고 상품 조회. 신규 EPS·게시 첫 실행 검증은 다음 요청 작업에서 진행한다.
- 구 Vercel 자료는 삭제하지 않았다. 원격 Blob은 접근 중단 상태여서 최신 전체 백업 확인 전 삭제하지 않는다.

## 개발

```sh
npm ci
npm test
npm run build
npm run db:remote
npm run deploy
```

Wrangler 로그인과 정확한 account/database/script를 확인하고 기존 연결로 배포한다. Paid 구독을 시작하지 않는다. `wrangler.jsonc`의 DB는 작업표와 문자 기록용이다. `.private`, `.env`, 작업중/백업, node_modules 및 dist는 Git에 포함하지 않는다.
