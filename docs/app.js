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

  async function load() {
    try {
      const k = await (await fetch("data/keywords.json", { cache: "no-store" })).json();
      keywords = k.keywords || []; $("notify").value = k.notify_email || "";
    } catch {}
    render();
    try {
      const l = await (await fetch("data/latest.json", { cache: "no-store" })).json();
      $("status").textContent = l.checked_at ? `마지막 확인: ${l.checked_at} · ${l.status}` : "아직 실행 기록이 없습니다.";
      $("matches").innerHTML = (l.matches || []).map((m) => `
        <div class="card">${m.image ? `<img src="${esc(m.image)}" alt="">` : ""}
        <div><span class="tag">${esc(m.keyword)}</span><div>${esc(m.text)}</div>
        ${m.link ? `<a href="${esc(m.link)}" target="_blank" rel="noopener">바로가기</a>` : ""}</div></div>`).join("");
    } catch { $("status").textContent = "결과를 불러오지 못했습니다."; }
  }
  load();
})();
