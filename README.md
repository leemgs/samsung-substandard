# 🛒 등외급몰 알리미 (samsung-substandard)

삼성전자 등외급 사내판매 사이트에 **매일 오후 1시 17분(KST)과 화·목 12:10~18:10(1시간 간격)** GitHub Actions가 로그인하여,
등록한 키워드와 일치하는 **신규 물품**이 올라오면 **Gmail SMTP**로 메일을 보냅니다.

**주요 기능**
- 관심 키워드와 일치하는 **신규 물품 메일 알림** (카테고리명·물품명 모두 검사, 이미 알린 물품은 중복 발송 안 함)
- **웹앱**(GitHub Pages): 대시보드·키워드 관리·확인 결과(검색/필터/정렬)·운영 안내·이용 가이드
- **직원가 vs 판매가** 비교: 네이버 쇼핑/쿠팡 신제품 최저가와 할인율 표시 (선택, 키 등록 필요)

```
docs/ (GitHub Pages 웹앱: 키워드 관리·결과 확인)
  └─ docs/data/keywords.json ─▶ .github/workflows/familynet-alert.yml (cron 17 4 * * * = 매일 13:17 KST, 10 3-9 * * 2,4 = 화·목 12:10~18:10 KST)
                                   └─ scripts/check_items.py (Playwright 로그인 → 수집 → 매칭 → Gmail)
                                        └─ state/seen.json, docs/data/latest.json 자동 커밋
```

> **정기 등록 시간**: 등외급 제품은 **매주 화·목 00:00 ~ 12:00**(파킹시간)에 등록됩니다. 이 시간 동안에는 사이트가 **로그인 자체를 차단**(사이트 안내: "현재 등외급 상품 등재 기간입니다")하므로, 등재가 끝난 뒤인 오후 1시(KST)에 확인합니다. 화·목 12:00 이전에 수동 실행하면 로그인 차단 메시지와 함께 실패합니다.

> **웹앱 메뉴** (`docs/`, GitHub Pages): 홈(대시보드) `index.html` · 관심 키워드 `keywords.html` · 확인 결과 `results.html` · 설정 `settings.html` · 운영 안내 `schedule.html` · 이용 가이드 `guide.html`. 공통 코드는 `docs/js/common.js`.
>
> **이용 가이드**: 등급(A/B/C)·구매 대상·수량 제한·문의처는 웹앱의 [`docs/guide.html`](docs/guide.html) (메인 화면의 "📖 등외급몰 이용 가이드" 링크)에서 볼 수 있습니다.

## 설정
1. **Secrets** (Settings → Secrets and variables → Actions → **Secrets** 탭의 *Repository secrets*)
   | 이름 | 필수 | 설명 |
   | --- | --- | --- |
   | `FAMILYNET_ID` / `FAMILYNET_PW` | 필수 | 등외급몰 계정 (아이디는 사번). `FAMILYNET_ID` 는 Variables 에 있어도 읽지만 로그에 노출되니 Secrets 권장 |
   | `GMAIL_APP_PASSWORD` | 필수 | Gmail 앱 비밀번호 (2단계 인증 후 발급) |
   | `FAMILYNET_URL` | 선택 | 사이트 주소. 기본값은 `config/site.json`의 `base_url` |
   | `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 선택 | 네이버 쇼핑 검색 API 키 (판매가 표시) |
   | `COUPANG_ACCESS_KEY` / `COUPANG_SECRET_KEY` | 선택 | 쿠팡 파트너스 Open API 키 (판매가 표시) |
   | **Variables 탭** `MARKET_PROVIDERS` | 선택 | 판매가 공급자 순서 (예: `naver,coupang`) |

   > ⚠️ **등록 위치와 이름이 중요합니다.** *Variables*·*Codespaces*·*Dependabot* 탭에 넣거나 이름이 한 글자라도 다르면 워크플로가 값을 읽지 못합니다(로그에는 빈 값으로 보임).
2. `config/email.json`에서 발신/수신 주소 수정. (웹앱 **관심 키워드** 페이지에서 수신 이메일을 지정하면 그 주소를 우선 사용합니다.)
3. **사이트**는 `https://www.familynet.kr` 입니다(`config/site.json`의 `base_url`). 다르면 `FAMILYNET_URL` 또는 `config/site.json` 을 수정하세요.
4. **Pages 켜기**: Settings → Pages → Branch `main`, 폴더 `/docs`.
5. 웹앱에서 **설정**에 저장소·토큰 등록 → **관심 키워드**에서 등록·저장(토큰 없이는 JSON 다운로드).

