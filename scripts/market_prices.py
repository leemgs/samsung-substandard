#!/usr/bin/env python3
"""등외급 물품의 외부 쇼핑몰 판매가를 조회해 docs/data/market_prices.json 에 저장한다.

지원하는 공급자(공식 API만 사용 — 웹페이지 스크래핑은 하지 않는다):
  - coupang : 쿠팡 파트너스 Open API (상품 검색)      COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY
  - naver   : 네이버 쇼핑 검색 API (개발자센터)        NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
키가 있는 공급자만 순서대로(기본 "coupang,naver") 시도하고, 가격을 찾은 첫 공급자의 값을 쓴다.
키가 하나도 없으면 가격 조회를 건너뛰고(종료 코드 0) 링크↔모델 매핑만 갱신한다.

- 모델명(예: LS27FG500SKXKR)으로 검색해, 상품명에 모델명이 들어 있는 결과 중 가장 싼 가격을 판매가로 쓴다.
- 중고·리퍼·렌탈 등과 직원가의 50% 미만(액세서리로 간주)인 결과는 뺀다.
- source 가 "manual" 인 항목은 손으로 입력한 값이므로 덮어쓰지 않는다.

환경변수: MARKET_PROVIDERS(쉼표 구분, 기본 coupang,naver), COUPANG_API_BASE / NAVER_API_BASE(시험용 주소)
옵션: --latest PATH --out PATH --ttl-hours N --max-calls N --delay SEC --naver-max-calls N --naver-delay SEC
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))
COUPANG_BASE = os.environ.get("COUPANG_API_BASE", "https://api-gateway.coupang.com")
NAVER_BASE = os.environ.get("NAVER_API_BASE", "https://openapi.naver.com")
# 쿠팡 문서상의 경로는 v1 이 붙는 형태와 붙지 않는 형태가 함께 쓰여, 먼저 v1 을 시도하고 404 면 다른 쪽을 쓴다.
COUPANG_PATHS = [
    "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search",
    "/v2/providers/affiliate_open_api/apis/openapi/products/search",
]
MODEL_RE = re.compile(r"\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b", re.ASCII)
PRICE_RE = re.compile(r"([\d,]{4,})\s*원")
# 신제품 판매가가 아닌 상품(중고·리퍼·렌탈·전시·반품 등)은 비교 대상에서 뺀다
EXCLUDE_WORDS = ("중고", "리퍼", "렌탈", "렌트", "전시", "반품", "개봉", "임대")
TAG_RE = re.compile(r"<[^>]+>")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(f"HTTP {status}: {message}")
        self.status = status


# ---------------------------------------------------------------- 모델명/가격 추출
def model_codes(text):
    """물품 설명에서 모델명 후보를 뽑는다 (가격 앞부분만, 긴 것부터, 최대 3개)."""
    head = PRICE_RE.split(text or "")[0]
    seen, out = set(), []
    for m in MODEL_RE.findall(head):
        if m not in seen:
            seen.add(m)
            out.append(m)
    return sorted(out, key=len, reverse=True)[:3]


def employee_price(text):
    m = PRICE_RE.search(text or "")
    return int(m.group(1).replace(",", "")) if m else None


def pick_price(cands, codes, emp_price):
    """정규화된 후보 목록에서, 상품명에 모델명이 들어 있고 신제품으로 보이는 최저가를 고른다."""
    best = None
    for c in cands:
        name = (c.get("name") or "").upper()
        if not any(code.upper() in name for code in codes):
            continue
        if any(w in name for w in EXCLUDE_WORDS):
            continue
        price = c.get("price")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        if emp_price and price < emp_price * 0.5:      # 액세서리·부품으로 간주
            continue
        if best is None or price < best["price"]:
            best = {"price": int(price), "url": c.get("url"), "name": c.get("name"),
                    "mall": c.get("mall"), "rocket": bool(c.get("rocket"))}
    return best


# ---------------------------------------------------------------- 공급자 공통
class Provider:
    name = label = source = ""
    fatal = (401, 403)                                 # 이 상태 코드면 나머지 조회를 중단

    def __init__(self, delay, max_calls):
        self.delay, self.max_calls = delay, max_calls
        self.calls = 0
        self.aborted = False

    def configured(self):
        raise NotImplementedError

    def search(self, code):
        """정규화된 후보 [{name, price, url, mall, rocket}] 를 돌려준다."""
        raise NotImplementedError

    def hint(self):
        return ""

    def lookup(self, codes, emp_price):
        """(entry 또는 None, 확정 여부). 확정 여부가 False 면 오류·호출 한도라 '없음'으로 기록하면 안 된다."""
        tries = codes[:2]                              # 후보 코드 최대 2개까지 시도
        for code in tries:
            if self.aborted or self.calls >= self.max_calls:
                return None, False
            if self.calls:
                time.sleep(self.delay)
            self.calls += 1
            try:
                cands = self.search(code)
            except ApiError as e:
                print(f"  ⚠️ [{self.label}] {code}: {e}")
                if e.status in self.fatal:
                    self.aborted = True
                    print(f"  → [{self.label}] {self.hint()} 나머지 조회를 중단합니다.")
                return None, False
            entry = pick_price(cands, codes, emp_price)
            if entry:
                entry["source"] = self.source
                entry["mall"] = entry.get("mall") or self.label
                return entry, True
        return None, True


def http_json(url, headers):
    req = urllib.request.Request(url, method="GET", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode("utf-8", "replace")[:200])
    except urllib.error.URLError as e:
        raise ApiError(0, str(e.reason))


# ---------------------------------------------------------------- 쿠팡 파트너스
def coupang_sign(method, path_and_query, access_key, secret_key, now=None):
    """Authorization 헤더 생성: HMAC-SHA256(시각 + 메서드 + 경로 + 쿼리)."""
    path, _, query = path_and_query.partition("?")
    ts = (now or datetime.now(timezone.utc)).strftime("%y%m%dT%H%M%SZ")
    message = ts + method + path + query
    signature = hmac.new(secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"CEA algorithm=HmacSHA256, access-key={access_key}, signed-date={ts}, signature={signature}"


class Coupang(Provider):
    name, label, source = "coupang", "쿠팡", "coupang-partners"

    def __init__(self, delay, max_calls):
        super().__init__(delay, max_calls)
        self.access = os.environ.get("COUPANG_ACCESS_KEY", "").strip()
        self.secret = os.environ.get("COUPANG_SECRET_KEY", "").strip()
        self.path = None

    def configured(self):
        return bool(self.access and self.secret)

    def hint(self):
        return "키/권한(쿠팡 파트너스 Open API 승인 여부)을 확인하세요."

    def search(self, code):
        query = f"keyword={urllib.parse.quote(code)}&limit=10"
        last = None
        for path in ([self.path] if self.path else COUPANG_PATHS):
            target = f"{path}?{query}"
            for attempt in range(2):
                try:
                    body = http_json(COUPANG_BASE + target, {
                        "Authorization": coupang_sign("GET", target, self.access, self.secret),
                        "Content-Type": "application/json;charset=UTF-8"})
                except ApiError as e:
                    if e.status == 429 and attempt == 0:       # 호출 제한: 잠시 쉬고 한 번 더
                        time.sleep(30)
                        continue
                    last = e
                    break
                self.path = path
                items = (body.get("data") or {}).get("productData") or []
                return [{"name": p.get("productName"), "price": p.get("productPrice"), "url": p.get("productUrl"),
                         "mall": self.label, "rocket": p.get("isRocket")} for p in items]
            if last and last.status == 404 and path != COUPANG_PATHS[-1] and not self.path:
                continue                                        # 다른 경로로 재시도
            break
        raise last or ApiError(0, "알 수 없는 오류")


# ---------------------------------------------------------------- 네이버 쇼핑 검색
class Naver(Provider):
    name, label, source = "naver", "네이버", "naver-shopping"
    fatal = (401, 403, 429)                            # 429 = 하루 호출 한도(25,000회) 초과

    def __init__(self, delay, max_calls):
        super().__init__(delay, max_calls)
        self.cid = os.environ.get("NAVER_CLIENT_ID", "").strip()
        self.secret = os.environ.get("NAVER_CLIENT_SECRET", "").strip()

    def configured(self):
        return bool(self.cid and self.secret)

    def hint(self):
        return "Client ID/Secret 과, 개발자센터 내 애플리케이션의 '사용 API'에 [검색]이 추가돼 있는지(403), 일일 한도(429)를 확인하세요."

    def search(self, code):
        # 공식 문서: GET /v1/search/shop.json, 헤더 X-Naver-Client-Id/Secret, exclude=used:rental:cbshop
        url = (f"{NAVER_BASE}/v1/search/shop.json?query={urllib.parse.quote(code)}"
               f"&display=30&sort=sim&exclude=used:rental:cbshop")
        body = http_json(url, {"X-Naver-Client-Id": self.cid, "X-Naver-Client-Secret": self.secret})
        out = []
        for it in body.get("items") or []:
            try:
                ptype = int(it.get("productType") or 0)
                price = int(it.get("lprice") or 0)
            except (TypeError, ValueError):
                continue
            if ptype not in (1, 2, 3):                  # 일반상품만 (4~6 중고, 7~9 단종, 10~12 판매예정 제외)
                continue
            mall = (it.get("mallName") or "").strip()
            # 가격비교 상품(1)이거나 몰 정보가 없으면 '네이버 최저가', 아니면 해당 쇼핑몰 이름
            label = "네이버 최저가" if ptype == 1 or mall in ("", "네이버") else mall
            out.append({"name": TAG_RE.sub("", it.get("title") or ""), "price": price,
                        "url": it.get("link"), "mall": label})
        return out


PROVIDERS = {"coupang": Coupang, "naver": Naver}


# ---------------------------------------------------------------- 메인
def now_kst():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--latest", default=str(ROOT / "docs" / "data" / "latest.json"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "data" / "market_prices.json"))
    ap.add_argument("--ttl-hours", type=float, default=24)
    ap.add_argument("--max-calls", type=int, default=15, help="쿠팡: 한 번 실행에 보낼 최대 호출 수")
    ap.add_argument("--delay", type=float, default=7.0, help="쿠팡: 호출 간 대기(초). 호출 제한을 피하기 위한 간격")
    ap.add_argument("--naver-max-calls", type=int, default=80, help="네이버: 한 번 실행에 보낼 최대 호출 수")
    ap.add_argument("--naver-delay", type=float, default=0.3, help="네이버: 호출 간 대기(초)")
    args = ap.parse_args()

    latest = json.loads(Path(args.latest).read_text(encoding="utf-8"))
    out_path = Path(args.out)
    try:
        data = json.loads(out_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    models = data.get("models") or {}

    # 링크 → 대표 모델명, 모델명 → (후보 코드, 직원가)
    links, wanted = {}, {}
    for m in latest.get("matches", []):
        codes = model_codes(m.get("text"))
        if not codes or not m.get("link"):
            continue
        links[m["link"]] = codes[0]
        wanted.setdefault(codes[0], (codes, employee_price(m.get("text"))))

    order = [n.strip() for n in (os.environ.get("MARKET_PROVIDERS") or "coupang,naver").split(",") if n.strip()]
    limits = {"coupang": (args.delay, args.max_calls), "naver": (args.naver_delay, args.naver_max_calls)}
    providers = []
    for n in order:
        if n not in PROVIDERS:
            print(f"알 수 없는 공급자 '{n}' 은(는) 무시합니다.")
            continue
        p = PROVIDERS[n](*limits[n])
        if p.configured():
            providers.append(p)

    ttl = args.ttl_hours * 3600
    todo = [k for k in wanted
            if models.get(k, {}).get("source") != "manual"
            and time.time() - models.get(k, {}).get("ts", 0) > ttl]
    if not providers:
        print("판매가 조회용 키가 없어 가격 조회를 건너뜁니다. "
              "(쿠팡: COUPANG_ACCESS_KEY/SECRET_KEY, 네이버: NAVER_CLIENT_ID/SECRET) "
              f"대상 모델 {len(wanted)}개, 갱신 필요 {len(todo)}개")
        todo = []

    found = missed = 0
    for key in todo:
        if all(p.aborted for p in providers):
            break
        codes, emp = wanted[key]
        entry, conclusive = None, True
        for p in providers:                             # 설정된 공급자를 순서대로, 가격을 찾으면 중단
            entry, ok = p.lookup(codes, emp)
            if entry:
                break
            conclusive = conclusive and ok
        if not entry and not conclusive:
            continue                                    # 오류·호출 한도로 다 못 본 항목은 기록하지 않고 다음 실행에 다시
        rec = {"price": entry["price"] if entry else None, "url": entry["url"] if entry else None,
               "name": entry["name"] if entry else None, "rocket": entry["rocket"] if entry else False,
               "mall": entry["mall"] if entry else None, "source": entry["source"] if entry else "none",
               "checked_at": now_kst(), "ts": int(time.time())}
        if entry or key not in models or models[key].get("price") is None:
            models[key] = rec
        else:                                           # 조회 실패 시 이전 가격은 유지하고 재시도 시각만 늦춘다
            models[key]["ts"] = rec["ts"]
        found += bool(entry)
        missed += not entry
        print(f"  {key}: " + (f"{entry['price']:,}원 ({entry['mall']})" if entry else "일치 결과 없음"))

    # 현재 목록에서 쓰이지 않는 자동 항목은 정리(수동 입력은 유지)
    used = set(links.values())
    models = {k: v for k, v in models.items() if k in used or v.get("source") == "manual"}

    data = {"mall": "쿠팡·네이버", "updated_at": now_kst(), "models": models, "links": links}
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    calls = ", ".join(f"{p.label} {p.calls}회" for p in providers) or "없음"
    print(f"판매가 갱신: 조회 {calls} · 가격 확인 {found}건, 미확인 {missed}건 · "
          f"저장된 모델 {len(models)}개, 링크 {len(links)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
