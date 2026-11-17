import { $, store, initLayout, getRepoConfig, checkConnection } from "./common.js";

initLayout("settings");

function setMsg(text, kind) { const el = $("msg"); el.textContent = text; el.className = "msg" + (kind ? " " + kind : ""); }
function showState() {
  const { repo, token } = getRepoConfig();
  $("state").textContent = token ? `현재 상태: 저장소 ${repo || "(미지정)"} · 토큰 등록됨 (${token.length}자)` : "현재 상태: 토큰이 등록되어 있지 않습니다.";
}

const read = () => ({ repo: $("repo").value.trim(), token: $("token").value.trim() });
const validRepo = (r) => /^[\w.-]+\/[\w.-]+$/.test(r);

$("save").onclick = () => {
  const { repo, token } = read();
  if (!validRepo(repo)) return setMsg("저장소 형식이 올바르지 않습니다. 예: leemgs/samsung-substandard", "err");
  if (!token) return setMsg("토큰을 입력하세요.", "err");
  store.set("repo", repo); store.set("token", token);
  setMsg("✅ 이 브라우저에 저장했습니다. [연결 확인]으로 점검해 보세요.", "ok"); showState();
};

$("test").onclick = async () => {
  const { repo, token } = read();
  if (!validRepo(repo) || !token) return setMsg("저장소와 토큰을 먼저 입력하세요.", "err");
  $("test").disabled = true; setMsg("확인 중…", "");
  try { const r = await checkConnection(repo, token); setMsg("✅ " + r.note, "ok"); }
  catch (e) { setMsg("연결 실패: " + e.message, "err"); }
  finally { $("test").disabled = false; }
};

$("forget").onclick = () => {
  store.remove("token"); $("token").value = "";
  setMsg("이 브라우저에 저장된 토큰을 삭제했습니다.", "ok"); showState();
};

const cfg = getRepoConfig();
$("repo").value = cfg.repo; $("token").value = cfg.token;
showState();