## 사이트 설정 (`config/site.json`)
현재 값은 등외급몰(`https://www.familynet.kr`) 구조에 맞춰져 있습니다.

| 키 | 의미 (현재 값) |
| --- | --- |
| `login_url`, `user_selector`, `password_selector`, `submit_selector` | 로그인 화면과 입력칸·버튼 (`#inpUserAccount`, `#inpUserPassword`, `#loginBtn`) |
| `list_urls` | 확인할 카테고리 목록. `{"url": …, "category": "모니터"}` 형식이며 **카테고리명도 키워드 매칭에 쓰입니다.** 현재: 세탁건조기, 모니터, 에어컨 |
| `item_selector` | 상품 카드 선택자 (`.item-inner`) |
| `load_more_selector`, `max_more` | `더보기` 버튼(`#morePrd`)을 끝까지 눌러 전체 수집 |
| `empty_text` | 빈 카테고리 안내문 ("판매 가능한 상품이 없습니다") — 이 경우 0건을 정상으로 처리 |
| `next_page_selector`, `max_pages` | 페이지 이동형 목록용 (현재 미사용) |
| `timeout_ms` | 대기 시간 |

- **카테고리 추가**: 사이트 주소 규칙은 `/<이름>/all-<이름>/` 입니다(예: `…/air-conditioner/all-air-conditioner/`). Actions 의 `inspect` 실행 로그에 나오는 `category_links` 에서 주소를 찾아 `list_urls` 에 추가하세요.
- **안전장치**: 목록에서 상품도 빈 목록 안내문도 못 찾으면 실패 처리하고, 사이트에 표시된 "검색 결과 N개"보다 적게 수집하면 상태가 `주의 ⚠️` 로 표시됩니다.
- 실패하면 Actions 의 `debug` 아티팩트(스크린샷/HTML, 계정 정보 마스킹, 1일 보관)로 원인을 확인하세요. 로그인 직후 안내 팝업은 자동으로 닫고, 등재 시간(화·목 00~12시) 차단 팝업은 계정 정보를 보내기 전에 감지해 즉시 알려줍니다.

## 실행/점검
Actions → *Familynet Alert* → **Run workflow** 의 입력값:

| 입력 | 동작 |
| --- | --- |
| *(모두 비움)* | **실제 실행**: 신규 물품 메일 발송 + 상태 저장 + 판매가 갱신 |
| `dry_run` | 메일·상태 저장 없이 로그인·수집·매칭 결과만 확인 |
| `test_email` | SMTP 테스트 메일만 발송 |
| `preview_mail` | 현재 일치 물품 최대 3건을 "미리보기" 메일로 발송 (상태 저장 안 함) |
| `baseline` | 현재 일치 물품을 "이미 본 것"으로만 기록 (메일 없음). `baseline_categories`(예: `모니터,에어컨`)로 일부 카테고리만 처리 가능 |
| `inspect` | 읽기 전용 점검: `더보기`/페이지 구조, 총 개수, 카테고리 링크를 로그로 출력하고 스크린샷을 아티팩트로 저장 |

