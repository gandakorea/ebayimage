# eBay 완전 자동화 운영

## 현재 연결 상태 (2026-09-10)

- Vercel Production의 비공개 환경 변수와 Private Blob 연결 완료
- 미국 OAuth 판매자 `gandakorea` / `EBAY_US` Identity 확인 완료
- 호주 OAuth 판매자 `sihooshop` / `EBAY_AU` Identity 확인 완료
- 예약 작업은 외부 URL을 다시 호출하지 않고 서버 내부 실행 함수를 직접 실행한다.
- 계정 확인용 `/api/automation/preflight`는 `AUTOMATION_ADMIN_SECRET` 인증이 있어야 실행된다.

## 확정된 실행 흐름

1. 사용자는 날짜별 작업표에 참고 아이템 번호, USD 가격, 배송 정책과 메모를 저장한다.
2. 사용자가 상품 칸의 `준비`를 누르면 사진·등록 패키지 준비 대상으로 표시된다.
3. 작업자는 참고 아이템의 제품 사진을 가능한 수량만큼 수집하고 `작업규칙.md`에 따라 편집한다. 제품이 없는 차량 예시·도표·홍보 이미지는 제외한다.
4. 1000 x 1000 PNG 완성 사진과 제목·본문·카테고리·아이템 상세·미국/호주 호환표를 하나의 등록 패키지로 비공개 Vercel Blob에 저장한다.
5. 패키지 저장이 끝나면 상품 상태가 `준비 완료`가 된다. 품번과 사진 수가 작업표에 표시된다.
6. 매일 한국시간 오후 5시에 Vercel Cron이 그 날짜의 준비 완료 상품만 읽는다.
7. 작업기는 API 인증 판매자가 `gandakorea`이고 등록 마켓이 `EBAY_US`인지 확인한다. 해당 묶음의 미국 상품을 전부 등록하고 검수한다.
8. 모든 미국 등록이 성공한 뒤에만 인증 판매자가 `sihooshop`이고 등록 마켓이 `EBAY_AU`인지 확인하여 호주 등록을 시작한다.
9. 호주 가격은 실행 시점 USD/AUD 환율로 센트 단위 반올림한다. 호환표는 등록 패키지에 검수 저장된 호주 카탈로그 행만 사용한다.
10. 성공하면 미국·호주 등록 번호와 실제 상품 링크를 작업표에 기록하고 `완료`로 바꾼다. 오류가 나면 해당 상품을 `확인 필요`로 바꾸고 이후 국가 등록을 중단한다.

## 중단 조건

- 해당 품번의 비공개 완성 사진 또는 등록 패키지가 없음
- 1000 x 1000 PNG, 품번 파일명, 사진 순서가 규칙과 다름
- 제목이 `⭐Genuine`으로 시작하지 않거나 80자를 넘음
- 본문에 현재 제목이 문자 그대로 없음
- 미국 또는 호주 카테고리·호환표 검수 자료가 없음
- 인증 판매자와 마켓이 지정 계정과 다름
- 환율 또는 eBay 응답을 확인할 수 없음

이 경우 참고 판매자 사진, 다른 품번 사진, 미국 호환표를 임의로 대체하지 않는다.

## 최초 한 번 필요한 비공개 설정

- Vercel 프로젝트에 Private Blob을 연결하여 `BLOB_READ_WRITE_TOKEN`을 만든다.
- `.env.example`의 미국·호주 OAuth와 정책 ID를 Vercel Production 환경 변수로 저장한다.
- `AUTOMATION_ADMIN_SECRET`과 `AUTOMATION_WORKER_SECRET`은 서로 다른 긴 난수로 저장한다.
- 선택 사항으로 Telegram 봇 토큰과 채팅 ID를 저장하면 완료·오류가 휴대폰에 도착한다.
- 비밀값은 Git, 랜딩페이지 데이터, 등록 패키지에 넣지 않는다.

## 등록 패키지 업로드

완성 사진을 로컬에서 검수한 뒤 `tools/upload_listing_package.ps1`로 올린다. 작업표의 내부 상품 ID와 참고 아이템 번호가 manifest와 정확히 일치해야 한다.

```powershell
pwsh -NoProfile -File tools/upload_listing_package.ps1 `
  -Manifest "작업중/패키지/2026-09-10/<item-id>.json" `
  -ImageDirectory "완성본/92101-F2400"
```

로컬 `.env.automation.local`에는 아래 두 값만 저장하며 Git에는 추가하지 않는다.

```dotenv
AUTOMATION_APP_URL=https://korea-autoparts-listing-work-park-jong-hwan-s-projects.vercel.app
AUTOMATION_ADMIN_SECRET=Vercel에 저장한 같은 값
```
