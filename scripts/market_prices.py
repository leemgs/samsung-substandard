#!/usr/bin/env python3
"""등외급 물품의 외부 쇼핑몰(기본: 쿠팡) 판매가를 조회해 docs/data/market_prices.json 에 저장한다.

- 쿠팡 **파트너스 공식 Open API**(상품 검색)만 사용한다. (웹페이지 스크래핑은 약관 위반이라 하지 않음)
- 모델명(예: LS27FG500SKXKR)으로 검색해, 상품명에 모델명이 들어 있는 결과 중 가장 싼 가격을 판매가로 쓴다.
- 키가 없으면 가격 조회를 건너뛰고(종료 코드 0) 링크↔모델 매핑만 갱신한다.
- source 가 "manual" 인 항목은 손으로 입력한 값이므로 덮어쓰지 않는다.

환경변수:
  COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY   쿠팡 파트너스 Open API 키 (GitHub Secrets)
  COUPANG_API_BASE                           (선택) 시험용 API 주소
옵션:
  --latest PATH  --out PATH  --ttl-hours N  --max-calls N  --delay SECONDS
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
MALL = "쿠팡"
API_BASE = os.environ.get("COUPANG_API_BASE", "https://api-gateway.coupang.com")
# 공식 문서의 경로는 v1 이 붙는 형태와 붙지 않는 형태가 함께 쓰여, 먼저 v1 을 시도하고 404 면 다른 쪽을 쓴다.
SEARCH_PATHS = [
    "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search",
    "/v2/providers/affiliate_open_api/apis/openapi/products/search",
]
MODEL_RE = re.compile(r"\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b", re.ASCII)
PRICE_RE = re.compile(r"([\d,]{4,})\s*원")
# 신제품 판매가가 아닌 상품(중고·리퍼·렌탈·전시·반품 등)은 비교 대상에서 뺀다
EXCLUDE_WORDS = ("중고", "리퍼", "렌탈", "렌트", "전시", "반품", "개봉", "임대")


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


# ---------------------------------------------------------------- 쿠팡 파트너스 API
def sign(method, path_and_query, access_key, secret_key, now=None):
    """Authorization 헤더 생성: HMAC-SHA256(시각 + 메서드 + 경로 + 쿼리)."""
    path, _, query = path_and_query.partition("?")
    ts = (now or datetime.now(timezone.utc)).strftime("%y%m%dT%H%M%SZ")
    message = ts + method + path + query
    signature = hmac.new(secret_key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"CEA algorithm=HmacSHA256, access-key={access_key}, signed-date={ts}, signature={signature}"


def search_products(keyword, access_key, secret_key, limit=10, _state={"path": None}):
    query = f"keyword={urllib.parse.quote(keyword)}&limit={limit}"
    paths = [_state["path"]] if _state["path"] else SEARCH_PATHS
    last = None
    for path in paths:
        target = f"{path}?{query}"
        for attempt in range(2):
            req = urllib.request.Request(API_BASE + target, method="GET", headers={
                "Authorization": sign("GET", target, access_key, secret_key),
                "Content-Type": "application/json;charset=UTF-8",
            })
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                _state["path"] = path
                return (body.get("data") or {}).get("productData") or []
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")[:200]
                if e.code == 429 and attempt == 0:      # 호출 제한: 잠시 쉬고 한 번 더
                    time.sleep(30)
                    continue
                last = ApiError(e.code, detail)
                break
        if last and last.status == 404 and path != paths[-1]:
            continue                                      # 다른 경로로 재시도
        break
    raise last or ApiError(0, "알 수 없는 오류")


def pick_price(products, codes, emp_price):
    """상품명에 모델명이 들어 있고, 액세서리로 보이는 지나치게 싼 결과를 뺀 최저가."""
    best = None
    for p in products:
        name = (p.get("productName") or "").upper()
        if not any(c.upper() in name for c in codes):
            continue
        if any(w in name for w in EXCLUDE_WORDS):
            continue
        price = p.get("productPrice")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        if emp_price and price < emp_price * 0.5:
            continue
        if best is None or price < best["price"]:
            best = {"price": int(price), "url": p.get("productUrl"), "name": p.get("productName"),
                    "rocket": bool(p.get("isRocket"))}
    return best


# ---------------------------------------------------------------- 메인
def now_kst():
    return datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--latest", default=str(ROOT / "docs" / "data" / "latest.json"))
    ap.add_argument("--out", default=str(ROOT / "docs" / "data" / "market_prices.json"))
    ap.add_argument("--ttl-hours", type=float, default=24)
    ap.add_argument("--max-calls", type=int, default=15)
    ap.add_argument("--delay", type=float, default=7.0, help="API 호출 간 대기(초). 검색 API 는 분당 10회 제한")
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

    access, secret = os.environ.get("COUPANG_ACCESS_KEY", "").strip(), os.environ.get("COUPANG_SECRET_KEY", "").strip()
    ttl = args.ttl_hours * 3600
    todo = [k for k in wanted
            if models.get(k, {}).get("source") != "manual"
            and time.time() - models.get(k, {}).get("ts", 0) > ttl]

    if not (access and secret):
        print(f"쿠팡 파트너스 키(COUPANG_ACCESS_KEY/SECRET_KEY)가 없어 가격 조회를 건너뜁니다. "
              f"(대상 모델 {len(wanted)}개, 갱신 필요 {len(todo)}개)")
        todo = []

    calls = found = missed = 0
    abort = False
    for key in todo:
        if abort:
            break
        codes, emp = wanted[key]
        entry = None
        errored = False
        searched = 0
        tries = codes[:2]
        for code in tries:                             # 후보 코드 최대 2개까지 시도
            if calls >= args.max_calls:
                break
            if calls:
                time.sleep(args.delay)
            calls += 1
            searched += 1
            try:
                entry = pick_price(search_products(code, access, secret), codes, emp)
            except ApiError as e:
                print(f"  ⚠️ {code}: {e}")
                errored = True
                if e.status in (401, 403):             # 인증 문제면 더 시도하지 않는다
                    print("  → 키/권한(쿠팡 파트너스 Open API 승인 여부)을 확인하세요. 나머지 조회를 중단합니다.")
                    abort = True
                break
            if entry:
                break
        if errored or (entry is None and searched < len(tries)):
            continue                                    # 오류·호출 한도로 후보를 다 못 본 항목은 기록하지 않고 다음 실행에 다시
        rec = {"price": entry["price"] if entry else None, "url": entry["url"] if entry else None,
               "name": entry["name"] if entry else None, "rocket": entry["rocket"] if entry else False,
               "mall": MALL, "source": "coupang-partners", "checked_at": now_kst(), "ts": int(time.time())}
        if entry or key not in models or models[key].get("price") is None:
            models[key] = rec
        else:                                           # 조회 실패 시 이전 가격은 유지하고 재시도 시각만 늦춘다
            models[key]["ts"] = rec["ts"]
        found += bool(entry)
        missed += not entry
        print(f"  {key}: " + (f"{entry['price']:,}원" if entry else "일치 결과 없음"))

    # 현재 목록에서 쓰이지 않는 자동 항목은 정리(수동 입력은 유지)
    used = set(links.values())
    models = {k: v for k, v in models.items() if k in used or v.get("source") == "manual"}

    data = {"mall": MALL, "updated_at": now_kst(), "models": models, "links": links}
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"판매가 갱신: 조회 {calls}회, 가격 확인 {found}건, 미확인 {missed}건 · "
          f"저장된 모델 {len(models)}개, 링크 {len(links)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
