# 새 컴퓨터로 이전

## 저장소 가져오기

Windows에 Git, Python 3.10 이상, Node.js 22.13.0 이상을 설치한다. 음성 도구를 나중에 재활성화할 때에는 PowerShell 7도 필요하다.

사용자의 공개 업로드 승인에 따라 문서, 명령 도구, 앱 전체 소스, 의존성 잠금 파일과 승인 기준·샘플 이미지를 GitHub에 함께 보관한다. 아래 명령으로 저장소를 내려받으면 앱 소스도 복원된다. 기존 컴퓨터의 `migration-backup/ebayimage-full-source-265abab.zip`은 이전 시점의 보조 백업이므로 최신 문서는 GitHub 버전을 사용한다.

```powershell
git clone https://github.com/gandakorea/ebayimage.git
Set-Location ebayimage
py -m pip install -r tools/requirements.txt
Set-Location korea-autoparts-studio
npm ci
Set-Location ..
```

`npm ci`는 패키지 다운로드가 필요하다. 설치만으로 사진 처리 API를 호출하지 않는다. 앱 실행은 앱 README를 참고한다. 현재 유료 API와 음성은 중단 상태이므로 API 키를 등록하거나 연결 시험을 하지 않는다.

## 꼭 별도로 옮길 항목

- 바탕화면의 품번별 원본 사진 폴더와 그 안의 완성 파일.
- 기존 프로젝트의 `완성본`, `작업중`, `work-in-progress`, 필요한 경우 `음성보고` 폴더.
- 승인 워터마크 글꼴 `C:/Windows/Fonts/NotoSans-BoldItalic.ttf`. 새 Windows에 같은 글꼴을 설치한다. 다른 글꼴로 대체하면 승인된 형태가 달라진다.
- Codex의 대화 이력, 앱 설정, 연결된 서비스와 프로젝트 밖의 개인 스킬. 이 Git 저장소에는 포함되어 있지 않다.
- API를 다시 사용하기로 한 경우에만 키를 비밀번호 관리자 등 안전한 경로로 이전한다. `.env.local`을 GitHub에 올리지 않는다.

`39220-25500_2.png`는 저장소에 포함된 승인 비교 이미지다. 앱의 `public/demo` 폴더에도 샘플 이미지가 포함된다. 작업규칙에 언급된 다른 승인 이미지도 보유하고 있으면 별도로 이전한다.

## 글꼴과 경로

`finalize_product_images.py`는 기본적으로 Windows 글꼴 경로를 사용한다. 다른 위치에 보관했다면 다음 환경 변수로 정확한 글꼴 파일을 지정한다.

```powershell
$env:KOREA_AUTOPARTS_FONT = 'D:/Fonts/NotoSans-BoldItalic.ttf'
py tools/finalize_product_images.py --help
```

전용 사진 추출 도구는 `-InputDir`로 새 원본 폴더를 지정한다. Codex에서 새 저장소 폴더를 프로젝트로 열고 `AGENTS.md`, `작업규칙.md`, `docs/WORKFLOW.md`를 읽게 한다. 이전 컴퓨터의 절대 경로를 그대로 재사용하지 않는다.

앱의 `.openai/hosting.json`은 실행 설정이 참조하는 비밀정보 없는 프로젝트 식별자와 바인딩 설정으로 저장소에 함께 보관한다. 기존 호스팅 프로젝트를 가리키므로 새 배포를 만들 때에만 별도로 검토한다. 이번 이전 작업에서는 배포하지 않는다.

## 이전 확인

규칙 문서와 도구가 있는지, 원본 사진 수가 일치하는지, 승인 글꼴이 설치됐는지 확인한다. 로컬 사본 한 장으로 1000 x 1000, 라벨 위치, 워터마크 형태·색상·264 px 폭을 승인 이미지와 비교한다. 음성·유료 API 시험은 하지 않는다.
