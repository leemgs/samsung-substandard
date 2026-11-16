(() => {
  const $ = (id) => document.getElementById(id);
  const ls = {
    get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };
  const PATH = "docs/data/keywords.json";
  let keywords = [];

  // owner.github.io/repo 에서 열면 저장소를 자동 추정
  const guess = location.hostname.endsWith(".github.io")
    ? `${location.hostname.split(".")[0]}/${location.pathname.split("/")[1] || ""}` : "";
  $("repo").value = ls.get("repo") || guess;
  $("token").value = ls.get("token");

  const msg = (t, err) => { $("msg").textContent = t; $("msg").style.color = err ? "#d92d20" : ""; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function render() {
    $("kw-list").innerHTML = keywords.map((k, i) =>
      `<li><span>${esc(k)}</span><button data-i="${i}" aria-label="삭제">✕</button></li>`).join("")
      || '<li class="hint">등록된 키워드가 없습니다.</li>';
  }
  const payload = () => JSON.stringify({
    keywords, notify_email: $("notify").value.trim() || undefined, updated_at: new Date().toISOString(),
  }, null, 2) + "\n";

  $("add-form").onsubmit = (e) => {
    e.preventDefault();
    const v = $("kw").value.trim();
    if (v && !keywords.includes(v)) keywords.push(v);
    $("kw").value = ""; render();
  };
  $("kw-list").onclick = (e) => {
    const i = e.target.dataset.i;
    if (i !== undefined) { keywords.splice(+i, 1); render(); }
  };

  $("download").onclick = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([payload()], { type: "application/json" }));
    a.download = "keywords.json"; a.click();
    msg("다운로드됨 → 저장소의 docs/data/keywords.json 에 덮어써 커밋하세요.");
  };

  $("save").onclick = async () => {
    const repo = $("repo").value.trim(), token = $("token").value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) return msg("저장소(owner/repo)와 토큰을 입력하세요.", true);
    const em = $("notify").value.trim();
    if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return msg("수신 이메일 형식이 올바르지 않습니다.", true);
    ls.set("repo", repo); ls.set("token", token);
    const url = `https://api.github.com/repos/${repo}/contents/${PATH}`;
    const h = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
    try {
      msg("저장 중…");
      const cur = await fetch(url, { headers: h });
      const sha = cur.ok ? (await cur.json()).sha : undefined;
      const body = { message: "chore: update keywords", sha,
        content: btoa(unescape(encodeURIComponent(payload()))) };
      const r = await fetch(url, { method: "PUT", headers: h, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).message || r.status);
      msg("✅ 저장되었습니다. 다음 9시 실행부터 반영됩니다.");
    } catch (err) { msg("저장 실패: " + err.message, true); }
  };

  // ---- ③ 결과 게시판 (페이지당 개수 조절 + 페이지 번호)
  const SIZES = [10, 20, 30, 50, 70, 100];
  const board = { rows: [], page: 1, size: 20 };
  try { const v = +localStorage.getItem("pageSize"); if (SIZES.includes(v)) board.size = v; } catch {}
  $("page-size").value = String(board.size);

  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  // "제품명 … 364,000원 구매하기 설명…" 형태의 문장을 제품명/가격/설명으로 분리
  function parseItem(text) {
    const m = (text || "").match(/^(.*?)\s*([\d,]{4,})\s*원\s*(?:구매하기)?\s*(.*)$/);
    return m ? { title: m[1] || text, price: m[2] + "원", desc: m[3] } : { title: text || "", price: "-", desc: "" };
  }

  function drawBoard() {
    const total = board.rows.length;
    const pages = Math.max(1, Math.ceil(total / board.size));
    board.page = Math.min(Math.max(1, board.page), pages);
    const start = (board.page - 1) * board.size;
    const slice = board.rows.slice(start, start + board.size);

    $("total").textContent = total ? `총 ${total}건 · ${start + 1}–${start + slice.length}번째` : "총 0건";
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
    }).join("") : '<tr><td colspan="5" class="empty">일치하는 물품이 없습니다.</td></tr>';

    // 페이지 번호: 처음/이전 1 … 현재±2 … 마지막/다음
    const nums = new Set([1, pages]);
    for (let n = board.page - 2; n <= board.page + 2; n++) if (n >= 1 && n <= pages) nums.add(n);
    let html = "", prev = 0;
    const btn = (label, n, extra = "") => `<button data-page="${n}" ${extra}>${label}</button>`;
    html += btn("«", 1, board.page === 1 ? "disabled" : "") + btn("‹", board.page - 1, board.page === 1 ? "disabled" : "");
    [...nums].sort((a, b) => a - b).forEach((n) => {
      if (n - prev > 1) html += '<span class="gap">…</span>';
      html += btn(n, n, n === board.page ? 'aria-current="page" class="on"' : "");
      prev = n;
    });
    html += btn("›", board.page + 1, board.page === pages ? "disabled" : "") + btn("»", pages, board.page === pages ? "disabled" : "");
    $("pager").innerHTML = pages > 1 ? html : "";
  }
  $("pager").onclick = (e) => {
    const n = +e.target.dataset.page;
    if (n) { board.page = n; drawBoard(); }
  };
  $("page-size").onchange = (e) => {
    const first = (board.page - 1) * board.size;           // 보던 위치가 유지되도록 페이지 재계산
    board.size = +e.target.value;
    board.page = Math.floor(first / board.size) + 1;
    try { localStorage.setItem("pageSize", String(board.size)); } catch {}
    drawBoard();
  };

  async function load() {
    try {
      const k = await (await fetch("data/keywords.json", { cache: "no-store" })).json();
      keywords = k.keywords || []; $("notify").value = k.notify_email || "";
    } catch {}
    render();
    try {
      const l = await (await fetch("data/latest.json", { cache: "no-store" })).json();
      $("status").textContent = l.checked_at ? `마지막 확인: ${l.checked_at} · ${l.status}` : "아직 실행 기록이 없습니다.";
      board.rows = l.matches || [];
    } catch { $("status").textContent = "결과를 불러오지 못했습니다."; }
    drawBoard();
  }
  load();
})();
