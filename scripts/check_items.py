#!/usr/bin/env python3
"""등외급 사내판매 사이트에 로그인해 키워드와 일치하는 신규 물품을 Gmail SMTP로 알린다.

환경변수:
  FAMILYNET_ID / FAMILYNET_PW  사이트 계정 (GitHub Secrets)
  GMAIL_APP_PASSWORD           Gmail 앱 비밀번호 (GitHub Secrets)
  FAMILYNET_URL                (선택) config/site.json 의 base_url 덮어쓰기
옵션:
  --dry-run      메일을 보내지 않고 결과만 출력 (state 도 갱신하지 않음)
  --test-email   SMTP 설정 점검용 테스트 메일만 발송
"""
import argparse
import hashlib
import html
import json
import os
import re
import smtplib
import sys
import time
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from urllib.parse import quote, urljoin

ROOT = Path(__file__).resolve().parent.parent
SITE_CFG = ROOT / "config" / "site.json"
MAIL_CFG = ROOT / "config" / "email.json"
KEYWORDS = ROOT / "docs" / "data" / "keywords.json"
LATEST = ROOT / "docs" / "data" / "latest.json"
SEEN = ROOT / "state" / "seen.json"
DEBUG_DIR = ROOT / "debug"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
KST = timezone(timedelta(hours=9))


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def norm(text):
    return re.sub(r"\s+", " ", text or "").strip()


def matches_keyword(text, keyword):
    """공백으로 나눈 모든 토큰이 (대소문자 무시) 포함되어야 일치."""
    low = text.lower()
    tokens = [t for t in keyword.lower().split() if t]
    return bool(tokens) and all(t in low for t in tokens)


# ---------------------------------------------------------------- 스크래핑
ALERT_SEL = ".layer-pop.active, #commonAlert.active, [role=alertdialog]"


def visible_alert_text(page):
    """화면을 덮고 있는 알림/안내 팝업의 문구를 반환 (없으면 None)."""
    from playwright.sync_api import Error as PlaywrightError

    try:
        loc = page.locator(ALERT_SEL).first
        if loc.count() > 0 and loc.is_visible():
            return norm(loc.inner_text(timeout=2000))[:300] or "(문구 없음)"
    except PlaywrightError:
        pass
    return None


def close_alert(page):
    """팝업의 확인/닫기 버튼을 눌러 닫는다. 닫았으면 True."""
    from playwright.sync_api import Error as PlaywrightError

    try:
        btn = page.locator(ALERT_SEL).first.locator("button, a.btn, [class*=close]").first
        if btn.count() > 0:
            btn.click(timeout=3000)
            page.wait_for_timeout(500)
            return visible_alert_text(page) is None
    except PlaywrightError:
        pass
    return False


def save_debug(page, user, pw):
    DEBUG_DIR.mkdir(exist_ok=True)
    page.screenshot(path=str(DEBUG_DIR / "error.png"), full_page=True)
    (DEBUG_DIR / "error.html").write_text(redact(page.content(), user, pw), encoding="utf-8")
    print("실패 당시 URL:", redact(page.url, user, pw))
    alert = visible_alert_text(page)
    if alert:
        print("실패 당시 팝업 문구:", redact(alert, user, pw))


def login(page, cfg, user, pw):
    from playwright.sync_api import TimeoutError as PlaywrightTimeout

    base = os.environ.get("FAMILYNET_URL") or cfg["base_url"]
    timeout = cfg.get("timeout_ms", 30000)
    page.goto(cfg.get("login_url") or base, timeout=timeout, wait_until="domcontentloaded")
    settle(page)

    pw_sel = cfg.get("password_selector") or "input[type=password]"
    pw_field = page.locator(pw_sel).first
    if pw_field.count() == 0:
        print("로그인 폼이 보이지 않습니다(이미 로그인된 상태일 수 있음).")
        return
    user_sel = cfg.get("user_selector")
    if user_sel:
        user_field = page.locator(user_sel).first
    else:  # 비밀번호 칸 앞에 있는 첫 텍스트 입력칸
        user_field = page.locator(
            "input[type=text], input[type=email], input:not([type])"
        ).first
    user_field.fill(user)
    pw_field.fill(pw)
    alert = visible_alert_text(page)
    if alert:
        print(f"로그인 전 팝업 감지: {redact(alert, user, pw)}")
        print("  → 팝업 닫기", "성공" if close_alert(page) else "실패")
    if cfg.get("submit_selector"):
        try:
            page.locator(cfg["submit_selector"]).first.click(timeout=10000)
        except PlaywrightTimeout:
            raise RuntimeError(
                "로그인 버튼 클릭이 막혔습니다. 팝업: " + (redact(visible_alert_text(page) or "알 수 없음", user, pw)))
    else:
        # 폼을 직접 submit 하지 않는다: GET 폼이면 계정이 URL 쿼리로 노출될 수 있음
        btn = page.get_by_role("button", name=re.compile("로그인|log\\s*in|sign\\s*in", re.I)).first
        if btn.count() == 0:
            btn = page.locator("button[type=submit], input[type=submit]").first
        if btn.count() > 0:
            btn.click()
        else:
            pw_field.press("Enter")
    wait_login_result(page, cfg, pw, pw_sel)


