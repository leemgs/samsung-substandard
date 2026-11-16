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
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from urllib.parse import urljoin

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
def login(page, cfg, user, pw):
    base = os.environ.get("FAMILYNET_URL") or cfg["base_url"]
    timeout = cfg.get("timeout_ms", 30000)
    page.goto(cfg.get("login_url") or base, timeout=timeout, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle", timeout=timeout)

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
    if cfg.get("submit_selector"):
        page.locator(cfg["submit_selector"]).first.click()
    else:
        btn = page.locator(
            "form:has(input[type=password]) :is(button[type=submit], input[type=submit], button:not([type]))"
        ).first
        if btn.count() > 0:
            btn.click()
        else:  # 제출 버튼이 없는 폼
            if pw_field.evaluate("e => !!e.form"):
                pw_field.evaluate("e => e.form.requestSubmit()")
            else:
                pw_field.press("Enter")
    page.wait_for_timeout(1500)  # 제출 직후 페이지 전환 레이스 방지
    page.wait_for_load_state("networkidle", timeout=timeout)

    ok_sel = cfg.get("login_success_selector")
    if ok_sel:
        page.wait_for_selector(ok_sel, timeout=timeout)
    elif page.locator(pw_sel).count() > 0 and page.locator(pw_sel).first.is_visible():
        raise RuntimeError("로그인 실패: 비밀번호 입력칸이 계속 보입니다. 계정/선택자를 확인하세요.")


EXTRACT_JS = """
(sel) => {
  const els = Array.from(document.querySelectorAll(sel));
  // 가장 안쪽 요소만 사용 (중첩 중복 방지)
  const leaf = els.filter(e => !els.some(o => o !== e && e.contains(o)));
  return leaf.map(e => {
    const a = e.querySelector('a[href]');
    const img = e.querySelector('img[src]');
    return {
      text: (e.innerText || '').replace(/\\s+/g, ' ').trim(),
      link: a ? a.href : null,
      image: img ? img.src : null,
    };
  }).filter(x => x.text.length > 0);
}
"""


def scrape_items(page, cfg):
    base = os.environ.get("FAMILYNET_URL") or cfg["base_url"]
    timeout = cfg.get("timeout_ms", 30000)
    urls = cfg.get("list_urls") or [page.url or base]
    selector = cfg.get("item_selector") or "tr, li, article"
    items = []
    for url in urls:
        if url != page.url:
            page.goto(urljoin(base, url), timeout=timeout, wait_until="domcontentloaded")
        for n in range(cfg.get("max_pages", 1)):
            page.wait_for_load_state("networkidle", timeout=timeout)
            items.extend(page.evaluate(EXTRACT_JS, selector))
            nxt = cfg.get("next_page_selector")
            if not nxt or page.locator(nxt).count() == 0:
                break
            page.locator(nxt).first.click()
    return items


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
            DEBUG_DIR.mkdir(exist_ok=True)
            page.screenshot(path=str(DEBUG_DIR / "error.png"), full_page=True)
            (DEBUG_DIR / "error.html").write_text(page.content(), encoding="utf-8")
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
        "<tr><th>키워드</th><th>이미지</th><th>물품 정보</th><th>링크</th></tr>"
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
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--test-email", action="store_true")
    args = ap.parse_args()
    now = datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")

    if args.test_email:
        send_mail("[등외급몰 알림] 테스트 메일", f"<p>SMTP 설정이 정상입니다. ({now})</p>")
        return 0

    keywords = [k.strip() for k in load_json(KEYWORDS, {}).get("keywords", []) if k.strip()]
    if not keywords:
        print("등록된 키워드가 없습니다. docs 웹앱에서 키워드를 추가하세요.")
        return 0

    user, pw = os.environ.get("FAMILYNET_ID"), os.environ.get("FAMILYNET_PW")
    if not user or not pw:
        print("FAMILYNET_ID / FAMILYNET_PW 가 설정되지 않았습니다.", file=sys.stderr)
        return 1

    cfg = load_json(SITE_CFG, {})
    items = run_scrape(cfg, user, pw)
    print(f"수집한 항목 {len(items)}개, 키워드 {len(keywords)}개")

    seen = set(load_json(SEEN, {}).get("seen", []))
    found, new = [], []
    for it in items:
        for kw in keywords:
            if not matches_keyword(it["text"], kw):
                continue
            key = hashlib.sha1(f'{kw}|{norm(it["text"])}|{it.get("link")}'.encode()).hexdigest()
            rec = {"keyword": kw, "text": it["text"][:300], "link": it.get("link"),
                   "image": it.get("image"), "key": key}
            found.append(rec)
            if key not in seen:
                new.append(rec)

    status = f"정상 (수집 {len(items)}건, 일치 {len(found)}건, 신규 {len(new)}건)"
    print(status)
    if args.dry_run:
        print(json.dumps(new, ensure_ascii=False, indent=2))
        return 0

    if new:
        send_mail(f"[등외급몰] 관심 물품 {len(new)}건 올라왔습니다", build_html(new, now))
        seen.update(r["key"] for r in new)

    SEEN.write_text(json.dumps({"seen": sorted(seen)}, ensure_ascii=False, indent=1), encoding="utf-8")
    LATEST.write_text(json.dumps(
        {"checked_at": now, "status": status,
         "matches": [{k: v for k, v in r.items() if k != "key"} for r in found]},
        ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
