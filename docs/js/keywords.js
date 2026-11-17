import { $, esc, initLayout, getRepoConfig, store, loadKeywords, loadLatest, saveKeywordsFile, verifySaved } from "./common.js";

initLayout("keywords");

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
let keywords = [];
let original = "";
let categories = [];
let saving = false;

const snapshot = () => JSON.stringify({ k: keywords, n: $("notify").value.trim() });
const isDirty = () => snapshot() !== original;

function setMsg(el, text, kind, link, tail) {
  el.className = "msg" + (kind ? " " + kind : "");
  el.textContent = text;
  if (link) { const a = document.createElement("a"); a.href = link.href; a.target = "_blank"; a.rel = "noopener"; a.textContent = link.text; el.append(a); }
  if (tail) el.append(tail);
}

function render() {
  $("kw-list").innerHTML = keywords.length
    ? keywords.map((k, i) => `<span class="chip kw">${esc(k)}<button data-i="${i}" aria-label="${esc(k)} 삭제" title="삭제">✕</button></span>`).join("")
    : '<span class="hint">등록된 키워드가 없습니다. 위에서 추가하세요.</span>';
  $("count").textContent = keywords.length;
  const sug = categories.filter((c) => !keywords.includes(c));
  $("suggest-wrap").hidden = !sug.length;
  $("suggest").innerHTML = sug.map((c) => `<button type="button" class="chip suggest" data-add="${esc(c)}">+ ${esc(c)}</button>`).join("");
  const dirty = isDirty();
  $("dirty").hidden = !dirty;
  $("reset").disabled = !dirty;
}

function addKeyword(v) {
  v = v.trim().replace(/\s+/g, " ");
  if (!v) return false;
  if (keywords.some((k) => k.toLowerCase() === v.toLowerCase())) { setMsg($("add-msg"), `'${v}' 은(는) 이미 등록되어 있습니다.`, "err"); return false; }
  keywords.push(v);
  setMsg($("add-msg"), `'${v}' 추가됨 — 아래의 [저장하기]를 눌러야 반영됩니다.`, "ok");
  return true;
}

$("add-form").onsubmit = (e) => {
  e.preventDefault();
  if (addKeyword($("kw").value)) $("kw").value = "";
  render();
};
$("suggest").onclick = (e) => { const c = e.target.dataset.add; if (c && addKeyword(c)) render(); };
$("kw-list").onclick = (e) => {
  const i = e.target.dataset.i;
  if (i !== undefined) { setMsg($("add-msg"), `'${keywords[+i]}' 삭제됨 — 저장해야 반영됩니다.`, ""); keywords.splice(+i, 1); render(); }
};
$("notify").oninput = render;
$("reset").onclick = () => { const o = JSON.parse(original); keywords = o.k.slice(); $("notify").value = o.n; setMsg($("msg"), "변경을 취소했습니다.", ""); render(); };

const payload = () => JSON.stringify(
  { keywords, notify_email: $("notify").value.trim() || undefined, updated_at: new Date().toISOString() }, null, 2) + "\n";

$("download").onclick = () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([payload()], { type: "application/json" }));
  a.download = "keywords.json"; a.click();
  setMsg($("msg"), "다운로드됨 → 저장소의 docs/data/keywords.json 에 덮어써 커밋하세요.", "");
};

$("save").onclick = async () => {
  if (saving) return;
  const { repo, token } = getRepoConfig();
  const em = $("notify").value.trim();
  if (!repo || !token) return setMsg($("msg"), "먼저 설정 페이지에서 저장소와 토큰을 등록하세요.", "err");
  if (em && !EMAIL_RE.test(em)) return setMsg($("msg"), "수신 이메일 형식이 올바르지 않습니다.", "err");
  saving = true; $("save").disabled = true;
  try {
    setMsg($("msg"), "저장 중…", "");
    const mine = keywords.slice();
    const res = await saveKeywordsFile(repo, token, payload(),
      `chore: update keywords (${mine.slice(0, 5).join(", ")}${mine.length > 5 ? " 외" : ""})`);
    const verified = await verifySaved(repo, token, res.commit.sha, mine);
    original = snapshot();
    setMsg($("msg"),
      `${verified ? "✅ 저장 완료 · GitHub 반영 확인됨" : "⚠️ 저장은 됐지만 반영 내용을 확인하지 못했습니다"} (키워드 ${mine.length}개) · 커밋 `,
      verified ? "ok" : "err", { href: res.commit.html_url, text: res.commit.sha.slice(0, 7) },
      " — 다음 자동 확인부터 적용됩니다.");
  } catch (err) {
    setMsg($("msg"), "저장 실패: " + err.message, "err");
  } finally { saving = false; $("save").disabled = false; render(); }
};

window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

(async () => {
  const { repo, token } = getRepoConfig();
  $("need-token").hidden = !!(repo && token);
  $("save").disabled = !(repo && token);
  const [{ data, source }, latest] = await Promise.all([loadKeywords(), loadLatest()]);
  keywords = (data.keywords || []).slice();
  $("notify").value = data.notify_email || "";
  categories = [...new Set((latest?.matches || []).map((m) => m.category).filter(Boolean))];
  $("source").textContent = source === "github" ? "GitHub 최신본을 불러왔습니다" : source === "pages" ? "게시된 페이지 기준 (배포 지연 가능)" : "";
  original = snapshot();
  render();
})();
