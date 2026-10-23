/* ÜAZ Lens – Empfänger-Baustein fürs Dartbord
 * ------------------------------------------------------------
 * Einbinden (vor </body> im Dartbord):
 *   <script src="lens-empfaenger.js"></script>
 *
 * Dann dem Baustein sagen, wie ein Dart ins Dartbord kommt:
 *   UAZLens.setAdapter({
 *     dart:    d => { ... },   // Dart eintragen. d = {code:'T20', label:'T20', num:20, mult:3, value:60}
 *     undo:    () => { ... },  // letzten eingetragenen Dart zurücknehmen
 *     takeout: () => { ... }   // optional: Darts wurden gezogen (z. B. Spielerwechsel bestätigen)
 *   });
 *
 * Werte von d:  num = 1–20, 25 (Bull-Bereich) oder 0 (Miss)
 *               mult = 1 Single, 2 Double, 3 Triple, 0 Miss   (Bull = num 25, mult 2)
 *
 * Zusätzlich werden Browser-Events ausgelöst: uazlens:dart, uazlens:replace, uazlens:undo, uazlens:takeout
 * Text aufs iPhone schicken (z. B. wer dran ist):  UAZLens.info('Marcus – noch 141')
 */
(function () {
  'use strict';
  var PREFIX = 'uazlens-';
  var PEER_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
  var S = { peer: null, conns: [], code: null, adapter: null, visit: [], status: 'startet …', ok: false, log: [] };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function newCode() { var c = String(1000 + Math.floor(Math.random() * 9000)); lsSet('uazlens.rxcode', c); return c; }

  function emit(type, detail) { try { window.dispatchEvent(new CustomEvent('uazlens:' + type, { detail: detail })); } catch (e) {} }
  function call(fn, arg) {
    if (S.adapter && typeof S.adapter[fn] === 'function') {
      try { S.adapter[fn](arg); } catch (e) { console.error('[ÜAZ Lens] Adapter-Fehler (' + fn + '):', e); }
      return true;
    }
    return false;
  }
  function log(t) { S.log.unshift(t); S.log = S.log.slice(0, 6); ui(); }

  /* ---------- Nachrichten vom iPhone ---------- */
  function handle(m) {
    if (!m || !m.type) return;
    var i;
    switch (m.type) {
      case 'hello': log('Lens verbunden'); break;
      case 'dart':
        for (i = 0; i < S.visit.length; i++) if (S.visit[i].id === m.id) return; // doppelt
        S.visit.push({ id: m.id, dart: m.dart });
        call('dart', m.dart); emit('dart', m.dart); log('Treffer: ' + m.dart.label);
        break;
      case 'replace':
        for (i = 0; i < S.visit.length; i++) if (S.visit[i].id === m.id) break;
        if (i === S.visit.length) return;
        var old = S.visit[i].dart;
        if (S.adapter && typeof S.adapter.undo === 'function' && typeof S.adapter.dart === 'function') {
          // bis zum korrigierten Dart zurücknehmen, dann neu eintragen
          for (var k = S.visit.length - 1; k >= i; k--) call('undo');
          S.visit[i].dart = m.dart;
          for (k = i; k < S.visit.length; k++) call('dart', S.visit[k].dart);
        } else {
          S.visit[i].dart = m.dart;
          call('replace', { index: i, old: old, dart: m.dart });
        }
        emit('replace', { index: i, old: old, dart: m.dart }); log('Korrigiert: ' + old.label + ' → ' + m.dart.label);
        break;
      case 'undo':
        for (i = 0; i < S.visit.length; i++) if (S.visit[i].id === m.id) break;
        if (i === S.visit.length) return;
        if (i === S.visit.length - 1) { call('undo'); }
        S.visit.splice(i, 1);
        emit('undo', { index: i }); log('Zurückgenommen');
        break;
      case 'takeout':
        S.visit = [];
        call('takeout'); emit('takeout', {}); log('Darts gezogen');
        break;
    }
  }

  /* ---------- Verbindung ---------- */
  function start() {
    if (S.peer) { try { S.peer.destroy(); } catch (e) {} }
    S.code = lsGet('uazlens.rxcode') || newCode();
    setStatus('verbinde …', false);
    var peer = S.peer = new window.Peer(PREFIX + S.code);
    peer.on('open', function () { setStatus('bereit – Code am iPhone eingeben', true); });
    peer.on('connection', function (c) {
      S.conns.push(c);
      c.on('data', handle);
      c.on('open', function () { setStatus('iPhone verbunden', true); });
      c.on('close', function () { S.conns = S.conns.filter(function (x) { return x !== c; }); setStatus(S.conns.length ? 'iPhone verbunden' : 'bereit – Code am iPhone eingeben', true); });
    });
    peer.on('disconnected', function () { setStatus('Verbindung zum Server unterbrochen …', false); try { peer.reconnect(); } catch (e) {} });
    peer.on('error', function (e) {
      if (e.type === 'unavailable-id') { newCode(); start(); }
      else setStatus('Fehler: ' + e.type, false);
    });
  }
  function setStatus(t, ok) { S.status = t; S.ok = ok; ui(); }

  /* ---------- Oberfläche (schwebender Knopf) ---------- */
  var css = '#uazl-btn{position:fixed;right:16px;bottom:16px;z-index:99999;width:54px;height:54px;border-radius:50%;border:0;background:#161b22;color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer}' +
    '#uazl-btn i{position:absolute;right:4px;top:4px;width:12px;height:12px;border-radius:50%;background:#f85149;border:2px solid #161b22}' +
    '#uazl-btn.ok i{background:#2ea043}' +
    '#uazl-pan{position:fixed;right:16px;bottom:80px;z-index:99999;width:270px;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:14px;padding:14px;font:14px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);display:none}' +
    '#uazl-pan.open{display:block}#uazl-pan h4{margin:0 0 8px;font-size:14px;letter-spacing:.08em}' +
    '#uazl-code{font-size:38px;font-weight:800;letter-spacing:.2em;text-align:center;color:#f0b429;margin:4px 0}' +
    '#uazl-st{font-size:12px;color:#8b949e;text-align:center;margin-bottom:8px}' +
    '#uazl-log{font-size:12px;color:#c9d1d9;border-top:1px solid #30363d;padding-top:6px;min-height:20px}' +
    '#uazl-pan button{font:inherit;font-size:12px;background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:8px;padding:6px 8px;margin:6px 4px 0 0;cursor:pointer}';
  var btn, pan;
  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    btn = document.createElement('button'); btn.id = 'uazl-btn'; btn.title = 'ÜAZ Lens'; btn.innerHTML = '📷<i></i>';
    pan = document.createElement('div'); pan.id = 'uazl-pan';
    pan.innerHTML = '<h4>ÜAZ LENS – Kamera</h4><div>Code am iPhone eingeben:</div><div id="uazl-code">----</div><div id="uazl-st"></div>' +
      '<div id="uazl-log"></div><div><button data-a="new">Neuer Code</button><button data-a="t20">Test T20</button><button data-a="bull">Test Bull</button></div>';
    document.body.appendChild(btn); document.body.appendChild(pan);
    btn.onclick = function () { pan.classList.toggle('open'); };
    pan.onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'new') { newCode(); start(); }
      if (a === 't20') UAZLens.simulate('T20');
      if (a === 'bull') UAZLens.simulate('BULL');
    };
    ui();
  }
  function ui() {
    if (!pan) return;
    pan.querySelector('#uazl-code').textContent = S.code || '----';
    pan.querySelector('#uazl-st').textContent = S.status;
    pan.querySelector('#uazl-log').innerHTML = S.log.join('<br>') || 'Noch keine Treffer.';
    btn.classList.toggle('ok', S.conns.length > 0);
  }

  /* ---------- öffentliche Schnittstelle ---------- */
  var simSeq = 0;
  window.UAZLens = {
    setAdapter: function (a) { S.adapter = a; },
    info: function (text) { S.conns.forEach(function (c) { try { c.send({ type: 'info', text: String(text) }); } catch (e) {} }); },
    simulate: function (code) {
      var d;
      if (code === 'BULL') d = { code: 'BULL', label: 'Bull', num: 25, mult: 2, value: 50 };
      else if (code === '25') d = { code: '25', label: '25', num: 25, mult: 1, value: 25 };
      else if (code === 'MISS') d = { code: 'MISS', label: 'Miss', num: 0, mult: 0, value: 0 };
      else { var m = { S: 1, D: 2, T: 3 }[code[0]], n = +code.slice(1); d = { code: code, label: m === 1 ? String(n) : code, num: n, mult: m, value: n * m }; }
      if (S.visit.length >= 3) handle({ type: 'takeout' });
      handle({ type: 'dart', id: 'sim-' + (simSeq++), dart: d });
    },
    get code() { return S.code; },
    get connected() { return S.conns.length > 0; }
  };

  function init() {
    build();
    if (window.Peer) return start();
    var s = document.createElement('script'); s.src = PEER_URL;
    s.onload = start;
    s.onerror = function () { setStatus('Verbindungsbibliothek nicht ladbar (Internet?)', false); };
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
