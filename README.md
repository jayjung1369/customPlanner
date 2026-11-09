# 광저우 웨딩 일정

Cloudflare Workers와 D1 데이터베이스로 실행하는 모바일 웹 일정표입니다.
GitHub Pages는 서버 API와 D1을 실행할 수 없어 지원하지 않습니다.

## GitHub에서 배포

1. Cloudflare 계정에서 Workers 사용을 활성화하고 workers.dev 서브도메인을 설정합니다.
2. GitHub 저장소 Settings → Secrets and variables → Actions에 다음 secrets를 등록합니다.
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare 계정 ID
   - `CLOUDFLARE_API_TOKEN`: 해당 계정의 Workers Scripts Edit, D1 Edit 권한을 가진 API 토큰
3. Actions → Deploy wedding planner → Run workflow를 실행합니다.

이후 main 브랜치에 push하면 자동 배포됩니다. 워크플로는
`customplanner-schedule` D1 데이터베이스를 없을 때만 생성하고 마이그레이션을 적용합니다.
배포 로그에 표시되는 `https://customplanner.<계정 서브도메인>.workers.dev` 주소로
휴대폰에서 접속합니다. `/admin`에서는 일정을 편집할 수 있습니다.

현재 코드에는 관리자 인증이 없습니다. 공개 배포 시 누구나 `/admin`과 쓰기 API를
사용할 수 있습니다. 편집을 제한하려면 별도 인증 구현이나 쓰기 API까지 보호하는
Cloudflare Access 구성이 필요합니다.

이 배포는 새 데이터베이스를 사용합니다. 기존 wedding.moaahub.com의 저장된 변경 사항은
자동 이전되지 않습니다. 기존 관리 페이지의 엑셀 내보내기와 새 사이트의 가져오기를
사용할 수 있습니다. 기존 도메인의 DNS와 배포 설정은 변경하지 않습니다.

## 빌드

Node.js 24에서 저장소 루트 기준 `node worker/build.mjs`를 실행합니다.
결과는 `dist/server/index.js`에 생성됩니다. 별도 npm 패키지 설치는 필요하지 않습니다.
배포 설정은 secrets가 있는 실행 환경에서 `node scripts/cloudflare-config.mjs`로 생성합니다.
토큰 값을 코드나 설정 파일에 저장하지 마세요.