def settle(page, timeout=8000):
    """네트워크가 잠잠해질 때까지 잠시 대기하되, 계속 통신하는 페이지에서는 시간 초과를 무시한다."""
    from playwright.sync_api import TimeoutError as PlaywrightTimeout

    try:
        page.wait_for_load_state("networkidle", timeout=timeout)
    except PlaywrightTimeout:
        pass


def wait_login_result(page, cfg, pw, pw_sel):
    """로그인 처리(AJAX+리다이렉트)가 끝날 때까지 폴링하며 성공/거부/시간초과를 판정한다."""
    from playwright.sync_api import Error as PlaywrightError

    ok_sel = cfg.get("login_success_selector")
    deadline = time.time() + max(cfg.get("timeout_ms", 30000), 30000) / 1000
    shown = set()
    while time.time() < deadline:
        page.wait_for_timeout(500)
        try:
            if pw in page.url or quote(pw, safe="") in page.url or "pswd=" in page.url:
                raise RuntimeError("로그인 폼이 계정 정보를 URL 로 전송했습니다. submit_selector 를 지정하세요.")
            if page.locator("text=일치하지 않습니다 >> visible=true").count() > 0:
                rejected = True
            else:
                rejected = False
                # 로그인 후 뜨는 안내 팝업(예: 상품 등재 기간 안내)은 확인을 눌러 진행한다
                notice = visible_alert_text(page)
                if notice:
                    if notice not in shown:
                        shown.add(notice)
                        print(f"안내 팝업: {redact(notice, pw)}")
                    close_alert(page)
                    continue
                if ok_sel:
                    if page.locator(ok_sel).count() > 0:
                        return
                elif page.locator(pw_sel).count() == 0 or not page.locator(pw_sel).first.is_visible():
                    settle(page)
                    return
        except PlaywrightError:
            continue  # 페이지 전환 중 컨텍스트 소멸 → 다시 확인
        if rejected:
            raise RuntimeError(
                "로그인 거부: 사이트가 아이디/비밀번호 불일치를 응답했습니다. "
                "오류 5회 시 당일 접속이 제한되므로, 브라우저에서 직접 로그인되는지 확인 후 재실행하세요.")
    alert = visible_alert_text(page)
    raise RuntimeError("로그인 실패: 제한 시간 내에 로그인이 완료되지 않았습니다."
                       + (f" 팝업: {redact(alert, pw)}" if alert else " 계정/선택자를 확인하세요."))


EXTRACT_JS = """
(sel) => {
  const els = Array.from(document.querySelectorAll(sel));
  // 가장 안쪽 요소만 사용 (중첩 중복 방지)
  const leaf = els.filter(e => !els.some(o => o !== e && e.contains(o)));
  return leaf.map(e => {
    const a = e.querySelector('a[href]');
    const img = e.querySelector('img[src]');
    let image = img ? img.src : null;
    if (!image) {
      for (const n of e.querySelectorAll('*')) {
        const m = (n.getAttribute('style') || '').match(/url\\(["']?([^"')]+)/);
        if (m) { image = new URL(m[1], location.href).href; break; }
      }
    }
    return {
      text: (e.innerText || '').replace(/\\s+/g, ' ').trim(),
      link: a ? a.href : null,
      image,
    };
  }).filter(x => x.text.length > 0);
}
"""


def category_from_title(page):
    """페이지 제목 '세탁건조기 | 삼성 등외급몰' 에서 카테고리명('세탁건조기')을 얻는다."""
    try:
        name = page.title().split("|")[0].strip()
    except Exception:
        return None
    return name if name and name != "등외급몰" else None


