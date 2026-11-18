import { $, esc, safeUrl, store, initLayout, parseItem, parseKst, ago, loadLatest, loadMarket, modelCodes, won, coupangSearchUrl, naverSearchUrl } from "./common.js";

initLayout("results");

const SIZES = [10, 20, 30, 50, 70, 100];
const SORTS = ["default", "price-asc", "price-desc", "discount-desc"];
const state = { rows: [], q: "", category: "", newOnly: false, sort: "default", size: 20, page: 1, market: null };

// ---- URL/저장값 → 상태 (링크로 필터 상태를 공유할 수 있음)
(function restore() {
  const p = new URLSearchParams(location.search);
  const saved = Number(store.get("pageSize"));
  state.size = SIZES.includes(Number(p.get("size"))) ? Number(p.get("size")) : SIZES.includes(saved) ? saved : 20;
  state.q = p.get("q") || "";
  state.category = p.get("category") || "";
  state.newOnly = p.get("new") === "1";
  state.sort = SORTS.includes(p.get("sort")) ? p.get("sort") : "default";
  state.page = Math.max(1, Number(p.get("page")) || 1);
})();

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.category) p.set("category", state.category);
  if (state.newOnly) p.set("new", "1");
  if (state.sort !== "default") p.set("sort", state.sort);
  if (state.size !== 20) p.set("size", state.size);
  if (state.page > 1) p.set("page", state.page);
  const qs = p.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
}

// 판매가(외부 쇼핑몰) 정보: market_prices.json 의 links[링크] → 모델명 → models[모델명]
function marketOf(m) {
  const mk = state.market;
  const model = (mk?.links && mk.links[m.link]) || modelCodes(m.text)[0] || "";
  const e = model && mk?.models ? mk.models[model] : null;
  const emp = parseItem(m.text).priceNum;
  if (e && e.price) {
    const pct = emp && e.price ? Math.round((1 - emp / e.price) * 100) : null;   // 판매가 대비 직원가가 몇 % 싼지
    return { model, ...e, pct };
  }
  return { model, price: null, pct: null };
}

function filtered() {
  let r = state.rows.slice();
  if (state.category) r = r.filter((m) => m.category === state.category);
  if (state.newOnly) r = r.filter((m) => m.is_new);
  const tokens = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length) r = r.filter((m) => {
    const t = `${m.category || ""} ${m.keyword || ""} ${m.text || ""}`.toLowerCase();
    return tokens.every((k) => t.includes(k));
  });
  if (state.sort === "discount-desc") {
    r.sort((a, b) => {
      const da = marketOf(a).pct, db = marketOf(b).pct;
      if (da == null && db == null) return 0;
      if (da == null) return 1;               // 판매가를 모르는 물품은 뒤로
      if (db == null) return -1;
      return db - da;
    });
  } else if (state.sort !== "default") {
    const dir = state.sort === "price-asc" ? 1 : -1;
    r.sort((a, b) => {
      const pa = parseItem(a.text).priceNum, pb = parseItem(b.text).priceNum;
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;               // 가격 없는 물품은 항상 뒤로
      if (pb == null) return -1;
      return (pa - pb) * dir;
    });
  }
  return r;
}

function marketCell(m) {
  const mk = marketOf(m);
  if (mk.price) {
    const url = safeUrl(mk.url);
    const rel = mk.source === "coupang-partners" ? "noopener sponsored" : "noopener";   // 쿠팡 파트너스 링크만 제휴 표기
    const price = url ? `<a href="${esc(url)}" target="_blank" rel="${rel}" title="${esc(mk.name || "")}">${won(mk.price)}</a>` : `<b>${won(mk.price)}</b>`;
    let note = esc(mk.mall || "외부몰");
    if (mk.pct != null) note += mk.pct > 0 ? ` · 직원가 <span class="save">−${mk.pct}%</span>` : mk.pct < 0 ? ` · 직원가 +${-mk.pct}%` : " · 직원가와 동일";
    if (mk.source === "manual") note += " · 수동";
    return `${price}<small title="${esc(mk.checked_at || "")}">${note}</small>`;
  }
  const q = mk.model || parseItem(m.text).title;
  return `<span class="muted">-</span><small><a href="${esc(coupangSearchUrl(q))}" target="_blank" rel="noopener">쿠팡 검색</a> · <a href="${esc(naverSearchUrl(q))}" target="_blank" rel="noopener">네이버 검색</a></small>`;
}

function marketNote() {
  const mk = state.market, el = $("market-note");
  const priced = mk?.models ? Object.values(mk.models).filter((e) => e.price) : [];
  let t = "※ 직원가는 등외급몰 혜택가, 판매가는 쿠팡·네이버쇼핑 검색 결과의 신제품 최저가 참고값입니다. 등급·옵션·재고가 달라 단순 비교는 어렵습니다.";
  if (!priced.length) t += " 판매가 자동 조회는 네이버 쇼핑 검색 API 또는 쿠팡 파트너스 키를 등록하면 활성화됩니다(README 참고).";
  else {
    t += ` (판매가 기준: ${mk.updated_at || "-"})`;
    if (priced.some((e) => e.source === "coupang-partners")) t += " 쿠팡 링크는 쿠팡 파트너스 활동의 일환으로, 구매 시 일정액의 수수료를 받을 수 있습니다.";
  }
  el.textContent = t;
}

