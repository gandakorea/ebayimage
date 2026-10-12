# Cloudflare 운영 전환 — 2026-10-13

작업표: https://korea-autoparts-listing-desk.kongee7425.workers.dev/listing-work

작업표와 비공개 eBay 연결은 Cloudflare Workers/D1을 사용한다. 사진 원본·완성본·썸네일·이미지 base64를 Cloudflare 또는 Vercel에 저장하지 않는다. 사진은 로컬 `완성본/<품번>/`에서 검수하고 eBay EPS로 전송한다. Workers는 필요한 바이너리를 요청 메모리에서만 전달한다. D1에는 작업표, 승인 상품 문자 정보, 해시, EPS URL, 실행 시도/결과만 기록한다.

## Hermes 다음 작업

1. `/Users/gandakorea/Documents/ebay/AGENTS.md`, `작업규칙.md`, `docs/EBAY_ACCOUNTS.md`, `docs/LISTING_RULES.md`와 이 문서를 다시 읽는다. 과거 Vercel/Blob 안내보다 이 전환 규칙이 우선한다.
2. `node cloudflare-listing-work/scripts/board-client.mjs read YYYY-MM-DD <새 로컬 스냅샷.json>`으로 작업표를 읽는다. Cloudflare 조회에는 eBay/admin 비밀값을 전달하지 않는다. found=false를 임의 작업표로 대체하지 않는다.
3. 참고 상품 조회 요청 JSON `{ "action":"reference", "market":"US", "itemId":"참고번호" }`을 만들고 `node cloudflare-listing-work/scripts/executor-client.mjs <요청.json> <새 응답.json>`을 실행한다. 응답의 `result.xml`에 전체 GetItem 결과가 있다. Description 템플릿336779935333도 동일하게 조회한다.
4. 미국 계정부터 실제 identity를 확인한다. 이미지 편집은 `docs/PHOTO_EDITING_PLAYBOOK.md`와 기존 사진 스킬·원본 대조 절차를 사용한다. Hermes의 실제 image_generate 원본 입력과 반환 파일을 확인한다. 로컬 최종 PNG 전 장의 크기/픽셀/품번/해시/라벨/워터마크를 검사한다. 등록용 `packages.json`과 별도 `photo-approval.json`을 로컬에 저장한다. 승인 파일은 `passed:true,images:[{path,sha256}]`로 전체 사진을 묶는다.
5. 패키지 형식은 `cloudflare-listing-work/scripts/executor.fixture.json`을 참고하되 샘플 상품/가격/정책/호환표를 새 작업에 복사하지 않는다. 실제 작업표 UUID는 `localUUID`, 참고번호는 `reference`, USD는 `priceUSD`, 배송은 `shippingPolicyInput`으로 연결한다. `images:[{path,sha256}]`의 path는 해당 로컬 완성본 절대 경로이다. US.categoryId/스토어 ID/전체 호환행과 notes, itemSpecifics, 현재 제목·본문·storeModel·taxonomyQuery를 실제 조회로 작성한다. begin 전에 `{action:"store",market:"US"}`로 실제 스토어를 조회할 수 있다. 참고 API의 빈 NameValueList는 호환 값으로 만들지 않고 실제 이름·값이 있는 전체 행과 notes를 보존한다.
6. `begin` 요청은 `{action:"begin",date,run:"새 UUID",packageFile:"로컬 packages.json 절대경로",approvalFile:"로컬 photo-approval.json 절대경로"}`이다. CLI는 전체 PNG를 디코드·해시 검증한 후 문자 메타데이터만 전송한다. 작업표 가격/참고번호/배송/UUID 변경 시 서버가 거부한다. 실행 run UUID는 로컬에 영구 기록하고 실패 후 새 UUID로 다시 시작하지 않는다.
7. 이후 모든 요청에 run,market,ref,정확한 itemId(localUUID)를 넣는다. `identity`, `policy`, `store`로 실제 계정/배송정책/스토어를 읽는다. `upload` 요청은 추가로 index와 packageFile을 넣는다. 로컬 사진→eBay EPS upload와 로컬 독립 픽셀검수를 마친 결과만 사용한다. 응답 result가 signed photo receipt이다.
8. `verifyUS`는 전 장 `receipts`를 받는다. 실제 VerifyAddFixedPriceItem 응답과 수수료를 검토한다. `publishUS`는 같은 receipts와 verifyUS 응답의 result.verification을 받는다. 실제 Add 시도는 날짜/UUID/계정 단위로 한 번만 허용하며 결과 불명확 시 status와 정확한 대상 결과를 확인한다. 새 run으로 차단을 우회하지 않는다.
9. `read` 요청에는 publication을 넣어 실제 GetItem 전체를 받는다. 기존 규칙대로 모든 항목, 미국 호환표 전체 값과 notes, EPS 장수·순서, 실제 공개 갤러리의 모든 사진과 설명 VIN 그림의 실제 로딩을 검수한다. 로컬 증거 JSON/스크린샷을 보관한다. 끝난 뒤 `qa`에 listingId,apiVerified:true,publicGalleryVerified:true,vinVerified:true,evidenceSHA256(실제 로컬 검수 파일 해시)을 전송한다. 이것은 자동 브라우저 검수의 대체가 아니며 검수하지 않은 true를 넣지 않는다.
10. 미국 전체 QA 후에만 AU를 시작한다. `prepareAU`, `store`, `auCatalog`를 읽고 실제 정책/Seoul 위치/현재 환율/카테고리를 확인한다. 요청 모델의 스토어가 없으면 `ensureAUStoreCategory`에 실제 parentCategoryId를 전달한다. 서버는 참고 호환표의 단일 Make와 실제 상위 분류를 대조하고 해당 storeModel만 추가하며 시도를 기록한다. 반환 SetStoreCategories 상태와 다시 조회한 스토어를 확인한 뒤 진행한다. `approveAUPreparation`은 categoryId와 storeCategory를 받아 실제 환율로 가격을 계산한다. `publishAU`는 photo receipts, signed preparation, 전체 US publication 배열을 받는다. 현재 실행기는 AU 호환표를 임의로 생성하지 않으며 비워 등록한다. 확인된 AU 호환행을 적용할 작업은 이 기능을 별도로 검증해 연결해야 한다.
11. AU read/public/VIN 검수 후 qa를 기록한다. 최종 작업표는 새로 읽은 전체 batch의 해당 UUID만 바꾸고 원 expectedVersion을 사용하는 board-client save로 기록한다. 다른 상품과 날짜, 가격, 배정은 보존한다. 409이면 내용 비교 후 판단하며 버전만 바꿔 무조건 재전송하지 않는다.

