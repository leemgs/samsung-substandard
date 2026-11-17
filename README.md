# 🛒 등외급몰 알리미 (samsung-substandard)

삼성전자 등외급 사내판매 사이트에 **매일 오후 1시 17분(KST)과 화요일 12:10~18:40(30분 간격)** GitHub Actions가 로그인하여,
등록한 키워드와 일치하는 **신규 물품**이 올라오면 **Gmail SMTP**로 메일을 보냅니다.

```
docs/ (GitHub Pages 웹앱: 키워드 관리·결과 확인)
  └─ docs/data/keywords.json ─▶ .github/workflows/familynet-alert.yml (cron 17 4 * * * = 매일 13:17 KST, 10,40 3-9 * * 2 = 화요일 12:10~18:40 KST)
                                   └─ scripts/check_items.py (Playwright 로그인 → 수집 → 매칭 → Gmail)
                                        └─ state/seen.json, docs/data/latest.json 자동 커밋
```

> **정기 등록 시간**: 등외급 제품은 **매주 화요일 오전 00:00 ~ 12:00**에 등록됩니다. 이 시간 동안에는 사이트가 **로그인 자체를 차단**(사이트 안내: "현재 등외급 상품 등재 기간입니다")하므로, 등재가 끝난 뒤인 오후 1시(KST)에 확인합니다. 화요일 12:00 이전에 수동 실행하면 로그인 차단 메시지와 함께 실패합니다.

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

> **자동 실행 참고**: GitHub `schedule` 은 정각에 몰려 지연·누락될 수 있어 `:17` 분으로 잡았습니다. 그래도 한 번 건너뛰면 Actions → Familynet Alert → Run workflow 로 수동 실행하세요.
