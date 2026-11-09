# 별도 호스팅 배포 준비

기준 main: fdd8d443273135982e51e9b91fe7f3e23a4689ab
후보 주소: https://wedding-cn.moaahub.com

이 서버는 기존 UI와 엑셀 기능을 제공하고 /api/schedule만
https://wedding.moaahub.com/api/schedule로 전달한다.
DB, 마이그레이션, 캐시, 실패 시 대체 저장소를 만들지 않는다.
기존 Sites 프로젝트와 DNS는 수정하지 않는다.

## 서버에서 먼저 검증

홍콩/싱가포르 등 선택한 실제 호스팅 서버에서 다음을 실행한다.

    curl --fail-with-body --max-time 25 https://wedding.moaahub.com/api/schedule

정상 JSON의 days, memo 구조와 운영 일정을 확인한다.
읽기 검증만으로 저장 성공이나 DB 바인딩 자체가 증명되지는 않는다.

## 실행

저장소 루트에서:

    docker build -f china/Dockerfile -t wedding-cn .
    docker run -d --restart unless-stopped --name wedding-cn \
      -e PUBLIC_ORIGIN=https://wedding-cn.moaahub.com \
      -p 127.0.0.1:8080:8080 wedding-cn

서버의 HTTPS 리버스 프록시를 localhost:8080에 연결한다.
wedding-cn.moaahub.com의 새 DNS 레코드만 추가하고 TLS 인증서를 발급한다.
기존 wedding.moaahub.com 레코드는 유지한다.
기존 .github/workflows 배포는 별도 D1을 만들므로 이 배포에 실행하지 않는다.

## 쓰기와 인증

브라우저 PUT/POST는 PUBLIC_ORIGIN과 일치하는 Origin을 요구한다.
서버는 upstream Origin을 설정하고 JSON 본문을 그대로 전송한다.
기존 UI의 revision 기반 충돌 처리, 엑셀 POST, HTTP 상태를 유지한다.
리다이렉트를 따르지 않고 비JSON 응답/통신 실패는 502로 반환한다.
쓰기 요청을 자동 재시도하지 않는다.

현재 기존 API는 별도 쓰기 인증 없이 같은 Origin 헤더를 허용한다.
Origin 검사는 사용자 인증이 아니며 기존 공개 편집 권한을 그대로 따른다.
향후 서버 간 bearer 인증이 필요하면 기존 Sites에 서버 전용 인증 경로를
추가하되 기존 브라우저 저장 경로를 유지해야 한다. 토큰은 양쪽 배포의
secret 저장소에만 두고 소스, Docker 이미지, 브라우저에는 넣지 않는다.
현재 구현은 검증되지 않은 토큰이나 Sites 세션을 사용하지 않는다.

## 현재 확인한 범위

2026-11-09 작업 환경에서:
- 기존 GET: 200, 48개 일정 셀 중 36개에 저장 revision 존재
- 로컬 추가 서버 GET: 200, 운영 API 스냅샷과 JSON 동일
- /, /admin, 엑셀 스크립트와 템플릿: 200
- 다른 Origin의 쓰기: 403
- 후보 Origin의 쓰기 중계: 실제 값 변경 없는 불일치 revision으로 409
- 시험 전후 일정 JSON 동일

실제 추가 호스팅 서버에서의 연결, 정상 저장 200, 양방향 저장 반영,
DNS/TLS, 중국 본토 무VPN 접속은 아직 확인하지 않았다.
실제 저장 시험은 배포 후 비어 있는 셀을 선정하고 최신 revision으로
표식을 저장한 다음 양쪽 GET으로 확인하고 최신 revision으로 복구한다.
동시 편집으로 409가 나오면 다른 사용자의 내용을 덮어쓰지 않는다.

현재 화면의 자동 새로고침은 기존과 동일하게 30초 간격이다.
두 사이트는 요청 시 같은 운영 DB를 조회하며 실시간 push 방식은 아니다.

중국 본토에서는 VPN을 끈 실제 통신사/가정망에서 루트와 /admin,
GET/PUT/POST, 엑셀, DNS/TLS 및 개발자 도구의 외부 요청 여부를 점검한다.
해외 서버에서의 접속 성공은 본토 접속 보장이 아니다.

## Render에서 GitHub 자동 배포

루트 render.yaml은 무료 플랜, Singapore, main 자동 배포를 지정한다.
Render 로그인 후 아래 Blueprint 링크에서 저장소를 연결하고 생성한다.

https://dashboard.render.com/select-repo?type=blueprint

저장소: https://github.com/jayjung1369/customPlanner

계정 연결과 서비스 생성은 Render 대시보드에서 필요하다.
기존 Cloudflare 워크플로의 main 자동 실행은 제거하고 수동 실행만 남긴다.
이 워크플로는 별도 DB 생성 경로이므로 이번 작업에는 수동 실행도 하지 않는다.

첫 배포에서는 PUBLIC_ORIGIN을 지정하지 않는다. Render가 제공하는
RENDER_EXTERNAL_URL을 사용하므로 임시 onrender.com 주소에서도 저장할 수 있다.
/healthz는 실제 서버에서 운영 API를 읽어 일정 JSON 구조를 검증하며,
운영 API 연결 실패 시 정상 상태를 반환하지 않는다.
이 검사는 본토 접근이나 실제 저장 성공을 증명하지 않는다.

Custom Domains에 wedding-cn.moaahub.com을 등록하고 Render가 제시하는
DNS 레코드를 추가한다. TLS 준비 후 PUBLIC_ORIGIN 환경 변수에
https://wedding-cn.moaahub.com을 설정하여 재배포한다.
이후 임시 Render 주소로 보내는 쓰기는 Origin 검사에서 차단된다.

Render 무료 플랜의 절전/사용량 제한은 현재 계정의 플랜 화면에서 확인한다.
무료 플랜은 상시 가동이나 중국 본토 접근을 보장하지 않는다.
