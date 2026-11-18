// 모든 페이지가 공유하는 모듈: 메뉴(헤더/푸터), 데이터 로딩, GitHub 저장 API, 유틸
export const API = "https://api.github.com";
export const KEYWORDS_PATH = "docs/data/keywords.json";
export const REPO_URL = "https://github.com/leemgs/samsung-substandard";

export const PAGES = [
  { key: "home", href: "./", label: "홈", icon: "🏠" },
  { key: "keywords", href: "keywords.html", label: "관심 키워드", icon: "🏷️" },
  { key: "results", href: "results.html", label: "확인 결과", icon: "📋" },
  { key: "settings", href: "settings.html", label: "설정", icon: "⚙️" },
  { key: "schedule", href: "schedule.html", label: "운영 안내", icon: "🗓️" },
  { key: "guide", href: "guide.html", label: "이용 가이드", icon: "📖" },
];

// ---------- 유틸
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");

export const store = {
  get(k) { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  remove(k) { try { localStorage.removeItem(k); } catch {} },
};

// "제품명 … 364,000원 구매하기 설명…" 형태의 문장을 제품명/가격/설명으로 분리
export function parseItem(text) {
  const m = (text || "").match(/^(.*?)\s*([\d,]{4,})\s*원\s*(?:구매하기)?\s*(.*)$/);
  return m ? { title: m[1] || text, price: m[2] + "원", priceNum: Number(m[2].replace(/,/g, "")), desc: m[3] }
           : { title: text || "", price: "-", priceNum: null, desc: "" };
}

// "2026-11-17 19:34 KST" → Date
export function parseKst(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(" KST", "").replace(" ", "T") + ":00+09:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
export function ago(d, now = Date.now()) {
  const m = Math.max(0, Math.round((now - d.getTime()) / 60000));
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}
export const fmtKst = (d) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
}).format(d);

// 자동 실행 스케줄(워크플로의 cron 과 동일): 매일 13:17 KST, 화·목 12:10~18:10 KST 1시간 간격
export function nextRuns(now = new Date(), count = 3) {
  const out = new Set();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let d = -1; d <= 9; d++) {
    const day = new Date(base + d * 864e5);
    const [y, mo, dd] = [day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()];
    out.add(Date.UTC(y, mo, dd, 4, 17));                                   // 04:17 UTC = 13:17 KST
    if (day.getUTCDay() === 2 || day.getUTCDay() === 4) for (let h = 3; h <= 9; h++) out.add(Date.UTC(y, mo, dd, h, 10));
  }
  return [...out].filter((t) => t > now.getTime()).sort((a, b) => a - b).slice(0, count).map((t) => new Date(t));
}

// ---------- 공통 레이아웃 (메뉴/푸터)
export function initLayout(active) {
  const header = $("site-header");
  if (header) {
    header.className = "site-header";
    header.innerHTML = `<a class="skip" href="#main">본문 바로가기</a>
      <div class="bar">
        <a class="brand" href="./">🛒 등외급몰 알리미</a>
        <nav class="nav" aria-label="주 메뉴">${PAGES.map((p) =>
          `<a href="${p.href}"${p.key === active ? ' aria-current="page"' : ""}><span aria-hidden="true">${p.icon}</span> ${p.label}</a>`).join("")}</nav>
      </div>`;
  }
  const footer = $("site-footer");
  if (footer) {
    footer.className = "site-footer";
    footer.innerHTML = `<div>${PAGES.map((p) => `<a href="${p.href}">${p.label}</a>`).join(" · ")}</div>
      <div><a href="${REPO_URL}" target="_blank" rel="noopener">GitHub: ${REPO_URL}</a></div>`;
  }
}

// ---------- 저장소 설정 (이 브라우저에만 보관)
export function getRepoConfig() {
  const guess = location.hostname.endsWith(".github.io")
    ? `${location.hostname.split(".")[0]}/${location.pathname.split("/")[1] || ""}` : "";
  return { repo: store.get("repo") || guess, token: store.get("token") };
}

