/* 간단한 접근 제한 (정적 사이트용)
 * - config/access.json 에는 접속 코드의 SHA-256 해시만 저장한다(평문 없음).
 * - 입력 코드를 브라우저에서 해시해 digest 와 비교, 일치하면 sessionStorage 에 허용 상태를 기록한다.
 * ⚠️ 해시가 클라이언트에 노출되므로 진짜 보안 경계가 아니다. 민감정보 보호 목적으로 사용하지 말 것.
 */
(function () {
  "use strict";
  var KEY = "siteAccess", CONFIG_URL = "config/access.json";
  var cfg = null, fails = 0, lockedUntil = 0;
  var root = document.documentElement;

  function ss(op, k, v) {
    try { return op === "get" ? sessionStorage.getItem(k) : op === "set" ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k); }
    catch (e) { return null; }
  }

  // ---- SHA-256 (crypto.subtle 우선, 불가(http 등)하면 순수 JS)
  function utf8(str) { return new TextEncoder().encode(str); }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function sha256Js(bytes) {
    var K = [], H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19], p = 2, n = 0;
    function frac(x) { return ((x - Math.floor(x)) * 4294967296) | 0; }
    while (n < 64) { var pr = true; for (var d = 2; d * d <= p; d++) if (p % d === 0) { pr = false; break; } if (pr) { K[n++] = frac(Math.cbrt(p)); } p++; }
    var l = bytes.length, total = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
    m.set(bytes); m[l] = 0x80;
    var bits = l * 8; m[total - 4] = bits >>> 24; m[total - 3] = bits >>> 16; m[total - 2] = bits >>> 8; m[total - 1] = bits;
    m[total - 8] = Math.floor(bits / 4294967296) >>> 24; m[total - 7] = Math.floor(bits / 4294967296) >>> 16; m[total - 6] = Math.floor(bits / 4294967296) >>> 8; m[total - 5] = Math.floor(bits / 4294967296);
    var w = new Array(64);
    function rr(x, c) { return (x >>> c) | (x << (32 - c)); }
    for (var o = 0; o < total; o += 64) {
      for (var i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d2 = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        var t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d2 + t1) | 0; d2 = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d2) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ("00000000" + (x >>> 0).toString(16)).slice(-8); }).join("");
  }
  function sha256(text) {
    var bytes = utf8(text);
    if (window.crypto && crypto.subtle && crypto.subtle.digest) {
      return crypto.subtle.digest("SHA-256", bytes).then(hex).catch(function () { return sha256Js(bytes); });
    }
    return Promise.resolve(sha256Js(bytes));
  }

  function loadConfig() {
    return fetch(CONFIG_URL, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function digests() {
    return (cfg && cfg.codes || []).map(function (c) { return String(c.digest || "").toLowerCase(); }).filter(function (d) { return /^[0-9a-f]{64}$/.test(d); });
  }

  function open() {
    root.classList.remove("auth-locked");
    var g = document.getElementById("auth-gate"); if (g) g.remove();
    addLockButton();
  }
  function addLockButton() {
    function add() {
      if (document.getElementById("auth-lock") || !(cfg && cfg.enabled !== false)) return;
      var b = document.createElement("button");
      b.id = "auth-lock"; b.type = "button"; b.textContent = "🔒 잠그기"; b.title = "이 브라우저 탭의 접근 허용을 해제합니다";
      b.onclick = lockSite; document.body.appendChild(b);
    }
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
  }

  // 접근 허용 상태를 기록: 일치한 digest 를 저장하므로, 코드를 교체(회전)하면 기존 세션은 무효가 된다.
  function unlock(code) {
    code = String(code == null ? "" : code).trim();
    if (!code) return Promise.resolve(false);
    if (Date.now() < lockedUntil) return Promise.resolve(false);
    return sha256(code).then(function (d) {
      if (digests().indexOf(d) !== -1) {
        fails = 0;
        ss("set", KEY, JSON.stringify({ digest: d, at: Date.now() }));
        open();
        return true;
      }
      fails++;
      if (fails >= 5) { lockedUntil = Date.now() + 30000; fails = 0; }
      return false;
    });
  }
  function lockSite() { ss("del", KEY); location.reload(); }

  function showGate(msg) {
    function build() {
      var g = document.getElementById("auth-gate");
      if (!g) {
        g = document.createElement("div");
        g.id = "auth-gate";
        g.innerHTML = '<form class="auth-card" autocomplete="off">' +
          '<h1>🔒 등외급몰 알리미</h1>' +
          '<p>초대받은 분만 이용할 수 있습니다. 접속 코드를 입력하세요.</p>' +
          '<label for="auth-code">접속 코드</label>' +
          '<input id="auth-code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required>' +
          '<button type="submit">입장</button>' +
          '<p id="auth-msg" class="auth-msg" role="alert"></p>' +
          '<small>정적 사이트의 간단한 접근 제한이며, 민감정보 보호 목적이 아닙니다.</small></form>';
        document.body.appendChild(g);
        g.querySelector("form").addEventListener("submit", function (ev) {
          ev.preventDefault();
          var inp = g.querySelector("#auth-code"), m = g.querySelector("#auth-msg");
          if (Date.now() < lockedUntil) { m.textContent = "시도가 너무 많습니다. " + Math.ceil((lockedUntil - Date.now()) / 1000) + "초 후 다시 시도하세요."; return; }
          unlock(inp.value).then(function (ok) {
            if (ok) return;
            m.textContent = Date.now() < lockedUntil ? "시도가 너무 많습니다. 30초 후 다시 시도하세요." : "접속 코드가 올바르지 않습니다.";
            inp.value = ""; inp.focus();
          });
        });
      }
      if (msg) g.querySelector("#auth-msg").textContent = msg;
      var i = g.querySelector("#auth-code"); if (i && !msg) i.focus();
    }
    if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
  }

  function initAuth() {
    return loadConfig().then(function (c) {
      cfg = c;
      if (c.enabled === false) { root.classList.remove("auth-locked"); return true; }   // 명시적으로 끈 경우에만 공개
      var saved = null;
      try { saved = JSON.parse(ss("get", KEY) || "null"); } catch (e) {}
      if (saved && digests().indexOf(String(saved.digest || "").toLowerCase()) !== -1) { open(); return true; }
      ss("del", KEY);
      showGate();
      return false;
    }).catch(function () {
      showGate("접근 설정(config/access.json)을 불러오지 못해 잠겨 있습니다. 잠시 후 새로고침하세요.");
      return false;
    });
  }

  window.SiteAuth = { initAuth: initAuth, unlock: unlock, lock: lockSite, sha256: sha256, sha256Js: function (t) { return sha256Js(utf8(t)); } };
  window.initAuth = initAuth; window.unlock = unlock;
  initAuth();
})();