- 키워드는 공백으로 나눈 단어가 **모두** 포함될 때 일치(대소문자 무시)하며 물품명과 **카테고리명**을 함께 검사합니다. 한 번 알린 물품은 `state/seen.json` 으로 중복 발송하지 않습니다.
- 상태 저장(커밋)은 웹앱 키워드 저장 등과 동시에 겹쳐도 유실되지 않도록 **최대 5회 재시도**합니다.
- 로컬: `pip install -r scripts/requirements.txt && playwright install chromium` 후 `python scripts/check_items.py --dry-run`.

**데이터 파일**

| 파일 | 내용 |
| --- | --- |
| `docs/data/keywords.json` | 관심 키워드, 수신 이메일 (웹앱에서 저장) |
| `docs/data/latest.json` | 마지막 확인 결과 (웹앱 홈·확인 결과가 표시) |
| `docs/data/market_prices.json` | 판매가 조회 결과/캐시 (수동 입력 가능) |
| `state/seen.json` | 이미 알린 물품 (중복 방지) |

> 참고: 사내 사이트가 GitHub 호스티드 러너(외부 IP)에서 접근 불가(사내망/VPN 전용)이면 self-hosted runner가 필요합니다.

> **자동 실행 참고 (2026-11 실측)**: GitHub `schedule` 은 정각에 몰려 지연·누락될 수 있어 `:17`·`:10` 분으로 잡았습니다. 그래도 **11/18~19 이틀간 예정된 약 9회 중 3회만 시작**됐고, 시작 시각도 예정보다 크게 늦었습니다(예: 13:17 예정 → 21:59 KST). 등외급 상품은 등재 후 몇 시간 안에 팔리므로, 시각이 중요하면 아래 **외부 스케줄러** 설정을 사용하세요. 홈 화면의 "마지막 확인"이 오래되면 경고가 표시됩니다.

## 접근 제한 (접속 코드)

초대받은 사람만 보도록 웹앱에 간단한 접속 코드 입력 화면이 있습니다.

> ⚠️ **정적 사이트의 간단한 접근 제한이며, 민감정보 보호 목적이 아닙니다. 해시가 클라이언트에 노출되므로 진짜 보안 경계로 사용하지 마세요.**

- 구현: `docs/assets/site.js`의 `initAuth()` / `unlock()` (모든 페이지 `<head>`에서 로드)
- 설정: `docs/config/access.json`에는 접속 코드의 **SHA-256 해시만** 저장합니다(평문 없음).
- 동작: 입력한 코드를 브라우저에서 SHA-256으로 해시해 `codes[].digest`와 비교하고, 일치하면 `sessionStorage`에 허용 상태를 기록합니다. 탭/브라우저를 닫으면 다시 입력해야 하며, 화면 우측 하단 `🔒 잠그기`로 바로 잠글 수 있습니다.
- 설정을 읽지 못하면 **잠긴 채로** 둡니다. `"enabled": false`로 두면 공개됩니다.

코드 교체/추가:

```bash
printf '%s' '새코드' | sha256sum        # 또는: python scripts/access_digest.py
```

나온 64자리 값을 `docs/config/access.json`의 `codes`에 넣고 push 하세요. 코드를 바꾸면 기존 세션은 자동 무효가 됩니다(Pages 반영에 최대 약 10분).

한계(꼭 읽어주세요):
- 해시가 공개되므로 누구나 오프라인으로 대입 공격을 할 수 있습니다. 단어+숫자 4자리 같은 **짧고 흔한 코드는 쉽게 풀립니다** — 기본 코드는 임시값이니 길고 무작위한 코드로 교체하세요.
- `data/*.json`, `config/*.json` 등은 URL로 직접 받을 수 있어 화면 잠금과 무관하게 공개 상태입니다. 저장소가 public이면 소스도 공개입니다.
- `sessionStorage`는 개발자도구로 조작할 수 있습니다(화면 표시만 막을 뿐).

## 판매가 표시 — 직원가와 비교 (네이버 쇼핑 / 쿠팡)

