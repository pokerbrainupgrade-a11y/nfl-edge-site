/* 10.3 (Asana 1218657160170244) - bet entry on the site, restyled on the Command Center tokens (UI sprint 2026-10-10, S8,
   Asana 1219380564320263, D6). Sign in with Google; the Log control lives in TWO places only: the evidence view's
   "Decision & logging" section (pre-filled from that game's card) and the Bet Ledger ("My bets this week": log, edit,
   delete until kickoff, the Bets logged counts). With the placeholder web config there is no sign-in control and no
   Log control anywhere; the Ledger and the evidence view say "Bet logging not connected". Writes go to the Firestore
   intake queue bet_intake (10.2 rules: allowlist in the rules, bettor derived from the email, lock at kickoff; the Mac
   importer 10.4 moves pending docs into the SQLite ledger). Nothing here is a ledger: the site stays read-only without
   a login, and every write is one pending intake document.

   Reads window.NFL_EDGE_FIREBASE (assets/firebase-config.js) and the week app.js has in view (window.NFLEdge). The
   bettor name sent with a bet is the user's pick from Q / Mike / Marques, pre-filled from the signed-in name; the rules
   reject a name that is not the caller's own, and the form says so. */
(function () {
  'use strict';
  var FB = window.NFL_EDGE_FIREBASE || {};
  var BETTORS = ['Q', 'Mike', 'Marques'];
  var MARKETS = [['spread', 'Spread'], ['total', 'Total'], ['ml', 'Moneyline']];
  var state = { user: null, allowlisted: null, probe: null, bets: [], counts: null, editing: null, week: null, lastMsg: null, evidenceGame: null };
  var app = null, auth = null, db = null;
  var $hdr = document.querySelector('.hdr-in');
  var $btn = document.createElement('button');
  $btn.type = 'button'; $btn.id = 'auth-btn'; $btn.className = 'theme auth';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(id) { return document.getElementById(id); }
  function displayName(user) { return (user && (user.displayName || user.email)) || 'signed in'; }
  function bettorGuess(user) {
    var hints = [(user && user.displayName) || '', (user && user.email ? user.email.split('@')[0] : '')].join(' ').toLowerCase();
    for (var i = 0; i < BETTORS.length; i++) if (hints.indexOf(BETTORS[i].toLowerCase()) >= 0) return BETTORS[i];
    return null;
  }
  function phoenixLocal(date) {
    // datetime-local value in America/Phoenix (UTC-7, no DST)
    var t = new Date(date.getTime() - 7 * 3600 * 1000);
    return t.toISOString().slice(0, 16);
  }
  function fromPhoenixLocal(v) { return new Date(v + ':00-07:00'); }
  function tsToDate(ts) { return ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); }
  function fmt(d) { return d ? d.toLocaleString('en-US', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(',', '') + ' MST' : '—'; }
  function priceText(p) { return p > 0 ? '+' + p : '−' + Math.abs(p); }

  // ------------------------------------------------------------ header control (D6: none at all with the placeholder config)
  function renderButton() {
    if (!FB.enabled) { if ($btn.parentNode) $btn.parentNode.removeChild($btn); return; }
    if (!$btn.parentNode && $hdr) $hdr.appendChild($btn);
    if (!state.user) { $btn.textContent = 'Sign in with Google'; $btn.disabled = false; $btn.title = 'Log your bets (Q, Mike, Marques)'; return; }
    $btn.textContent = 'Sign out · ' + displayName(state.user);
    $btn.disabled = false;
    $btn.title = state.user.email || '';
  }
  $btn.addEventListener('click', function () {
    if (!FB.enabled || !auth) return;
    if (state.user) { auth.signOut(); return; }
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(function (e) { message('bad', 'Sign-in did not complete: ' + (e && e.message ? e.message : e)); });
  });

  if (!window.firebase || !FB.enabled) { renderButton(); return; }   // read-only site, unchanged: no control anywhere

  // ------------------------------------------------------------ firebase
  app = firebase.initializeApp(FB.config);
  auth = firebase.auth();
  db = firebase.firestore();
  if (FB.emulator) {
    auth.useEmulator(FB.emulatorHosts.auth, { disableWarnings: true });
    db.useEmulator(FB.emulatorHosts.firestoreHost, FB.emulatorHosts.firestorePort);
    // headless test hook: a Google credential the Auth emulator accepts (unsigned claims), see firebase/tests/ui.test.mjs
    window.nflEdgeTest = {
      signIn: function (email, name) {
        var claims = JSON.stringify({ sub: 'uid-' + email.split('@')[0], email: email, email_verified: true, name: name || email });
        return auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(claims));
      },
      signOut: function () { return auth.signOut(); },
      state: function () { return { user: state.user ? { email: state.user.email, uid: state.user.uid } : null, allowlisted: state.allowlisted, bets: state.bets.length, lastMsg: state.lastMsg }; }
    };
  }
  auth.onAuthStateChanged(function (user) {
    state.user = user; state.allowlisted = null; state.bets = []; state.counts = null; state.editing = null;
    renderButton();
    if (!user) { augment(); augmentEvidence(); return; }
    probe().then(function () { augment(); augmentEvidence(); });
  });

  function probe() {
    // the rules let an allowlisted user read the queue; anyone else gets permission-denied: that is the "not on the list" test
    return db.collection('bet_intake').limit(1).get().then(function () { state.allowlisted = true; })
      .catch(function (e) { state.allowlisted = (e && e.code === 'permission-denied') ? false : null; state.probe = e && e.message; });
  }

  // ------------------------------------------------------------ messages
  function message(kind, text) {
    state.lastMsg = text;
    var box = el('bets-msg');
    if (!box) return;
    box.className = 'banner ' + kind;
    box.textContent = text;
    box.hidden = false;
  }

  // ------------------------------------------------------------ the week in view (from app.js)
  function currentWeek() {
    var E = window.NFLEdge;
    return E && E.currentWeek ? E.currentWeek() : null;
  }
  function gameById(w, id) {
    var out = null;
    (w.games || []).forEach(function (g) { if (g.game_id === id) out = g; });
    return out;
  }
  function stateNote() {
    if (!state.user) return '';
    if (state.allowlisted === false) {
      return '<div class="banner bad" id="not-on-list"><b>Not on the list.</b> ' + esc(displayName(state.user)) + ' (' + esc(state.user.email || '') +
        ') is signed in but this Google address is not in the allowlist, so bets cannot be logged from it. Ask Q to add it (the list lives in the Firestore rules, deployed from the Mac).</div>';
    }
    if (state.allowlisted === null) {
      return '<div class="banner warn">Signed in, but the bet queue could not be reached' + (state.probe ? ' (' + esc(state.probe) + ')' : '') + '. The read-only site still works; try again when online.</div>';
    }
    return '';
  }

  // ------------------------------------------------------------ the Bet Ledger (app.js renders #bet-logging; this fills it)
  function augment() {
    var w = currentWeek();
    state.week = w;
    var host = el('bet-logging');
    if (!host) { liveCounts(w); return; }
    var body = host.querySelector('.pb');
    var old = el('bets-panel'); if (old) old.remove();
    var st = el('logging-state');
    if (!state.user) {
      if (st) st.textContent = 'Bet logging connected: sign in to log a manually placed bet.';
      liveCounts(w);
      return;
    }
    if (st) st.textContent = 'Signed in as ' + displayName(state.user) + '.';
    var panel = document.createElement('div');
    panel.id = 'bets-panel'; panel.className = 'bets-panel';
    var note = stateNote();
    if (note) { panel.innerHTML = note; body.insertBefore(panel, body.firstChild); return; }
    panel.innerHTML = '<div id="bets-msg" class="banner ok" hidden></div>' +
      '<div class="bets-mine"><div class="game-line"><h3>My bets this week</h3>' +
      (w ? '<button type="button" class="btn primary logbet-dash" id="logbet-dash">Log a bet</button>' : '<span class="small muted">no week loaded</span>') + '</div>' +
      '<div id="my-bets" class="small sec">Loading…</div></div>' +
      '<div id="betform-host"></div>';
    body.insertBefore(panel, body.firstChild);
    var dash = el('logbet-dash'); if (dash) dash.addEventListener('click', function () { openForm(w, null, null, el('betform-host')); });
    loadMyBets(w);
    liveCounts(w);
  }

  // ------------------------------------------------------------ the evidence view's "Decision & logging" section
  function augmentEvidence() {
    var sec = el('ev-log');
    if (!sec) return;
    var w = currentWeek();
    var ev = el('evidence');
    var gid = ev ? ev.getAttribute('data-game') : null;
    var g = w && gid ? gameById(w, gid) : null;
    var old = sec.querySelector('.ev-log-ui'); if (old) old.remove();
    var st = el('ev-log-state');
    if (!state.user) { if (st) st.textContent = 'Bet logging connected: sign in (top bar) to log a manually placed bet.'; return; }
    var note = stateNote();
    var ui = document.createElement('div');
    ui.className = 'ev-log-ui';
    if (note) { if (st) st.textContent = ''; ui.innerHTML = note; sec.appendChild(ui); return; }
    if (st) st.textContent = 'Records the bet you placed yourself at the sportsbook: bettor, book, side, line, price, stake and time.';
    ui.innerHTML = '<div id="bets-msg" class="banner ok" hidden></div>' + (g ? '<button type="button" class="btn primary logbet" data-game="' + esc(g.game_id) + '">Log manually placed bet</button>' : '<span class="small muted">no game in view</span>') + '<div id="betform-host"></div>';
    sec.appendChild(ui);
    var b = ui.querySelector('.logbet');
    if (b) b.addEventListener('click', function () { openForm(w, g, null, ui.querySelector('#betform-host')); });
  }

  // ------------------------------------------------------------ my bets (Ledger)
  function loadMyBets(w) {
    var box = el('my-bets');
    if (!box || !w) return;
    db.collection('bet_intake').where('bettor_uid', '==', state.user.uid).get().then(function (snap) {
      var rows = [];
      snap.forEach(function (d) { var x = d.data(); x._id = d.id; if (x.season === w.season && x.week === w.week) rows.push(x); });
      rows.sort(function (a, b) { return (tsToDate(b.placed_at) || 0) - (tsToDate(a.placed_at) || 0); });
      state.bets = rows;
      renderMyBets(w);
    }).catch(function (e) { box.innerHTML = '<span class="banner bad">Could not load your bets: ' + esc(e.message || e) + '</span>'; });
  }
  function betText(x) {
    if (x.market === 'ml') return x.side + ' ML';
    if (x.market === 'spread') return x.side + ' ' + (x.line > 0 ? '+' : '') + x.line;
    return x.side.toUpperCase() + ' ' + x.line;
  }
  function renderMyBets(w) {
    var box = el('my-bets');
    if (!box) return;
    if (!state.bets.length) { box.innerHTML = 'No bets logged for Week ' + esc(w.week) + ' yet.'; return; }
    var now = Date.now();
    box.innerHTML = '<ul class="bets-list">' + state.bets.map(function (x) {
      var g = gameById(w, x.game_id);
      var ko = tsToDate(x.kickoff_at);
      var open = x.status === 'pending' && ko && ko.getTime() > now;
      var st = x.status === 'rejected' ? '<span class="pill against">rejected</span> <span class="small muted">' + esc(x.reject_reason || 'no reason recorded') + '</span>'
        : '<span class="pill ' + (x.status === 'imported' ? 'survivor' : 'neutral') + '">' + esc(x.status) + '</span>';
      return '<li class="bet-row" data-id="' + esc(x._id) + '"><span class="m"><b class="num">' + esc(betText(x)) + ' (' + esc(priceText(x.price)) + ')</b> at ' + esc(x.book) +
        '</span><span class="small sec">' + esc(g ? g.matchup : x.game_id) + ' · ' + esc(x.stake_units) + 'u · ' + esc(x.bettor) + ' · placed ' + esc(fmt(tsToDate(x.placed_at))) + '</span>' +
        (x.note ? '<span class="small">' + esc(x.note) + '</span>' : '') + '<span>' + st + '</span>' +
        (open ? '<span class="bet-actions"><button type="button" class="btn bet-edit" data-id="' + esc(x._id) + '">Edit</button> <button type="button" class="btn bet-del" data-id="' + esc(x._id) + '">Delete</button></span>'
              : '<span class="small muted">' + (x.status === 'pending' ? 'closed at kickoff' : '') + '</span>') + '</li>';
    }).join('') + '</ul>';
    box.querySelectorAll('.bet-edit').forEach(function (b) {
      b.addEventListener('click', function () {
        var x = state.bets.filter(function (r) { return r._id === b.getAttribute('data-id'); })[0];
        if (x) openForm(w, gameById(w, x.game_id), x, el('betform-host'));
      });
    });
    box.querySelectorAll('.bet-del').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id');
        db.collection('bet_intake').doc(id).delete().then(function () { message('ok', 'Deleted.'); loadMyBets(w); liveCounts(w); })
          .catch(function (e) { message('bad', 'Delete refused: ' + esc(e.message || e)); });
      });
    });
  }

  // ------------------------------------------------------------ the Bets logged card (Ledger)
  function liveCounts(w) {
    var card = el('bets-logged');
    if (!card || !w || !state.user || state.allowlisted !== true) { if (FB.emulator) console.log('bets.js liveCounts: skipped', !!card, !!w, !!state.user, state.allowlisted); return; }
    db.collection('bet_intake').where('season', '==', w.season).where('week', '==', w.week).get().then(function (snap) {
      var counts = {}; BETTORS.forEach(function (b) { counts[b] = 0; });
      snap.forEach(function (d) {
        var x = d.data();
        if (x.status === 'rejected') return;
        var name = BETTORS.filter(function (b) { return b.toLowerCase() === String(x.bettor).toLowerCase(); })[0] || x.bettor;
        counts[name] = (counts[name] || 0) + 1;
      });
      state.counts = counts;
      card.className = 'card';
      card.innerHTML = '<h3>Bets logged <span class="small muted">Week ' + esc(w.week) + ' · read from the intake queue just now</span></h3><div class="kv">' +
        Object.keys(counts).map(function (b) { return '<div class="k">' + esc(b) + '</div><div class="v num">' + esc(counts[b]) + '</div>'; }).join('') + '</div>';
    }).catch(function (e) { if (FB.emulator) console.log('bets.js liveCounts error:', e && e.message ? e.message : e); /* the placeholder stays */ });
  }

  // ------------------------------------------------------------ the form (hosted in the evidence section or the Ledger)
  function closeForm() { document.querySelectorAll('#betform-host').forEach(function (h) { h.innerHTML = ''; }); state.editing = null; }
  function openForm(w, g, existing, host) {
    host = host || el('betform-host');
    if (!host || !w) return;
    closeForm();
    state.editing = existing || null;
    var games = (w.games || []).slice().sort(function (a, b) { return String(a.kickoff_phoenix).localeCompare(String(b.kickoff_phoenix)); });
    var g0 = g || (existing ? gameById(w, existing.game_id) : null) || games[0];
    var tagm = g0 ? (g0.tag_market || 'spread') : 'spread';
    var shop = g0 && g0[tagm] ? g0[tagm].number_to_shop : null;
    var x = existing || {};
    var market = x.market || (tagm === 'total' ? 'total' : 'spread');
    var side = x.side || (g0 && g0[tagm] && g0[tagm].lean_side) || (g0 ? g0.home : '');
    var line = x.line != null ? x.line : (shop && shop.line != null ? shop.line : '');
    var price = x.price != null ? x.price : (shop && shop.price != null ? shop.price : -110);
    var books = (w.books || []).slice();
    var book = x.book || (shop && shop.book) || books[0] || '';
    if (book && books.indexOf(book) < 0) books.push(book);
    var bettor = x.bettor ? (BETTORS.filter(function (b) { return b.toLowerCase() === x.bettor; })[0] || BETTORS[0]) : (bettorGuess(state.user) || BETTORS[0]);
    var placed = x.placed_at ? phoenixLocal(tsToDate(x.placed_at)) : phoenixLocal(new Date());
    var tagHtml = function (gg) { return gg && gg.tag ? 'Tag at entry: <span class="tag ' + (gg.tag === 'BET' ? 'bet' : gg.tag === 'POSSIBLE BET' ? 'possible' : 'nobet') + '">' + esc(gg.tag) + '</span> <span class="num">#' + esc(gg.tag_rank) + '</span>' : 'Tag at entry: none'; };
    host.innerHTML = '<form class="card betform" id="betform" autocomplete="off">' +
      '<h3>' + (existing ? 'Edit bet' : 'Log manually placed bet') + ' <span class="small muted">Week ' + esc(w.week) + '</span></h3>' +
      '<label>Game <select name="game_id" id="bf-game">' + games.map(function (gg) {
        return '<option value="' + esc(gg.game_id) + '"' + (g0 && gg.game_id === g0.game_id ? ' selected' : '') + '>' + esc(gg.matchup) + ' · ' + esc(gg.kickoff_display) + (gg.tag ? ' · ' + esc(gg.tag) : '') + '</option>';
      }).join('') + '</select></label>' +
      '<div class="small" id="bf-tag">' + tagHtml(g0) + '</div>' +
      '<div class="bf-grid">' +
      '<label>Market <select name="market" id="bf-market">' + MARKETS.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === market ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label>' +
      '<label>Side <input name="side" id="bf-side" value="' + esc(side) + '" maxlength="8" required></label>' +
      '<label>Line <input name="line" id="bf-line" type="number" step="0.5" value="' + esc(line) + '"></label>' +
      '<label>Price <input name="price" id="bf-price" type="number" step="1" value="' + esc(price) + '" required></label>' +
      '<label>Book <select name="book" id="bf-book">' + books.map(function (b) { return '<option value="' + esc(b) + '"' + (b === book ? ' selected' : '') + '>' + esc(b) + '</option>'; }).join('') + '</select></label>' +
      '<label>Stake (units) <input name="stake" id="bf-stake" type="number" step="0.5" min="0.5" max="100" value="' + esc(x.stake_units != null ? x.stake_units : 1) + '" required></label>' +
      '<label>Placed at (Phoenix) <input name="placed_at" id="bf-placed" type="datetime-local" value="' + esc(placed) + '" required></label>' +
      '<label>You are <select name="bettor" id="bf-bettor">' + BETTORS.map(function (b) { return '<option value="' + b + '"' + (b === bettor ? ' selected' : '') + '>' + b + '</option>'; }).join('') + '</select></label>' +
      '</div>' +
      '<label>Note <input name="note" id="bf-note" maxlength="140" value="' + esc(x.note || '') + '" placeholder="optional, 140 characters"></label>' +
      '<div class="bf-actions"><button type="submit" class="btn primary" id="bf-save">' + (existing ? 'Save changes' : 'Log it') + '</button> <button type="button" class="btn" id="bf-cancel">Cancel</button></div>' +
      '<div class="small muted">Saved as a pending intake entry; the Mac importer moves it into the ledger. Edit or delete until kickoff.</div>' +
      '</form>';
    el('bf-cancel').addEventListener('click', closeForm);
    el('bf-game').addEventListener('change', function () {
      var gg = gameById(w, el('bf-game').value);
      if (!gg) return;
      var tm = gg.tag_market || 'spread';
      var sh = gg[tm] ? gg[tm].number_to_shop : null;
      el('bf-market').value = tm === 'total' ? 'total' : 'spread';
      el('bf-side').value = (gg[tm] && gg[tm].lean_side) || gg.home;
      el('bf-line').value = sh && sh.line != null ? sh.line : '';
      el('bf-price').value = sh && sh.price != null ? sh.price : -110;
      if (sh && sh.book) el('bf-book').value = sh.book;
      el('bf-tag').innerHTML = tagHtml(gg);
    });
    el('betform').addEventListener('submit', function (ev) { ev.preventDefault(); submit(w); });
    host.scrollIntoView({ block: 'start' });
  }

  function submit(w) {
    var gg = gameById(w, el('bf-game').value);
    if (!gg) { message('bad', 'Pick a game.'); return; }
    var market = el('bf-market').value;
    var lineRaw = el('bf-line').value;
    var line = market === 'ml' ? null : (lineRaw === '' ? null : Number(lineRaw));
    if (market !== 'ml' && line == null) { message('bad', 'A ' + market + ' bet needs a line.'); return; }
    var price = Number(el('bf-price').value);
    if (!(price <= -100 || price >= 100)) { message('bad', 'Price is American odds: -110, +150 …'); return; }
    var stake = Number(el('bf-stake').value);
    var placed = fromPhoenixLocal(el('bf-placed').value);
    var ko = new Date(gg.kickoff_phoenix);
    var side = el('bf-side').value.trim();
    if (market === 'total') side = side.toLowerCase();
    var bettor = el('bf-bettor').value.toLowerCase();
    var doc = {
      bettor_uid: state.user.uid, bettor: bettor, season: w.season, week: w.week, game_id: gg.game_id,
      market: market, side: side, line: line, price: price, book: el('bf-book').value, stake_units: stake,
      placed_at: firebase.firestore.Timestamp.fromDate(placed), kickoff_at: firebase.firestore.Timestamp.fromDate(ko),
      tag_at_entry: gg.tag || null, tag_rank_at_entry: gg.tag_rank == null ? null : gg.tag_rank,
      note: el('bf-note').value.trim() || null, status: 'pending', import_ref: null, schema_version: 1
    };
    var save = el('bf-save'); save.disabled = true;
    var p;
    if (state.editing) {
      // identity, created_at and kickoff_at cannot change (rules); send the editable fields only
      var upd = { market: doc.market, side: doc.side, line: doc.line, price: doc.price, book: doc.book, stake_units: doc.stake_units,
                  placed_at: doc.placed_at, note: doc.note, game_id: doc.game_id, tag_at_entry: doc.tag_at_entry, tag_rank_at_entry: doc.tag_rank_at_entry, bettor: doc.bettor };
      p = db.collection('bet_intake').doc(state.editing._id).update(upd).then(function () { message('ok', 'Saved. Still pending for the Mac importer.'); });
    } else {
      doc.created_at = firebase.firestore.FieldValue.serverTimestamp();
      p = db.collection('bet_intake').add(doc).then(function () { message('ok', 'Logged: ' + betText(doc) + ' at ' + doc.book + ' (pending). It stays editable until kickoff.'); });
    }
    p.then(function () { closeForm(); loadMyBets(w); liveCounts(w); })
      .catch(function (e) {
        save.disabled = false;   // the form keeps its contents
        var why = e && e.code === 'permission-denied'
          ? 'Firestore refused this entry. The name must be your own (the rules derive it from your Google address), the game must be ahead of kickoff and every field in range.'
          : (e && e.code === 'unavailable' ? 'You look offline. Nothing was saved; your entries are still here, try again.' : 'Not saved: ' + (e && e.message ? e.message : e));
        message('bad', why);
      });
  }

  // ------------------------------------------------------------ wire to the app's renders
  window.addEventListener('nfl-edge:rendered', augment);
  window.addEventListener('nfl-edge:evidence', augmentEvidence);
  renderButton();
})();