def wait_list_ready(page, selector, empty_text, timeout):
    """상품이 나타나거나 '빈 목록' 안내문이 보일 때까지 대기. 'items' | 'empty' | 'timeout' 반환."""
    from playwright.sync_api import Error as PlaywrightError

    deadline = time.time() + timeout / 1000
    while time.time() < deadline:
        try:
            if page.locator(selector).count() > 0:
                page.wait_for_timeout(1000)  # 목록이 모두 그려질 시간
                return "items"
            if page.locator(f"text={empty_text} >> visible=true").count() > 0:
                return "empty"
        except PlaywrightError:
            pass
        page.wait_for_timeout(500)
    return "timeout"


def scrape_items(page, cfg):
    base = os.environ.get("FAMILYNET_URL") or cfg["base_url"]
    timeout = cfg.get("timeout_ms", 30000)
    entries = cfg.get("list_urls") or [page.url or base]
    selector = cfg.get("item_selector") or "tr, li, article"
    empty_text = cfg.get("empty_text") or "판매 가능한 상품이 없습니다"
    items = []
    for entry in entries:
        entry = {"url": entry} if isinstance(entry, str) else entry
        url, category = entry["url"], entry.get("category")
        if url != page.url:
            page.goto(urljoin(base, url), timeout=timeout, wait_until="domcontentloaded")
        for n in range(cfg.get("max_pages", 1)):
            state = wait_list_ready(page, selector, empty_text, timeout)
            found = page.evaluate(EXTRACT_JS, selector) if state != "empty" else []
            category = category or category_from_title(page)
            for f in found:
                f["category"] = category
            print(f"  [{category or '-'}] {page.url} (p{n + 1}) → {len(found)}개"
                  + (" (빈 목록)" if state == "empty" else ""))
            if state == "empty":
                break
            if not found:
                raise RuntimeError(
                    f"수집 0건: {page.url} 에서 item_selector({selector!r}) 와 일치하는 상품도, "
                    f"빈 목록 안내문({empty_text!r})도 찾지 못했습니다. 사이트 구조가 변경되었을 수 있습니다.")
            items.extend(found)
            nxt = cfg.get("next_page_selector")
            if not nxt or page.locator(nxt).count() == 0:
                break
            page.locator(nxt).first.click()
    uniq, seen = [], set()
    for it in items:
        k = (it.get("category"), it.get("link") or it["text"])
        if k not in seen:
            seen.add(k)
            uniq.append(it)
    return uniq


def redact(text, *secrets):
    """디버그 출력에서 계정/비밀번호(원문·URL 인코딩 포함)를 가린다."""
    for sec in secrets:
        for v in {sec, quote(sec, safe=""), quote(sec), quote(sec, safe="!~*'()")}:
            if v:
                text = text.replace(v, "***")
    return text


def run_scrape(cfg, user, pw):
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--no-sandbox"],
            executable_path=os.environ.get("CHROMIUM_PATH") or None,
        )
        page = browser.new_context(locale="ko-KR").new_page()
        try:
            login(page, cfg, user, pw)
            return scrape_items(page, cfg)
        except Exception:
            save_debug(page, user, pw)
            raise
        finally:
            browser.close()


# ---------------------------------------------------------------- 메일
def build_html(matches, checked_at):
    rows = []
    for m in matches:
        link = (f'<a href="{html.escape(m["link"])}">바로가기</a>' if m.get("link") else "-")
        img = (f'<img src="{html.escape(m["image"])}" width="80">' if m.get("image") else "")
        rows.append(
            "<tr>"
            f'<td style="padding:8px;border:1px solid #ddd">{html.escape(m["keyword"])}</td>'
            f'<td style="padding:8px;border:1px solid #ddd">{html.escape(m.get("category") or "-")}</td>'
            f'<td style="padding:8px;border:1px solid #ddd">{img}</td>'
            f'<td style="padding:8px;border:1px solid #ddd">{html.escape(m["text"])}</td>'
            f'<td style="padding:8px;border:1px solid #ddd">{link}</td>'
            "</tr>"
        )
    return (
        '<div style="font-family:sans-serif">'
        f"<h2>🛒 등외급몰 신규 물품 {len(matches)}건</h2>"
        f"<p>확인 시각: {checked_at}</p>"
        '<table style="border-collapse:collapse;font-size:14px">'
        "<tr><th>키워드</th><th>카테고리</th><th>이미지</th><th>물품 정보</th><th>링크</th></tr>"
        + "".join(rows)
        + "</table></div>"
    )


