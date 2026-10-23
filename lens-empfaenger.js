/* ÜAZ Lens – Empfänger-Baustein fürs Dartbord  (v3, Übertragung per MQTT – WLAN & Mobilfunk)
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
  var MQTT_URL = 'https://cdn.jsdelivr.net/npm/mqtt@5/dist/mqtt.min.js';
  var BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
  var TOPIC = 'uaz-waren/lens/v1/';
  var S = { clients: [], code: null, adapter: null, visit: [], seen: {}, seenList: [], lastSeen: 0, log: [] };

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
  function phoneOnline() { return Date.now() - S.lastSeen < 15000; }

  /* ---------- Nachrichten vom iPhone ---------- */
  function handle(m) {
    if (!m || !m.type) return;
    var i;
    switch (m.type) {
      case 'hello': log('Lens verbunden'); break;
      case 'dart':
        for (i = 0; i < S.visit.length; i++) if (S.visit[i].id === m.id) return;
        // Gleichlauf: erster Dart einer neuen Aufnahme am iPhone -> alte Aufnahme am PC abschließen
        if ((m.idx === 0 && S.visit.length) || S.visit.length >= 3) handle({ type: 'takeout' });
        S.visit.push({ id: m.id, dart: m.dart });
        call('dart', m.dart); emit('dart', m.dart); log('Treffer: ' + m.dart.label);
        break;
      case 'replace':
        for (i = 0; i < S.visit.length; i++) if (S.visit[i].id === m.id) break;
        if (i === S.visit.length) return;
        var old = S.visit[i].dart;
        if (S.adapter && typeof S.adapter.undo === 'function' && typeof S.adapter.dart === 'function') {
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
        if (i === S.visit.length - 1) call('undo');
        S.visit.splice(i, 1);
        emit('undo', { index: i }); log('Zurückgenommen');
        break;
      case 'takeout':
        S.visit = [];
        call('takeout'); emit('takeout', {}); log('Darts gezogen');
        break;
    }
  }
  function onMessage(topic, buf) {
    var m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    // Nachrichten kommen über zwei Server doppelt an -> nur einmal verarbeiten
    if (m.mid) { if (S.seen[m.mid]) return; S.seen[m.mid] = 1; S.seenList.push(m.mid); if (S.seenList.length > 300) delete S.seen[S.seenList.shift()]; }
    var wasOnline = phoneOnline();
    S.lastSeen = Date.now();
    if (!wasOnline) ui();
    handle(m);
  }

  /* ---------- Verbindung ---------- */
  function stop() {
    S.clients.forEach(function (c) {
      try { if (c.connected) c.publish(TOPIC + S.code + '/pc', 'offline', { qos: 1, retain: true }); } catch (e) {}
      try { c.end(false); } catch (e) {}
    });
    S.clients = [];
  }
  function start() {
    stop();
    S.code = lsGet('uazlens.rxcode') || newCode();
    S.lastSeen = 0; ui();
    var base = TOPIC + S.code;
    BROKERS.forEach(function (url) {
      var c = window.mqtt.connect(url, {
        clientId: 'uazlens-pc-' + Math.random().toString(16).slice(2, 10),
        reconnectPeriod: 2000, connectTimeout: 8000, clean: true,
        will: { topic: base + '/pc', payload: 'offline', qos: 1, retain: true }
      });
      c.on('connect', function () {
        c.subscribe(base + '/tx', { qos: 1 });
        c.publish(base + '/pc', 'online', { qos: 1, retain: true });
        ui();
      });
      c.on('message', onMessage);
      c.on('offline', ui); c.on('close', ui); c.on('error', function () {});
      S.clients.push(c);
    });
  }
  function serverUp() { return S.clients.some(function (c) { return c.connected; }); }
  window.addEventListener('pagehide', stop);
  setInterval(ui, 3000);

  /* ---------- Oberfläche (schwebender Knopf) ---------- */
  var css = '#uazl-btn{position:fixed;right:16px;bottom:16px;z-index:99999;width:54px;height:54px;border-radius:50%;border:0;background:#161b22;color:#fff;font-size:24px;box-shadow:0 4px 14px rgba(0,0,0,.4);cursor:pointer}' +
    '#uazl-btn i{position:absolute;right:4px;top:4px;width:12px;height:12px;border-radius:50%;background:#f85149;border:2px solid #161b22}' +
    '#uazl-btn.ready i{background:#f0b429}#uazl-btn.ok i{background:#2ea043}' +
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
    pan.innerHTML = '<h4>ÜAZ LENS – Kamera <small style="color:#8b949e">v4</small></h4><div>Code am iPhone eingeben:</div><div id="uazl-code">----</div><div id="uazl-st"></div>' +
      '<div id="uazl-log"></div><div><button data-a="new">Neuer Code</button><button data-a="t20">Test T20</button><button data-a="bull">Test Bull</button></div>';
    document.body.appendChild(btn); document.body.appendChild(pan);
    btn.onclick = function () { pan.classList.toggle('open'); };
    pan.onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a');
      if (a === 'new') { stop(); newCode(); start(); }
      if (a === 't20') UAZLens.simulate('T20');
      if (a === 'bull') UAZLens.simulate('BULL');
    };
    ui();
  }
  function ui() {
    if (!pan) return;
    var up = serverUp(), ph = phoneOnline();
    pan.querySelector('#uazl-code').textContent = S.code || '----';
    pan.querySelector('#uazl-st').textContent = !up ? 'verbinde mit Server … (Internet?)' : ph ? 'iPhone verbunden' : 'bereit – Code am iPhone eingeben';
    pan.querySelector('#uazl-log').innerHTML = S.log.join('<br>') || 'Noch keine Treffer.';
    btn.classList.toggle('ready', up && !ph);
    btn.classList.toggle('ok', up && ph);
  }

  /* ---------- öffentliche Schnittstelle ---------- */
  var simSeq = 0;
  window.UAZLens = {
    setAdapter: function (a) { S.adapter = a; },
    info: function (text) {
      var s = JSON.stringify({ type: 'info', text: String(text), mid: 'i' + Date.now() + Math.random() });
      S.clients.forEach(function (c) { try { if (c.connected) c.publish(TOPIC + S.code + '/rx', s, { qos: 1 }); } catch (e) {} });
    },
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
    get connected() { return phoneOnline(); }
  };

  function init() {
    build();
    if (window.mqtt) return start();
    var s = document.createElement('script'); s.src = MQTT_URL;
    s.onload = start;
    s.onerror = function () { pan.querySelector('#uazl-st').textContent = 'Verbindungsbibliothek nicht ladbar (Internet?)'; };
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