웹앱 **확인 결과** 표에는 두 가지 가격이 나란히 표시됩니다.

| 컬럼 | 의미 |
| --- | --- |
| **직원가** | 등외급몰 혜택가 (사이트에 표시된 가격) |
| **판매가** | 외부 쇼핑몰 신제품 **최저가 참고값**(네이버 쇼핑 또는 쿠팡). 아래에 `네이버 최저가 · 직원가 −26%` 처럼 **판매가 대비 직원가가 몇 % 싼지**도 보여줍니다 |

- 판매가를 모르는 물품은 `-` 와 **쿠팡 검색 · 네이버 검색** 링크(모델명으로 검색)가 표시됩니다.
- 정렬에서 **할인율 높은순**을 고르면 판매가 대비 가장 싼 물품이 위로 올라옵니다.
- 판매가는 **참고용**입니다. 등외급 상품은 등급(A/B/C)·재고·옵션이 달라 신제품 가격과 직접 비교하기 어렵습니다.

### 공급자 (공식 API만 사용)
웹페이지를 긁는(스크래핑) 방식은 쓰지 않습니다. 키가 있는 공급자를 순서대로(기본 `쿠팡 → 네이버`) 시도하고, 가격을 찾은 첫 공급자의 값을 씁니다.

| 공급자 | 필요한 Secrets | 발급 난이도 |
| --- | --- | --- |
| **네이버 쇼핑 검색 API** (권장) | `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` | 개발자센터에서 앱 등록 후 바로 발급 |
| 쿠팡 파트너스 Open API | `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY` | 파트너스 **최종 승인**(채널 심사, 일부 안내에는 첫 매출 15만 원 조건)이 필요해 어려울 수 있음 |

