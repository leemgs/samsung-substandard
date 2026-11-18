# 🛒 등외급몰 알리미 (samsung-substandard)

삼성전자 등외급 사내판매 사이트에 **매일 오후 1시 17분(KST)과 화·목 12:10~18:40(30분 간격)** GitHub Actions가 로그인하여,
등록한 키워드와 일치하는 **신규 물품**이 올라오면 **Gmail SMTP**로 메일을 보냅니다.

```
docs/ (GitHub Pages 웹앱: 키워드 관리·결과 확인)
  └─ docs/data/keywords.json ─▶ .github/workflows/familynet-alert.yml (cron 17 4 * * * = 매일 13:17 KST, 10,40 3-9 * * 2,4 = 화·목 12:10~18:40 KST)
                                   └─ scripts/check_items.py (Playwright 로그인 → 수집 → 매칭 → Gmail)
                                        └─ state/seen.json, docs/data/latest.json 자동 커밋
```

> **정기 등록 시간**: 등외급 제품은 **매주 화·목 00:00 ~ 12:00**(파킹시간)에 등록됩니다. 이 시간 동안에는 사이트가 **로그인 자체를 차단**(사이트 안내: "현재 등외급 상품 등재 기간입니다")하므로, 등재가 끝난 뒤인 오후 1시(KST)에 확인합니다. 화·목 12:00 이전에 수동 실행하면 로그인 차단 메시지와 함께 실패합니다.

> **웹앱 메뉴** (`docs/`, GitHub Pages): 홈(대시보드) `index.html` · 관심 키워드 `keywords.html` · 확인 결과 `results.html` · 설정 `settings.html` · 운영 안내 `schedule.html` · 이용 가이드 `guide.html`. 공통 코드는 `docs/js/common.js`.
>
> **이용 가이드**: 등급(A/B/C)·구매 대상·수량 제한·문의처는 웹앱의 [`docs/guide.html`](docs/guide.html) (메인 화면의 "📖 등외급몰 이용 가이드" 링크)에서 볼 수 있습니다.

## 설정
1. **Secrets** (Settings → Secrets and variables → Actions)
   | 이름 | 설명 |
   | --- | --- |
   | `FAMILYNET_ID` / `FAMILYNET_PW` | 사내판매 사이트 계정 |
   | `GMAIL_APP_PASSWORD` | Gmail 앱 비밀번호 (2단계 인증 후 발급) |
   | `FAMILYNET_URL` | (선택) 사이트 주소. 기본값은 `config/site.json`의 `base_url` |
2. `config/email.json`에서 발신/수신 주소 수정.
3. **사이트 주소 확인**: 요청서의 `familynetk.r`은 오타로 보여 `https://www.familynet.kr`로 가정했습니다. 다르면 `FAMILYNET_URL` 또는 `config/site.json`을 수정하세요.
4. **Pages 켜기**: Settings → Pages → Branch `main`, 폴더 `/docs`.
5. 웹앱에서 **설정**에 저장소·토큰 등록 → **관심 키워드**에서 등록·저장(토큰 없이는 JSON 다운로드).

## 사이트 구조에 맞추기 (`config/site.json`)
사이트에 접속할 수 없는 환경에서 만들었기 때문에 로그인/목록 구조는 **자동 감지**(비밀번호 입력칸, 제출 버튼, `tr/li/article/.item…` 목록)로 시작합니다.
첫 실행이 실패하거나 결과가 이상하면 `login_url`, `user_selector`, `password_selector`, `submit_selector`, `list_urls`, `item_selector`, `next_page_selector`를 지정하세요.
실패 시 Actions의 `debug` 아티팩트(스크린샷/HTML)로 원인을 확인할 수 있습니다.

## 실행/점검
- Actions → *Familynet Alert* → Run workflow: `test_email`(SMTP 점검), `dry_run`(메일 없이 결과만).
- 키워드는 공백으로 나눈 단어가 **모두** 포함될 때 일치(대소문자 무시). 한 번 알린 물품은 `state/seen.json`으로 중복 발송하지 않습니다.
- 로컬: `pip install -r scripts/requirements.txt && playwright install chromium` 후 `python scripts/check_items.py --dry-run`.

> 참고: 사내 사이트가 GitHub 호스티드 러너(외부 IP)에서 접근 불가(사내망/VPN 전용)이면 self-hosted runner가 필요합니다.

> **자동 실행 참고**: GitHub `schedule` 은 정각에 몰려 지연·누락될 수 있어 `:17` 분으로 잡았습니다. 이 저장소에서는 `schedule` 실행이 아예 시작되지 않는 현상도 확인되었습니다(2026-11 기준). 그럴 때는 아래 **외부 스케줄러** 설정을 사용하세요.

## 외부 스케줄러로 안정적으로 실행하기 (권장)

GitHub Actions의 `schedule`(cron)은 부하에 따라 늦거나 건너뛰거나, 새 저장소에서는 아예 시작되지 않을 수 있습니다. 등외급 상품은 등재 후 몇 시간 안에 판매되므로, **외부 무료 스케줄러가 정해진 시각에 GitHub API로 워크플로를 직접 실행**하게 하면 가장 안정적입니다. 워크플로에는 이미 `workflow_dispatch`가 있어 코드 변경 없이 사용할 수 있습니다.

```
외부 스케줄러(cron-job.org 등) ──HTTP POST──▶ GitHub API ──▶ Familynet Alert 워크플로 실행 ──▶ 새 물품 메일
```

### 1단계. 실행 전용 토큰 만들기 (최소 권한)