// ---------- 데이터 로딩
export async function loadLatest() {
  try {
    const r = await fetch("data/latest.json", { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

const ghHeaders = (token, accept = "application/vnd.github+json") =>
  ({ Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28" });
const fileUrl = (repo) => `${API}/repos/${repo}/contents/${KEYWORDS_PATH}`;

// 토큰이 있으면 GitHub 의 최신 파일을 우선 사용(Pages 배포 지연으로 옛 목록을 보고 덮어쓰는 것을 방지)
export async function loadKeywords() {
  const { repo, token } = getRepoConfig();
  if (repo && token) {
    try {
      const r = await fetch(fileUrl(repo), { headers: ghHeaders(token, "application/vnd.github.raw+json"), cache: "no-store" });
      if (r.ok) return { data: JSON.parse(await r.text()), source: "github" };
    } catch {}
  }
  try {
    const r = await fetch("data/keywords.json", { cache: "no-store" });
    if (r.ok) return { data: await r.json(), source: "pages" };
  } catch {}
  return { data: { keywords: [] }, source: "none" };
}

// ---------- GitHub 저장 (Contents API)
const EXPLAIN = {
  401: "토큰이 올바르지 않거나 만료되었습니다. 새 토큰을 발급해 다시 입력하세요.",
  403: "권한이 없습니다. 토큰에 이 저장소의 Contents: Read and write 권한이 있어야 합니다.",
  404: "저장소를 찾을 수 없습니다. 저장소 이름(owner/repo)과 토큰의 저장소 접근 범위를 확인하세요.",
};
async function apiError(r) {
  const detail = (await r.json().catch(() => ({}))).message || "";
  return new Error(`${EXPLAIN[r.status] || detail || "HTTP " + r.status} (${r.status})`);
}
const toB64 = (text) => { let bin = ""; new TextEncoder().encode(text).forEach((c) => (bin += String.fromCharCode(c))); return btoa(bin); };

// 최신 sha 를 읽어 PUT. 다른 커밋과 겹쳐 sha 가 어긋나면(409/422) 최신 sha 로 한 번 더 시도
export async function saveKeywordsFile(repo, token, text, message) {
  let res;
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    const cur = await fetch(fileUrl(repo), { headers: ghHeaders(token), cache: "no-store" });
    if (!cur.ok && cur.status !== 404) throw await apiError(cur);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const r = await fetch(fileUrl(repo), {
      method: "PUT", headers: { ...ghHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: toB64(text), sha }),
    });
    if (r.ok) { res = await r.json(); break; }
    if (attempt === 0 && (r.status === 409 || r.status === 422)) continue;
    throw await apiError(r);
  }
  return res;
}

// 저장한 커밋의 파일을 다시 읽어 키워드가 실제로 반영됐는지 확인
export async function verifySaved(repo, token, commitSha, keywords) {
  try {
    const r = await fetch(`${fileUrl(repo)}?ref=${commitSha}`,
      { headers: ghHeaders(token, "application/vnd.github.raw+json"), cache: "no-store" });
    return r.ok && JSON.stringify(JSON.parse(await r.text()).keywords) === JSON.stringify(keywords);
  } catch { return false; }
}

// 설정 페이지의 '연결 확인': 읽기 권한과 파일 존재 여부
export async function checkConnection(repo, token) {
  const r = await fetch(fileUrl(repo), { headers: ghHeaders(token), cache: "no-store" });
  if (r.status === 404) {
    const repoRes = await fetch(`${API}/repos/${repo}`, { headers: ghHeaders(token), cache: "no-store" });
    if (repoRes.ok) return { ok: true, note: "저장소에 접근할 수 있습니다. keywords.json 은 아직 없어 처음 저장할 때 만들어집니다." };
  }
  if (!r.ok) throw await apiError(r);
  return { ok: true, note: "저장소와 keywords.json 에 접근할 수 있습니다. (쓰기 권한은 실제 저장할 때 확인됩니다.)" };
}

// ---------- 판매가(외부 쇼핑몰) 보조 함수
// 물품 설명에서 모델명 후보를 뽑는다. scripts/market_prices.py 의 model_codes 와 같은 규칙이어야 한다.
export function modelCodes(text) {
  const head = (text || "").split(/[\d,]{4,}\s*원/)[0];
  const found = head.match(/\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b/g) || [];
  return [...new Set(found)].sort((a, b) => b.length - a.length).slice(0, 3);
}
export async function loadMarket() {
  try {
    const r = await fetch("data/market_prices.json", { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
export const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;
export const coupangSearchUrl = (q) => `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}`;