## 결과 불명확·검증 제한

executor-client는 응답 파일을 덮어쓰지 않는다. EPS 성공 응답을 저장한 뒤 픽셀 검증에서 실패하면 그 URL/원 결과로 조사하며 업로드를 무작정 반복하지 않는다. `verify-existing-eps.mjs`에 승인 패키지·기존 업로드 응답·새 QA 파일 경로를 전달해 이미 전송된 사진을 재검수할 수 있다. 현재 실제 Media API의 /00/s/.../z/.../$_57.PNG?set_id=...와 /images/ 사진 주소를 모두 안전한 eBay 호스트 조건에서 검수한다. 서버 status에는 기존 게시 결과·시도·QA가 있다. 서버 완료 기록이 없으면 실행 완료를 주장하지 않는다.

2026-10-13 실제 첫 등록 검증을 완료했다. 접수 UUID `8ff15201-b232-4aa9-8421-9225517fb207`, 참고237118025199, 품번92406-N9500, 사진8장이다. 미국 gandakorea `237120784863` USD340.00·7day fast를 먼저 게시하고 API 전체 항목/호환표33행+notes/공개 사진8장/VIN 로딩을 검수한 뒤, 호주 sihooshop `267811726500` AUD487.53·7day fast를 게시하고 동일 검수를 수행했다. 환율은 2026-10-12 USD→AUD1.4339다. AU 카탈로그 후보121행 중2025/2026은14행이지만 품번별 AU 장착 근거가 확인되지 않아 사용자 글로벌 판매 규칙에 따라 호환표를 비웠다. 두 계정의 EPS 반환16장은 로컬 PNG와 전체 픽셀 차이0을 확인했다.

원본16파일의 해시 보존, 개별 최종 사진8장 검수, 실제 Hermes image_generate 원본1장 호출 성공과 공급자설정 반영을 확인했다. 사진 관련 실행 노하우는 PHOTO_EDITING_PLAYBOOK.md, 복사 가능한 통합 지시서는 HERMES_WORK_RULES.txt다. 회귀 테스트10개가 통과했다. 이것은 해당1상품의 실제 경로 검증이며 모든 미래 사진을 무검수 처리하거나 예약 자동 실행을 켰다는 뜻이 아니다. 이후 추가 접수는 최초 실행 패키지에 합치지 않고 작업표에 보존한다.

Vercel 자료/기존 소스는 역사 자료로 보존한다. Blob은 접근 중단으로 전체 최신 원격 자료 백업이 확인되지 않았으므로 삭제 완료로 보고하지 않는다. Pro 결제 문의·영수증은 별도로 유지한다. 새 등록 작업은 Vercel/Blob에 연결하지 않는다.