GitHub → 우측 상단 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

| 항목 | 값 |
| --- | --- |
| Token name | `familynet-scheduler` (아무 이름) |
| Expiration | 90일~1년 (만료 전에 갱신하세요) |
| Repository access | **Only select repositories** → `samsung-substandard` 하나만 |
| Repository permissions | **Actions: Read and write** (그 외는 모두 No access. Metadata는 자동 Read) |

생성 직후 한 번만 보이는 토큰(`github_pat_...`)을 복사해 둡니다.

> ⚠️ 웹앱의 *설정* 페이지에 넣는 키워드 저장용 토큰(**Contents: Read and write**)과는 **별도 토큰**입니다. 권한을 섞지 말고 용도별로 따로 만드세요. 토큰은 스케줄러 설정과 본인만 보는 곳 외에는 저장소·README·이슈·채팅에 붙여넣지 마세요.

### 2단계. 호출이 되는지 먼저 확인 (터미널)

```bash
export GITHUB_TOKEN="github_pat_여기에_토큰"

curl -i -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches \
  -d '{"ref":"main"}'
```

- 응답 **`204`**(No Content, 예: `HTTP/2 204`)이 오면 성공입니다. 곧 Actions 탭에 새 실행이 나타납니다.
- ⚠️ 이 호출은 **실제 실행**입니다. 새로 올라온 물품이 있으면 **메일이 발송**됩니다. 메일 없이 시험하려면 본문을 `-d '{"ref":"main","inputs":{"dry_run":"true"}}'` 로 바꾸세요.
- `Content-Type: application/json` 헤더가 없으면 `415` 오류가 납니다.

### 3단계. cron-job.org에 등록

1. [cron-job.org](https://cron-job.org) 에서 무료 계정을 만듭니다. (다른 스케줄러도 같은 요청을 보내면 동일하게 동작합니다.)
2. **Create cronjob** 을 두 번 만듭니다. 공통 설정 (화면 문구는 서비스 업데이트로 달라질 수 있습니다):

| 항목 | 값 |
| --- | --- |
| URL | `https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches` |
| Time zone | **Asia/Seoul** (스케줄러의 시간대 설정을 KST로) |
| Advanced → Request method | **POST** |
| Advanced → Request body | `{"ref":"main"}` |
| Advanced → Headers | `Authorization: Bearer github_pat_...` / `Accept: application/vnd.github+json` / `X-GitHub-Api-Version: 2022-11-28` / `Content-Type: application/json` |
| 실패 알림 | 실패 시 이메일 알림을 켭니다 (HTTP 2xx 가 아니면 실패) |

3. 스케줄(KST):

| 작업 | 실행 시각 |
| --- | --- |
| **① 매일 확인** | 매일 **13:17** |
| **② 화·목 집중 확인** | 요일 **화·목**, 시 **12~18**, 분 **10, 40** (= 12:10, 12:40 … 18:10, 18:40) |

> ⛔ **화·목 00:00~12:00 에는 실행하지 마세요.** 등외급몰이 등재 시간(파킹시간)에 로그인을 막아 실행이 실패합니다. 위 스케줄은 모두 12시 이후입니다.

4. 스케줄러의 **Test run** 으로 한 번 실행해 보고, 응답 상태가 `204` 인지 확인합니다.

### 4단계. 동작 확인
- Actions → *Familynet Alert* 에 실행이 생기고, 이벤트가 `workflow_dispatch` 로 표시됩니다.
- 웹앱 **홈**의 "마지막 확인" 시각이 갱신됩니다. 오래되면 홈에 경고 배너가 뜹니다.

### 알아두기
- **중복 실행은 안전합니다.** 워크플로의 `concurrency` 설정으로 동시에 돌지 않고, 이미 알린 물품은 `state/seen.json` 으로 다시 알리지 않습니다. GitHub 자체 `schedule` 이 나중에 정상화되어도 문제없습니다. 원하면 워크플로의 `schedule` 항목을 지워 외부 스케줄러만 사용해도 됩니다.
- **내 PC/서버의 crontab** 으로도 같은 요청을 보낼 수 있습니다 (`TZ=Asia/Seoul` 기준):
  ```cron
  TZ=Asia/Seoul
  17 13 * * *       curl -s -o /dev/null -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Content-Type: application/json" https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches -d '{"ref":"main"}'
  10,40 12-18 * * 2,4  curl -s -o /dev/null -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Content-Type: application/json" https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches -d '{"ref":"main"}'
  ```
- **토큰 관리**: 만료일을 달력에 적어 두고, 유출이 의심되면 GitHub에서 즉시 폐기(Revoke) 후 새로 발급해 스케줄러의 헤더를 바꾸세요.

### 문제 해결
| 응답 | 원인과 조치 |
| --- | --- |
| `401 Bad credentials` | 토큰이 틀리거나 만료됨 → 새 토큰으로 교체 |
| `403 Resource not accessible by personal access token` | 토큰에 **Actions: Read and write** 가 없음 → 권한 수정 |
| `404 Not Found` | 저장소/워크플로 이름 오타, 또는 토큰이 이 저장소에 접근 권한 없음(권한이 없어도 404로 보임) |
| `415 Unsupported Media Type` | `Content-Type: application/json` 헤더 누락 |
| `422 Unprocessable` | 본문의 `ref` 가 없는 브랜치이거나 `inputs` 형식 오류 |
| 실행은 되는데 실패 | 로그에 "등재 기간" 이 보이면 화·목 12시 이전에 실행된 것입니다 → 시각 확인 |