### 네이버 쇼핑 검색 API 키 받기
1. [네이버 개발자센터](https://developers.naver.com) → **Application → 애플리케이션 등록** (네이버 로그인 필요).
2. 이용약관 동의 → **휴대폰 인증**(처음 한 번) → 애플리케이션 이름 입력.
3. **사용 API** 에서 **검색** 을 추가합니다. ⚠️ 이게 빠지면 호출 시 `403` 이 납니다.
4. **비로그인 오픈 API 서비스 환경**에서 환경을 추가하고 화면의 안내대로 정보를 입력한 뒤 **등록하기**.
5. **Application → 내 애플리케이션 → (앱 이름) → 개요** 탭에서 **Client ID / Client Secret** 을 확인합니다.
6. 저장소 **Settings → Secrets and variables → Actions → Secrets** 에 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 을 등록합니다.

- 공식 문서 기준 검색 API의 **하루 호출 한도는 25,000회**(클라이언트 아이디별 합산)이고, 이 프로젝트는 한 번 실행에 최대 80회만 호출합니다. 요금은 문서에 언급되어 있지 않으니 가입 화면의 안내를 확인하세요.
- 이 프로젝트는 **쇼핑 검색**(`/v1/search/shop.json`)을 씁니다. 네이버 클라우드의 *NAVER API HUB* 에는 쇼핑 검색(상품 가격) API 가 없고 쇼핑 *인사이트*(트렌드)만 있어, 개발자센터 방식만 해당됩니다.
- 개발자센터의 신규 애플리케이션 등록 가능 여부는 정책에 따라 바뀔 수 있으니 등록 화면에서 확인하세요.
- Client Secret 은 비밀번호처럼 다루세요. 노출이 의심되면 개발자센터에서 재발급합니다.

### 쿠팡 파트너스 키 (선택)
[쿠팡 파트너스](https://partners.coupang.com) 가입 후 **Open API** 이용을 신청하고 승인받아 Access Key / Secret Key 를 발급받습니다. 가입비·초기 비용은 없고 개인 유형으로 가입할 수 있다고 안내하는 글이 많지만(공식 약관은 확인하지 못했습니다), **API 는 최종 승인 뒤에 쓸 수 있고** 승인에는 활동 채널의 링크 심사가 필요하며 일부 안내에는 **2025-01 이후 첫 매출 15만 원 달성 조건**이 있다고 합니다. 가입 화면과 공식 FAQ 에서 현재 조건을 확인하세요. 키를 등록하면 `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY` Secrets 로 추가합니다.

### 키를 등록했는데 "건너뜁니다"가 나온다면
실행 로그의 판매가 단계(`Update market prices`)에서 아래처럼 나오면 키를 못 읽은 것입니다.

```
판매가 조회용 키가 없어 가격 조회를 건너뜁니다. …
  - 네이버: 비어 있는 환경변수 → NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
```

1. 키를 **Settings → Secrets and variables → Actions → `Secrets` 탭 → Repository secrets** 에 등록했는지 확인합니다. (`Variables`·`Codespaces`·`Dependabot` 탭은 인식되지 않습니다.)
2. 이름이 정확히 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` 인지 확인합니다. (대소문자, 밑줄, 앞뒤 공백)
3. 로그의 해당 단계 `env:` 블록에서 값이 있으면 `***`, 없으면 빈칸으로 표시됩니다.
4. 등록 후 **새로 실행**해야 반영됩니다(이미 끝난 실행은 바뀌지 않습니다).

### 공급자 순서 바꾸기
저장소 **Settings → Secrets and variables → Actions → Variables** 에 `MARKET_PROVIDERS` 를 만들고 값을 `naver,coupang`(네이버 우선) 또는 `naver`(네이버만)처럼 쉼표로 적습니다. 비워 두면 `coupang,naver` 입니다.

### 동작 방식과 한계
- 다음 **실제 실행**부터 `scripts/market_prices.py` 가 판매가를 조회해 `docs/data/market_prices.json` 에 저장하고 상태 커밋에 함께 올립니다. (`dry_run`·`test_email`·`inspect`·`preview_mail` 실행에서는 조회하지 않습니다.)
- 물품 설명에서 **모델명**(예: `LS27FG500SKXKR`)을 뽑아 검색하고, **상품명에 모델명이 들어 있는 결과만** 인정합니다. 못 찾으면 가격을 추측하지 않고 `-` 로 둡니다.
- 가장 싼 결과를 쓰되 **중고·리퍼·렌탈·전시·반품·개봉** 상품과 직원가의 **50% 미만**(액세서리로 간주)은 제외합니다. 네이버는 추가로 `exclude=used:rental:cbshop`(중고·렌탈·해외직구) 옵션을 쓰고, **일반상품(productType 1~3)** 만 인정합니다(중고·단종·판매예정 제외). `네이버 최저가` 는 가격비교 상품의 최저가, 몰 이름이 보이면 해당 몰의 가격입니다.
- 같은 모델은 **24시간 동안 재조회하지 않습니다.** 키가 없거나 오류가 나도 알림 실행은 **성공**으로 끝나며 로그에 이유만 남습니다. 인증 오류(401/403)나 네이버 일일 한도 초과(429)면 그 공급자의 나머지 조회를 중단하고 다음 실행에 이어서 합니다.
- 쿠팡 파트너스 링크가 표시되는 경우에만 **수수료 고지 문구**가 붙고 링크에 `rel="sponsored"` 가 적용됩니다.
- 한 번 실행에 네이버는 최대 80회, 쿠팡은 최대 15회만 조회하므로 물품이 많으면 **몇 번의 실행에 걸쳐 채워집니다**(조회하지 못한 모델은 다음 실행에서 이어서 조회).
- 로그의 `판매가 갱신: 조회 네이버 N회 · 가격 확인 N건 …` 줄로 동작 여부를 확인하세요. 실제 네이버 호출 결과의 정상 여부는 키 등록 후 첫 실행 로그로 확인해야 합니다.

### 수동으로 가격 입력하기 (키 없이)
`docs/data/market_prices.json` 의 `models` 에 직접 적으면 자동 조회가 덮어쓰지 않습니다. 키는 물품의 모델명입니다.

```json
{
  "models": {
    "LS27FG500SKXKR": { "price": 521000, "url": "https://www.coupang.com/vp/products/...", "mall": "쿠팡", "source": "manual" }
  }
}
```

## 외부 스케줄러로 안정적으로 실행하기 (권장)

GitHub Actions의 `schedule`(cron)은 부하에 따라 늦거나 건너뛸 수 있습니다(이 저장소에서는 이틀간 예정 약 9회 중 3회만, 최대 약 8시간 늦게 시작됐습니다). 등외급 상품은 등재 후 몇 시간 안에 판매되므로, **외부 무료 스케줄러가 정해진 시각에 GitHub API로 워크플로를 직접 실행**하게 하면 가장 안정적입니다. 워크플로에 이미 `workflow_dispatch`가 있어 **코드 변경 없이** 사용할 수 있습니다.

```
외부 스케줄러(cron-job.org) ──HTTP POST──▶ GitHub API ──▶ Familynet Alert 워크플로 실행 ──▶ 새 물품 메일
```

### 실행 시각 (모두 KST, 한국 시간)

| 작업 | 시각 | 이유 |
| --- | --- | --- |
| ① 매일 | **13:17** | 정각을 피해 지연·누락 방지 |
| ② 화·목 집중 확인 | **12:10, 13:10, 14:10 … 18:10** (1시간 간격) | 등재(00~12시) 직후 빠르게 팔리는 재고 확인 |

> ⛔ **화·목 00:00~12:00 에는 실행하지 마세요.** 등외급몰이 등재 시간(파킹시간)에 로그인을 막아 실행이 실패합니다. 위 시각은 모두 12시 이후입니다.

### 준비물
1. GitHub 계정(이 저장소 관리자) — **Actions 전용 토큰** 발급
2. [cron-job.org](https://cron-job.org) 무료 계정 — 다른 스케줄러도 같은 HTTP 요청을 보내면 동일하게 동작합니다.

### 1단계. 실행 전용 토큰 만들기 (최소 권한)

GitHub → 우측 상단 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

| 항목 | 값 |
| --- | --- |
| Token name | `familynet-scheduler` (아무 이름) |
| Expiration | 90일~1년 (만료 전에 갱신하세요) |
| Repository access | **Only select repositories** → `samsung-substandard` 하나만 |
| Repository permissions | **Actions: Read and write** (그 외는 모두 No access. Metadata는 자동 Read) |

생성 직후 한 번만 보이는 토큰(`github_pat_...`)을 복사해 둡니다.

> ⚠️ 웹앱 *설정* 페이지에 넣는 키워드 저장용 토큰(**Contents: Read and write**)과는 **별도 토큰**입니다. 권한을 섞지 말고 용도별로 따로 만드세요. 토큰은 스케줄러 설정 외에는 저장소·README·이슈·채팅에 붙여넣지 마세요.

### 2단계. 호출이 되는지 먼저 확인 (터미널)

먼저 **메일이 나가지 않는 `dry_run`** 으로 시험합니다.

```bash
export GITHUB_TOKEN="github_pat_여기에_토큰"

curl -i -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches \
  -d '{"ref":"main","inputs":{"dry_run":"true"}}'
```

- 응답 **`204`**(No Content, 예: `HTTP/2 204`)이면 성공입니다. 곧 Actions 탭에 `workflow_dispatch` 실행이 나타납니다.
- 스케줄러에 등록할 **실제 요청의 본문은 `{"ref":"main"}`** 입니다(`inputs` 없음 = 실제 실행, 새 물품이 있으면 **메일 발송**).
- `Content-Type: application/json` 헤더가 없으면 `415` 오류가 납니다.
- ⚠️ 이 호출은 **실제로 워크플로를 실행**합니다. 반드시 본인 토큰으로, 의도한 본문으로만 보내세요.

### 3단계. cron-job.org에 작업 2개 등록

공통 값:

| 항목 | 값 |
| --- | --- |
| URL | `https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches` |
| 요청 방식 | **POST** |
| 요청 본문 | `{"ref":"main"}` |
| 헤더 | `Authorization: Bearer github_pat_...` · `Accept: application/vnd.github+json` · `X-GitHub-Api-Version: 2022-11-28` · `Content-Type: application/json` |
| 시간대 | **Asia/Seoul** (KST) |
| 실패 알림 | 켜기 (실패하면 이메일로 알려줍니다) |
| 활성화 | **켜기** (⚠️ API로 만들 때 `enabled` 기본값은 `false` 입니다) |

작업별 스케줄:

| 작업 | 시 | 분 | 요일 |
| --- | --- | --- | --- |
| ① 매일 13:17 | 13 | 17 | 매일 |
| ② 화·목 집중 확인 | 12, 13, 14, 15, 16, 17, 18 | 10 | **화, 목** |

#### 방법 A. 웹 화면에서 직접 등록
cron-job.org 콘솔 → **Create cronjob** 에서 위 표의 값을 입력합니다. 요청 방식·헤더·본문은 *Advanced* 항목에 있습니다. (화면 문구는 서비스 업데이트로 달라질 수 있습니다.) 저장 후 **Test run** 으로 한 번 실행해 결과가 **성공(OK)** 인지 확인하세요.

#### 방법 B. API로 한 번에 등록 (복사해서 실행)
cron-job.org 콘솔 → **Settings → API** 에서 API 키를 만든 뒤 실행합니다. (필드는 [공식 REST API 문서](https://docs.cron-job.org/rest-api.html) 기준입니다. 요일은 `0=일 … 2=화 … 4=목`, `requestMethod: 1`=POST, `-1`=매번.)

```bash
export GITHUB_TOKEN="github_pat_..."     # 1단계에서 만든 Actions 전용 토큰
export CRONJOB_API_KEY="..."             # cron-job.org API 키
DISPATCH_URL="https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches"

create_job() {   # $1=제목  $2=시(JSON 배열)  $3=분  $4=요일(JSON 배열)
  curl -sS -X PUT https://api.cron-job.org/jobs \
    -H "Authorization: Bearer $CRONJOB_API_KEY" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{"job":{
  "title":"$1","url":"$DISPATCH_URL","enabled":true,"saveResponses":true,"requestMethod":1,
  "extendedData":{
    "headers":{"Authorization":"Bearer $GITHUB_TOKEN","Accept":"application/vnd.github+json",
               "X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},
    "body":"{\\"ref\\":\\"main\\"}"},
  "notification":{"onFailure":true},
  "schedule":{"timezone":"Asia/Seoul","expiresAt":0,"hours":$2,"mdays":[-1],"minutes":[$3],"months":[-1],"wdays":$4}
}}
EOF
  echo
}

create_job "등외급몰 알리미 - 매일 13:17"          "[13]"                    17 "[-1]"
sleep 15    # 작업 생성은 분당 5회로 제한됩니다
create_job "등외급몰 알리미 - 화·목 12:10~18:10"   "[12,13,14,15,16,17,18]"  10 "[2,4]"
```

- 각 호출이 `{"jobId": 숫자}` 를 돌려주면 등록된 것입니다. 같은 스크립트를 다시 실행하면 **작업이 중복 생성**되므로 한 번만 실행하세요(잘못 만들었으면 콘솔에서 삭제).
- 스케줄을 바꾸려면 콘솔에서 수정하거나 `PATCH https://api.cron-job.org/jobs/<jobId>` 로 `schedule` 만 보내면 됩니다.
- cron-job.org의 API는 기본 **하루 100회** 요청 제한이 있습니다(등록·조회 용도로는 충분합니다).

### 4단계. 동작 확인
- Actions → *Familynet Alert* 에 실행이 생기고 이벤트가 `workflow_dispatch` 로 표시됩니다.
- cron-job.org 작업 기록(History)에서 응답 상태가 `204` 인지 확인합니다. (기본 설정에서는 2xx 만 성공으로 처리합니다.)
- 웹앱 **홈**의 "마지막 확인" 시각이 갱신됩니다. 오래되면 홈과 확인 결과 화면에 경고가 뜹니다.

### 알아두기
- **중복 실행은 안전합니다.** 워크플로의 `concurrency` 설정으로 동시에 돌지 않고, 이미 알린 물품은 `state/seen.json` 으로 다시 알리지 않습니다. GitHub 자체 `schedule` 이 나중에 정상화되어도 문제없습니다. 원하면 워크플로의 `schedule` 항목을 지워 외부 스케줄러만 사용해도 됩니다.
- **같은 계정으로 사이트를 보고 계시다면** 알리미가 로그인할 때 **본인 화면이 로그아웃**될 수 있습니다(등외급몰 로그인 페이지에 "다른곳에서 로그인 하여 로그아웃 되었습니다" 처리가 있습니다). 간격을 너무 촘촘히 잡지 마세요.
- **내 PC/서버의 crontab** 으로도 같은 요청을 보낼 수 있습니다 (`TZ=Asia/Seoul` 기준):
  ```cron
  TZ=Asia/Seoul
  17 13 * * *       curl -s -o /dev/null -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Content-Type: application/json" https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches -d '{"ref":"main"}'
  10 12-18 * * 2,4  curl -s -o /dev/null -X POST -H "Accept: application/vnd.github+json" -H "Authorization: Bearer $GITHUB_TOKEN" -H "Content-Type: application/json" https://api.github.com/repos/leemgs/samsung-substandard/actions/workflows/familynet-alert.yml/dispatches -d '{"ref":"main"}'
  ```
- **토큰 관리**: 만료일을 달력에 적어 두고, 유출이 의심되면 GitHub에서 즉시 폐기(Revoke) 후 새로 발급해 스케줄러의 헤더를 바꾸세요. 이 토큰은 cron-job.org 에 저장되므로 **Actions 권한만, 이 저장소 하나만** 허용한 토큰을 쓰는 것이 중요합니다.
- **일시 중지/삭제**: 콘솔에서 작업을 끄거나 삭제하면 됩니다(`PATCH …/jobs/<jobId>` 로 `{"job":{"enabled":false}}`).

### 문제 해결
| 증상 | 원인과 조치 |
| --- | --- |
| GitHub `401 Bad credentials` | 토큰이 틀리거나 만료됨 → 새 토큰으로 교체 |
| GitHub `403 Resource not accessible by personal access token` | 토큰에 **Actions: Read and write** 가 없음 → 권한 수정 |
| GitHub `404 Not Found` | 저장소/워크플로 이름 오타, 또는 토큰이 이 저장소에 접근 권한 없음(권한이 없어도 404로 보임) |
| GitHub `415 Unsupported Media Type` | `Content-Type: application/json` 헤더 누락 |
| GitHub `422 Unprocessable` | 본문의 `ref` 가 없는 브랜치이거나 `inputs` 형식 오류 |
| cron-job.org API `401` / `403` / `429` | API 키 오류 / 허용 IP 제한 / 요청 제한(분당 5회·일 100회) 초과 → 잠시 후 재시도 |
| 작업이 실행되지 않음 | API로 만든 경우 `enabled` 가 `true` 인지, 시간대가 `Asia/Seoul` 인지 확인 |
| 실행은 되는데 워크플로가 실패 | 로그에 "등재 기간" 이 보이면 화·목 12시 이전에 실행된 것입니다 → 스케줄 시각 확인 |