def send_mail(subject, html_body):
    mail = load_json(MAIL_CFG, {})
    password = os.environ.get("GMAIL_APP_PASSWORD")
    if not password:
        raise RuntimeError("GMAIL_APP_PASSWORD 가 설정되지 않았습니다.")
    recipients = mail.get("email_to") or [mail["smtp_user"]]
    # 웹앱에서 지정한 수신 주소가 있으면 우선 사용
    extra = load_json(KEYWORDS, {}).get("notify_email")
    if extra:
        valid = [r for r in re.split(r"[,;\s]+", extra) if EMAIL_RE.match(r)]
        if valid:
            recipients = valid
        else:
            print(f"경고: 웹앱 수신 이메일 '{extra}' 가 올바르지 않아 config/email.json 값을 사용합니다.")
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = mail.get("email_from") or mail["smtp_user"]
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    with smtplib.SMTP(mail.get("smtp_host", "smtp.gmail.com"), mail.get("smtp_port", 587), timeout=30) as s:
        s.starttls()
        s.login(mail["smtp_user"], password)
        s.sendmail(msg["From"], recipients, msg.as_string())
    print(f"메일 발송 완료 → {', '.join(recipients)}")


# ---------------------------------------------------------------- 메인
INSPECT_JS = """
() => {
  const vis = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const clip = (t, n) => (t || '').replace(/\\s+/g, ' ').trim().slice(0, n);
  const pag = Array.from(document.querySelectorAll(
    '[class*="pagin" i], [class*="paging" i], [id*="pagin" i], [id*="paging" i], nav[aria-label*="page" i]'));
  const more = Array.from(document.querySelectorAll('button, a')).filter(e =>
    /더\\s*보기|load\\s*more|show\\s*more|다음|next/i.test((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')) && vis(e));
  const total = Array.from(document.querySelectorAll('*')).filter(e =>
    e.children.length < 4 && /검색\\s*결과\\s*[\\d,]+\\s*개|총\\s*[\\d,]+\\s*개/.test(e.innerText || '')).map(e => clip(e.innerText, 60));
  return {
    pagination: pag.map(e => ({tag: e.tagName, id: e.id, cls: String(e.className), visible: vis(e),
                               text: clip(e.innerText, 120), html: clip(e.outerHTML, 700)})),
    more_buttons: more.map(e => ({tag: e.tagName, cls: String(e.className), text: clip(e.innerText, 40), html: clip(e.outerHTML, 300)})),
    total_texts: [...new Set(total)].slice(0, 5),
    category_links: [...new Set(Array.from(document.querySelectorAll('a[href]'))
      .filter(a => a.getAttribute('href').includes('/all-'))
      .map(a => clip(a.innerText, 30) + ' -> ' + a.getAttribute('href')))].slice(0, 60),
    page_height: document.documentElement.scrollHeight,
  };
}
"""


