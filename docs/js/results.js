import { $, esc, safeUrl, store, initLayout, parseItem, loadLatest } from "./common.js";

initLayout("results");

const SIZES = [10, 20, 30, 50, 70, 100];
const SORTS = ["default", "price-asc", "price-desc"];
const state = { rows: [], q: "", category: "", newOnly: false, sort: "default", size: 20, page: 1 };

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

function filtered() {
  let r = state.rows.slice();
  if (state.category) r = r.filter((m) => m.category === state.category);
  if (state.newOnly) r = r.filter((m) => m.is_new);
  const tokens = state.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length) r = r.filter((m) => {
    const t = `${m.category || ""} ${m.keyword || ""} ${m.text || ""}`.toLowerCase();
    return tokens.every((k) => t.includes(k));
  });
  if (state.sort !== "default") {
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
      <td class="price" data-label="가격">${esc(it.price)}</td>
      <td class="date" data-label="최초 확인">${esc(m.first_seen || "-")}</td></tr>`;
  }).join("") : `<tr><td colspan="5" class="empty">${filtering ? "조건에 맞는 물품이 없습니다." : "일치하는 물품이 없습니다."}</td></tr>`;

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
  const latest = await loadLatest();
  if (!latest) { $("status").textContent = "결과를 불러오지 못했습니다."; draw(); return; }
  state.rows = latest.matches || [];
  $("status").textContent = latest.checked_at ? `마지막 확인: ${latest.checked_at} · ${latest.status}` : "아직 실행 기록이 없습니다.";
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