function draw() {
  const list = filtered();
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / state.size));
  state.page = Math.min(Math.max(1, state.page), pages);
  const start = (state.page - 1) * state.size;
  const slice = list.slice(start, start + state.size);
  const filtering = !!(state.q || state.category || state.newOnly);

  $("total").textContent = total
    ? `총 ${total}건${filtering ? ` (전체 ${state.rows.length}건 중)` : ""} · ${start + 1}–${start + slice.length}번째`
    : filtering ? `조건에 맞는 물품이 없습니다 (전체 ${state.rows.length}건)` : "총 0건";
  $("clear").hidden = !filtering && state.sort === "default";

  $("matches").innerHTML = slice.length ? slice.map((m, i) => {
    const it = parseItem(m.text), link = safeUrl(m.link), img = safeUrl(m.image);
    const name = link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title);
    return `<tr>
      <td class="num" data-label="번호">${total - start - i}</td>
      <td class="cat" data-label="카테고리">${esc(m.category || "-")}${m.keyword && m.keyword !== m.category ? `<br><span class="tag">${esc(m.keyword)}</span>` : ""}</td>
      <td class="prod" data-label="상품"><div class="pwrap">
        <span class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>
        <div class="ptxt">${m.is_new ? '<span class="new">NEW</span> ' : ""}${name}${it.desc ? `<small>${esc(it.desc.slice(0, 110))}</small>` : ""}</div></div></td>
      <td class="price" data-label="직원가">${esc(it.price)}</td>
      <td class="mprice" data-label="판매가">${marketCell(m)}</td>
      <td class="date" data-label="최초 확인">${esc(m.first_seen || "-")}</td></tr>`;
  }).join("") : `<tr><td colspan="6" class="empty">${filtering ? "조건에 맞는 물품이 없습니다." : "일치하는 물품이 없습니다."}</td></tr>`;

  // 페이지 번호: « ‹ 1 … 현재±2 … 마지막 › »
  const nums = new Set([1, pages]);
  for (let n = state.page - 2; n <= state.page + 2; n++) if (n >= 1 && n <= pages) nums.add(n);
  const btn = (label, n, extra = "") => `<button data-page="${n}" ${extra}>${label}</button>`;
  let html = btn("«", 1, state.page === 1 ? "disabled" : "") + btn("‹", state.page - 1, state.page === 1 ? "disabled" : "");
  let prev = 0;
  [...nums].sort((a, b) => a - b).forEach((n) => {
    if (n - prev > 1) html += '<span class="gap">…</span>';
    html += btn(n, n, n === state.page ? 'aria-current="page" class="on"' : "");
    prev = n;
  });
  html += btn("›", state.page + 1, state.page === pages ? "disabled" : "") + btn("»", pages, state.page === pages ? "disabled" : "");
  $("pager").innerHTML = pages > 1 ? html : "";
  marketNote();
  syncUrl();
}

// ---- 입력 이벤트
let timer;
$("q").oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim(); state.page = 1; draw(); }, 150); };
$("category").onchange = (e) => { state.category = e.target.value; state.page = 1; draw(); };
$("sort").onchange = (e) => { state.sort = e.target.value; state.page = 1; draw(); };
$("new-only").onchange = (e) => { state.newOnly = e.target.checked; state.page = 1; draw(); };
$("clear").onclick = () => {
  Object.assign(state, { q: "", category: "", newOnly: false, sort: "default", page: 1 });
  $("q").value = ""; $("category").value = ""; $("new-only").checked = false; $("sort").value = "default"; draw();
};
$("pager").onclick = (e) => { const n = Number(e.target.dataset.page); if (n) { state.page = n; draw(); window.scrollTo({ top: 0, behavior: "smooth" }); } };
$("page-size").onchange = (e) => {
  const first = (state.page - 1) * state.size;           // 보던 위치가 유지되도록 페이지 재계산
  state.size = Number(e.target.value);
  state.page = Math.floor(first / state.size) + 1;
  store.set("pageSize", String(state.size));
  draw();
};

(async () => {
  const [latest, market] = await Promise.all([loadLatest(), loadMarket()]);
  state.market = market;
  if (!latest) { $("status").textContent = "결과를 불러오지 못했습니다."; draw(); return; }
  state.rows = latest.matches || [];
  const checked = parseKst(latest.checked_at);
  $("status").textContent = latest.checked_at
    ? `마지막 확인: ${latest.checked_at}${checked ? ` (${ago(checked)})` : ""} · ${latest.status}` : "아직 실행 기록이 없습니다.";
  if (checked) {
    const hours = (Date.now() - checked.getTime()) / 3600e3;
    const note = $("fresh-note");
    note.hidden = false;
    note.classList.toggle("warn", hours >= 3);
    note.textContent = hours >= 3
      ? `⚠️ 마지막 확인이 ${ago(checked)}입니다. 그 사이 판매되어 재고가 없어졌을 수 있으니 구매 전에 사이트에서 확인하세요.`
      : "※ 마지막 확인 시점 기준입니다. 다른 분이 구매하면 재고가 바로 없어질 수 있습니다.";
  }
  const cats = [...new Set(state.rows.map((m) => m.category).filter(Boolean))];
  if (state.category && !cats.includes(state.category)) cats.push(state.category);
  $("category").innerHTML = '<option value="">전체</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join("");
  $("category").value = state.category;
  $("q").value = state.q;
  $("new-only").checked = state.newOnly;
  $("sort").value = state.sort;
  $("page-size").value = String(state.size);
  draw();
})();