def run_inspect(cfg, user, pw):
    """읽기 전용 점검: 각 목록 페이지의 페이지 번호/더보기 구조와 총 개수 문구를 출력하고 스크린샷을 남긴다."""
    from playwright.sync_api import sync_playwright

    base = os.environ.get("FAMILYNET_URL") or cfg["base_url"]
    timeout = cfg.get("timeout_ms", 30000)
    selector = cfg.get("item_selector") or "tr, li, article"
    empty_text = cfg.get("empty_text") or "판매 가능한 상품이 없습니다"
    DEBUG_DIR.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"], executable_path=os.environ.get("CHROMIUM_PATH") or None)
        page = browser.new_context(locale="ko-KR", viewport={"width": 1280, "height": 900}).new_page()
        try:
            login(page, cfg, user, pw)
            DEBUG_DIR.mkdir(exist_ok=True)
            for i, entry in enumerate(cfg.get("list_urls") or []):
                entry = {"url": entry} if isinstance(entry, str) else entry
                page.goto(urljoin(base, entry["url"]), timeout=timeout, wait_until="domcontentloaded")
                state = wait_list_ready(page, selector, empty_text, timeout)
                info = page.evaluate(INSPECT_JS)
                info["items_on_page"] = page.locator(selector).count()
                info["state"] = state
                print(f"=== 점검 [{entry.get('category') or '-'}] {page.url}")
                print(redact(json.dumps(info, ensure_ascii=False, indent=1), user, pw))
                page.screenshot(path=str(DEBUG_DIR / f"inspect-{i}.png"), full_page=True)
        except Exception:
            save_debug(page, user, pw)
            raise
        finally:
            browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--test-email", action="store_true")
    ap.add_argument("--inspect", action="store_true",
                    help="읽기 전용: 목록 페이지의 페이지 번호/더보기 구조와 총 개수 문구를 출력")
    ap.add_argument("--baseline", action="store_true",
                    help="현재 일치 물품을 '이미 본 것'으로만 기록하고 메일은 보내지 않음")
    ap.add_argument("--preview-mail", action="store_true",
                    help="현재 일치 물품 최대 3건을 미리보기 메일로 발송 (상태 저장 안 함)")
    args = ap.parse_args()
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")

    if args.test_email:
        send_mail("[등외급몰 알림] 테스트 메일", f"<p>SMTP 설정이 정상입니다. ({now})</p>")
        return 0

    if args.inspect:
        user, pw = (os.environ.get("FAMILYNET_ID") or "").strip(), (os.environ.get("FAMILYNET_PW") or "").strip()
        if not user or not pw:
            print("FAMILYNET_ID / FAMILYNET_PW 가 설정되지 않았습니다.", file=sys.stderr)
            return 1
        run_inspect(load_json(SITE_CFG, {}), user, pw)
        return 0

    keywords = [k.strip() for k in load_json(KEYWORDS, {}).get("keywords", []) if k.strip()]
    if not keywords:
        print("등록된 키워드가 없습니다. docs 웹앱에서 키워드를 추가하세요.")
        return 0

    user, pw = (os.environ.get("FAMILYNET_ID") or "").strip(), (os.environ.get("FAMILYNET_PW") or "").strip()
    if not user or not pw:
        print("FAMILYNET_ID / FAMILYNET_PW 가 설정되지 않았습니다.", file=sys.stderr)
        return 1

    cfg = load_json(SITE_CFG, {})
    items = run_scrape(cfg, user, pw)
    print(f"수집한 항목 {len(items)}개, 키워드 {len(keywords)}개")

    seen = set(load_json(SEEN, {}).get("seen", []))
    found, new, found_keys = [], [], set()
    for it in items:
        for kw in keywords:
            if not matches_keyword(f'{it.get("category") or ""} {it["text"]}', kw):
                continue
            key = hashlib.sha1(f'{kw}|{norm(it["text"])}|{it.get("link")}'.encode()).hexdigest()
            if key in found_keys:  # 같은 상품이 여러 카테고리에 있어도 한 번만
                continue
            found_keys.add(key)
            rec = {"keyword": kw, "category": it.get("category"), "text": it["text"][:300],
                   "link": it.get("link"), "image": it.get("image"), "key": key}
            found.append(rec)
            if key not in seen:
                new.append(rec)

    status = f"정상 (수집 {len(items)}건, 일치 {len(found)}건, 신규 {len(new)}건)"
    print(status)
    if args.dry_run:
        print(json.dumps(new, ensure_ascii=False, indent=2))
        return 0

    if args.preview_mail:
        if not found:
            print("일치하는 물품이 없어 미리보기 메일을 보내지 않습니다.")
            return 0
        sample = found[:3]
        send_mail(f"[등외급몰 미리보기] 일치 물품 {len(found)}건 중 {len(sample)}건 (테스트)",
                  build_html(sample, now))
        return 0  # 상태(seen/latest)는 저장하지 않는다

    if args.baseline:
        seen.update(r["key"] for r in found)
        status += f" → 기준선 저장 ({len(found)}건, 메일 미발송)"
        print(status)
    elif new:
        send_mail(f"[등외급몰] 관심 물품 {len(new)}건 올라왔습니다", build_html(new, now))
        seen.update(r["key"] for r in new)

    # 게시판용 부가 정보: 최초 확인일(이전 기록 유지)과 이번 실행에서의 신규 여부
    prev_seen = {m.get("link"): m.get("first_seen") for m in load_json(LATEST, {}).get("matches", [])}
    today = datetime.now(KST).strftime("%Y-%m-%d")
    new_keys = set() if args.baseline else {r["key"] for r in new}
    for r in found:
        r["first_seen"] = prev_seen.get(r["link"]) or today
        r["is_new"] = r["key"] in new_keys

    SEEN.write_text(json.dumps({"seen": sorted(seen)}, ensure_ascii=False, indent=1), encoding="utf-8")
    LATEST.write_text(json.dumps(
        {"checked_at": now, "status": status,
         "matches": [{k: v for k, v in r.items() if k != "key"} for r in found]},
        ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
