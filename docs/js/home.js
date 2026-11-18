import { $, esc, safeUrl, initLayout, parseItem, parseKst, ago, fmtKst, nextRuns, loadLatest, loadKeywords } from "./common.js";

initLayout("home");

const STALE_HOURS = 36;

function stat(label, value, detail, { href, hot, small } = {}) {
  const tag = href ? "a" : "div";
  return `<${tag} class="stat${hot ? " hot" : ""}"${href ? ` href="${href}"` : ""}>
    <div class="label">${esc(label)}</div><div class="value${small ? " sm" : ""}">${esc(value)}</div><div class="detail">${esc(detail)}</div></${tag}>`;
}

(async () => {
  const [latest, kw] = await Promise.all([loadLatest(), loadKeywords()]);
  const rows = latest?.matches || [];
  const keywords = kw.data.keywords || [];
  const checked = parseKst(latest?.checked_at);
  const newRows = rows.filter((m) => m.is_new);
  const next = nextRuns(new Date(), 2);

  // ---- 경고 배너
  const banners = [];
  if (!latest || !checked) {
    banners.push(`<div class="banner"><strong>아직 확인 기록이 없습니다.</strong> 첫 자동 확인 후 이곳에 결과가 표시됩니다. <a href="schedule.html">확인 스케줄</a></div>`);
  } else {
    if (Date.now() - checked.getTime() > STALE_HOURS * 3600e3) {
      banners.push(`<div class="banner warn"><strong>⚠️ 자동 확인이 ${ago(checked)} 이후 실행되지 않았습니다.</strong>
        GitHub 예약 실행이 지연되었을 수 있습니다. <a href="schedule.html#help">수동으로 실행하는 방법</a></div>`);
    }
    if (String(latest.status || "").startsWith("주의")) {
      banners.push(`<div class="banner warn"><strong>⚠️ 일부 물품을 놓쳤을 수 있습니다.</strong> ${esc(latest.status)}</div>`);
    }
  }
  $("banners").innerHTML = banners.join("");

  // ---- 요약 카드
  $("stats").innerHTML = [
    stat("마지막 확인", checked ? ago(checked) : "기록 없음", latest?.checked_at || "-"),
    stat("다음 자동 확인", next[0] ? fmtKst(next[0]).replace(/^\d+월 /, "") : "-", next[1] ? `그다음 ${fmtKst(next[1]).replace(/^\d+월 /, "")}` : "KST 기준", { href: "schedule.html", small: true }),
    stat("현재 일치 물품", `${rows.length}건`, `${new Set(rows.map((m) => m.category)).size}개 카테고리`, { href: "results.html" }),
    stat("새로 올라온 물품", `${newRows.length}건`, "마지막 확인에서 처음 본 물품", { href: "results.html?new=1", hot: newRows.length > 0 }),
    stat("관심 키워드", `${keywords.length}개`, keywords.slice(0, 3).join(", ") || "등록된 키워드 없음", { href: "keywords.html" }),
  ].join("");

  // ---- 카테고리 칩
  const counts = new Map();
  rows.forEach((m) => counts.set(m.category || "(미분류)", (counts.get(m.category || "(미분류)") || 0) + 1));
  $("categories").innerHTML = counts.size
    ? [...counts].map(([c, n]) => `<a class="chip" href="results.html?category=${encodeURIComponent(c)}">${esc(c)} <b>${n}</b></a>`).join("")
    : '<span class="hint">일치하는 물품이 없습니다.</span>';

  // ---- 새 물품 미리보기
  $("new-items").innerHTML = newRows.length
    ? newRows.slice(0, 5).map((m) => {
        const it = parseItem(m.text), link = safeUrl(m.link), img = safeUrl(m.image);
        return `<div class="mini"><span class="thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>
          <div><span class="new">NEW</span> ${link ? `<a class="name" href="${esc(link)}" target="_blank" rel="noopener">${esc(it.title)}</a>` : esc(it.title)}
          <br><small>${esc(m.category || "-")}</small></div>
          <div class="meta"><small>직원가</small><br><b>${esc(it.price)}</b></div></div>`;
      }).join("") + (newRows.length > 5 ? `<p class="hint" style="margin-top:8px">외 ${newRows.length - 5}건 — <a href="results.html?new=1">모두 보기</a></p>` : "")
    : '<span class="hint">마지막 확인에서 새로 올라온 물품이 없습니다.</span>';
})();
