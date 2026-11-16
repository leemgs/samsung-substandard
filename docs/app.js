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

  const msg = (t, err, link, tail) => {
    const el = $("msg"); el.textContent = t; el.style.color = err ? "#d92d20" : "";
    if (link) { const a = document.createElement("a"); a.href = link.href; a.target = "_blank"; a.rel = "noopener"; a.textContent = link.text; el.append(a); }
    if (tail) el.append(tail);
  };
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

  // ---- GitHub 저장 (Contents API)
  const API = "https://api.github.com";
  const ghHeaders = (token, accept = "application/vnd.github+json") =>
    ({ Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28" });
  const toB64 = (text) => { let bin = ""; new TextEncoder().encode(text).forEach((c) => (bin += String.fromCharCode(c))); return btoa(bin); };
  const EXPLAIN = {
    401: "토큰이 올바르지 않거나 만료되었습니다. 새 토큰을 발급해 다시 입력하세요.",
    403: "권한이 없습니다. 토큰에 이 저장소의 Contents: Read and write 권한이 있어야 합니다.",
    404: "저장소를 찾을 수 없습니다. 저장소 이름(owner/repo)과 토큰의 저장소 접근 범위를 확인하세요.",
  };
  async function apiError(r) {
    const detail = (await r.json().catch(() => ({}))).message || "";
    return new Error(`${EXPLAIN[r.status] || detail || "HTTP " + r.status} (${r.status})`);
  }
  const fileUrl = (repo) => `${API}/repos/${repo}/contents/${PATH}`;

  // 최신 sha 를 읽어 PUT. 다른 커밋과 겹쳐 sha 가 어긋나면(409/422) 최신 sha 로 한 번 더 시도
  async function putFile(repo, token, text, message) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cur = await fetch(fileUrl(repo), { headers: ghHeaders(token), cache: "no-store" });
      if (!cur.ok && cur.status !== 404) throw await apiError(cur);
      const sha = cur.ok ? (await cur.json()).sha : undefined;
      const r = await fetch(fileUrl(repo), {
        method: "PUT", headers: { ...ghHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ message, content: toB64(text), sha }),
      });
      if (r.ok) return r.json();
      if (attempt === 0 && (r.status === 409 || r.status === 422)) continue;
      throw await apiError(r);
    }
  }

  let saving = false;
  $("save").onclick = async () => {
    if (saving) return;
    const repo = $("repo").value.trim(), token = $("token").value.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) return msg("저장소(owner/repo)와 토큰을 입력하세요.", true);
    const em = $("notify").value.trim();
    if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return msg("수신 이메일 형식이 올바르지 않습니다.", true);
    saving = true; $("save").disabled = true;
    try {
      msg("저장 중…");
      const mine = keywords.slice();
      const res = await putFile(repo, token, payload(), `chore: update keywords (${mine.slice(0, 5).join(", ")}${mine.length > 5 ? " 외" : ""})`);
      ls.set("repo", repo); ls.set("token", token);
      // 저장 결과를 GitHub 에서 다시 읽어 실제로 반영됐는지 확인
      let verified = false;
      try {
        const back = await fetch(`${fileUrl(repo)}?ref=${res.commit.sha}`,
          { headers: ghHeaders(token, "application/vnd.github.raw+json"), cache: "no-store" });
        verified = back.ok && JSON.stringify(JSON.parse(await back.text()).keywords) === JSON.stringify(mine);
      } catch {}
      msg(`${verified ? "✅ 저장 완료 · GitHub 반영 확인됨" : "⚠️ 저장은 됐지만 반영 내용을 확인하지 못했습니다"} (키워드 ${mine.length}개) · 커밋 `,
          !verified, { href: res.commit.html_url, text: res.commit.sha.slice(0, 7) },
          " — 다음 실행(매일 오후 1시 KST)부터 적용됩니다. 이 페이지의 목록은 배포 후(1~2분) 갱신됩니다.");
    } catch (err) { msg("저장 실패: " + err.message, true); }
    finally { saving = false; $("save").disabled = false; }
  };

  $("forget").onclick = () => {
    try { localStorage.removeItem("token"); } catch {}
    $("token").value = ""; msg("이 브라우저에 저장된 토큰을 삭제했습니다.");
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
      let k = null;
      const repo = $("repo").value.trim(), token = $("token").value.trim();
      if (repo && token) {
        try {
          const r = await fetch(fileUrl(repo), { headers: ghHeaders(token, "application/vnd.github.raw+json"), cache: "no-store" });
          if (r.ok) k = JSON.parse(await r.text());
        } catch {}
      }
      if (!k) k = await (await fetch("data/keywords.json", { cache: "no-store" })).json();
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
