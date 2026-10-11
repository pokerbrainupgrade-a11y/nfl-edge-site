/* NFL Edge — desktop Command Center + phone Companion (UI sprint 2026-10-10, Asana 1219380564320263).
   Plain JS, hash routing, renders from data/*.json only (D2: read-only; nothing here computes a tag, a rank, an edge,
   a weight or an angle status; see docs/ui/field_map.md for every path read).
   Routes: #/week[/<id>[/<game_id>]] | #/slate[/<id>] | #/angles | #/ledger | #/system[/<section>]
   Old links keep rendering: #/dashboard -> #/week, #/weeks[/<id>[/<game>]] -> #/week/..., #/appendix[/<s>] -> #/system/<s>. */
(function () {
  'use strict';

  const TZ = 'America/Phoenix';
  const STALE_SCAN_DAYS = 8;
  const BETTORS = ['Q', 'Mike', 'Marques'];
  const LANES = ['BET', 'POSSIBLE BET', 'NO BET'];
  const TAG_CLASS = { 'BET': 'bet', 'POSSIBLE BET': 'possible', 'NO BET': 'nobet' };
  const state = { manifest: null, angles: null, shadow: null, clv: null, weeks: {}, viewWeek: null,
                  filter: 'all', nobetOpen: false, sort: 'rank', view: null, weekId: null, failed: {},
                  rendered: null, evidence: null, scrollBefore: 0 };   // rendered = {view, id}: the main canvas in place; evidence = open game id
  const $main = document.getElementById('main');
  const $sel = document.getElementById('wk-sel');
  const $asof = document.getElementById('asof');
  const $chip = document.getElementById('scan-chip');
  const $srcs = document.getElementById('srcs');

  // ------------------------------------------------------------ helpers
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function parts(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const g = (t) => (p.find((x) => x.type === t) || {}).value || '';
    return { day: g('weekday'), date: g('year') + '-' + g('month') + '-' + g('day'), time: g('hour') + ':' + g('minute'), ms: d.getTime() };
  }
  const tsFull = (iso) => { const p = parts(iso); return p ? p.date + ' ' + p.time + ' MST' : 'Timestamp unavailable'; };
  const tsShort = (iso) => { const p = parts(iso); return p ? p.day + ' ' + p.time + ' MST' : 'Timestamp unavailable'; };
  const kick = (iso) => { const p = parts(iso); return p ? p.day + ' ' + p.date + ' · ' + p.time + ' MST' : 'Kickoff unavailable'; };
  const kickDay = (iso) => { const p = parts(iso); return p ? p.day + ' ' + p.date : 'Kickoff unavailable'; };
  const ageHours = (iso) => { const p = parts(iso); return p ? (Date.now() - p.ms) / 36e5 : null; };
  const signed = (v, digits) => v == null || isNaN(v) ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Number(v)).toFixed(digits == null ? 1 : digits).replace(/\.0+$/, '');
  const price = (v) => v == null ? '—' : (v > 0 ? '+' : '−') + Math.abs(Number(v));
  const pct = (v) => v == null ? '—' : Number(v).toFixed(1) + '%';
  const score = (v) => v == null ? '—' : (Number(v) === 0 ? '0' : Number(v).toFixed(2).replace(/\.?0+$/, ''));   // strength score, no unit
  const lineText = (market, side, line) => line == null || !side ? '—' : (market === 'spread' ? side + ' ' + signed(line) : side + ' ' + line);
  const tagHtml = (tag) => tag ? '<span class="tag ' + (TAG_CLASS[tag] || 'unknown') + '">' + esc(tag) + '</span>' : '<span class="tag unknown">Not classified</span>';
  const pill = (cls, text) => '<span class="pill ' + esc(cls) + '">' + esc(text || cls) + '</span>';
  const chip = (cls, text) => '<span class="chip ' + esc(cls) + '">' + esc(text) + '</span>';
  function fetchJSON(path) {
    return fetch(path + (path.indexOf('?') < 0 ? '?' : '&') + 'v=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
      return r.json();
    });
  }
  const ICON = {
    check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 3L5 14h6l-1 7 9-11h-6z"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    db: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
    chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M8 15l4-5 3 3 5-7"/></svg>'
  };

  // ------------------------------------------------------------ data access
  function weekEntry(id) { return (state.manifest.weeks || []).find((w) => w.id === id) || null; }
  function latestId() { return state.manifest && state.manifest.latest_week; }
  function loadWeek(id) {
    if (state.weeks[id]) return Promise.resolve(state.weeks[id]);
    const entry = weekEntry(id);
    if (!entry) return Promise.reject(new Error('No scan on file for ' + id));
    return fetchJSON('data/' + entry.file).then((d) => { state.weeks[id] = d; return d; });
  }
  const cardFor = (w, gid) => (w.bet_cards || []).find((c) => c.game_id === gid) || null;
  const gameById = (w, gid) => (w.games || []).find((g) => g.game_id === gid) || null;
  const lanes = (w) => (w.counts && w.counts.lanes) || null;
  const byRank = (a, b) => ((a.tag_rank == null ? 1e9 : a.tag_rank) - (b.tag_rank == null ? 1e9 : b.tag_rank)) || String(a.kickoff_phoenix).localeCompare(String(b.kickoff_phoenix));
  const byKick = (a, b) => String(a.kickoff_phoenix).localeCompare(String(b.kickoff_phoenix)) || byRank(a, b);
  function shop(g) { const m = g[g.tag_market || 'spread']; return m && m.number_to_shop ? m.number_to_shop : null; }
  function allPlayed(w) { return (w.games || []).length > 0 && (w.games || []).every((g) => { const p = parts(g.kickoff_phoenix); return p && p.ms < Date.now(); }); }

  // ------------------------------------------------------------ freshness (H6: scan time, odds time, verification are separate)
  function oddsState(w) {
    const lp = w.odds_pull || {};
    if (!lp.succeeded) return { cls: 'bad', word: 'Failed', detail: lp.detail || 'odds capture failed or missing' };
    const limit = (w.rules || {}).stale_after_hours;
    const age = ageHours(lp.fetched_at);
    if (lp.stale) return { cls: 'warn', word: 'Stale', detail: lp.detail || 'stale at scan time' };
    if (limit != null && age != null && age > limit && !allPlayed(w)) return { cls: 'warn', word: 'Stale', detail: 'captured ' + Math.floor(age) + ' h ago, past the ' + limit + ' h window' };
    return { cls: 'ok', word: 'Current', detail: lp.detail || '' };
  }
  function scanState(w) {
    if (!w) return { cls: 'bad', word: 'Missing', detail: 'Latest weekly scan unavailable' };
    const age = ageHours(w.generated_at);
    if (age != null && age > STALE_SCAN_DAYS * 24 && !allPlayed(w)) return { cls: 'warn', word: 'Stale', detail: 'scan is ' + Math.floor(age / 24) + ' days old' };
    return { cls: 'ok', word: 'Current', detail: 'scan ' + tsFull(w.generated_at) };
  }
  function verifyState(w) {
    const wr = w.week_resolution;
    if (!wr) return { cls: 'neutral', word: 'Not recorded', detail: 'Week verification not recorded for this scan' };
    if (wr.flag) return { cls: 'warn', word: 'Unverified', detail: wr.flag + ': ' + (wr.detail || '') };
    return { cls: 'ok', word: 'Verified', detail: wr.detail || '' };
  }
  // H8 severity: source failure > stale / unverified > a positive suggestion. One banner block, worst first.
  function banners(w) {
    const out = [];
    if (!w) return '<div class="banner bad" id="banner-missing"><b>Latest weekly scan unavailable.</b> No week file could be read. Nothing is suggested.</div>';
    if (!(w.games || []).length) out.push('<div class="banner bad"><b>Latest weekly scan unavailable.</b> The scan for ' + esc(w.id) + ' holds no games. Nothing is suggested.</div>');
    const os = oddsState(w);
    if (os.cls === 'bad') out.push('<div class="banner bad" id="banner-odds"><b>Odds capture failed.</b> ' + esc(os.detail) + '. Prices below are not current; nothing to shop.</div>');
    else if (os.cls === 'warn') out.push('<div class="banner warn" id="banner-odds"><b>Odds last captured ' + esc(tsShort((w.odds_pull || {}).fetched_at)) + '</b> (' + esc(os.detail) + ') — check the sportsbook before recording a bet.</div>');
    const vs = verifyState(w);
    if (vs.cls === 'warn') out.push('<div class="banner warn" id="banner-week"><b>' + esc(w.week_resolution.flag) + '.</b> ' + esc(w.week_resolution.detail || '') + '</div>');
    if (allPlayed(w)) out.push('<div class="banner info" id="banner-hist"><b>Historical week.</b> Every kickoff in ' + esc(w.id) + ' has passed; the suggestions and prices are the record of that scan, not current.</div>');
    return out.join('');
  }

  // ------------------------------------------------------------ chrome: week selector, as-of, chip, sidebar sources
  function renderChrome(w) {
    const weeks = state.manifest.weeks || [];
    $sel.innerHTML = weeks.map((e) => '<option value="' + esc(e.id) + '"' + (w && e.id === w.id ? ' selected' : '') + '>' + esc(e.season) + ' · Week ' + esc(e.week) +
      (e.counts && e.counts.lanes ? ' · BET ' + esc(e.counts.lanes['BET']) : '') + '</option>').join('');
    if (!weeks.length) $sel.innerHTML = '<option>No scan on file</option>';
    $asof.textContent = w ? 'Data as of ' + tsFull(w.generated_at) : 'No scan on file';
    const ss = scanState(w);
    $chip.className = 'chip ' + ss.cls; $chip.textContent = 'Scan ' + ss.word.toLowerCase();
    const os = w ? oddsState(w) : { cls: 'bad', word: 'Missing' };
    const scanT = w ? tsShort(w.generated_at) : '—';
    const oddsT = w ? tsShort((w.odds_pull || {}).fetched_at) : '—';
    const led = state.clv ? { cls: 'ok', word: 'Connected', t: tsShort(state.clv.generated_at) } : { cls: 'neutral', word: 'Not connected', t: 'no export yet' };
    $srcs.innerHTML = '<div class="tiny">Data sources</div>' +
      '<div class="src"><span class="k">Scanner</span>' + chip(ss.cls, ss.word) + '<span class="t">Last run ' + esc(scanT) + '</span></div>' +
      '<div class="src"><span class="k">Odds feed</span>' + chip(os.cls, os.word) + '<span class="t">Last capture ' + esc(oddsT) + '</span></div>' +
      '<div class="src"><span class="k">Ledger</span>' + chip(led.cls, led.word) + '<span class="t">' + esc(led.t) + '</span></div>';
  }
  function setNav(name) {
    document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.getAttribute('data-nav') === name));
  }
  $sel.addEventListener('change', () => { if ($sel.value) location.hash = '#/' + (state.view === 'slate' ? 'slate' : 'week') + '/' + $sel.value; });
  // H5.3: on the phone the header chip opens a sheet with the scanner / odds / ledger capture times (the sidebar block)
  const $sheet = document.getElementById('status-sheet');
  $chip.addEventListener('click', () => {
    if (!$sheet) return;
    if (!$sheet.hidden) { $sheet.hidden = true; return; }
    $sheet.innerHTML = '<div class="tiny">Data sources · all times America/Phoenix (MST)</div>' + $srcs.innerHTML.replace('<div class="tiny">Data sources</div>', '') +
      '<div class="small sec" style="margin-top:6px">Data as of ' + esc($asof.textContent.replace(/^Data as of /, '')) + '</div><button type="button" class="btn" id="sheet-close">Close</button>';
    $sheet.hidden = false;
    document.getElementById('sheet-close').addEventListener('click', () => { $sheet.hidden = true; });
  });

  // ------------------------------------------------------------ shared pieces
  function headRow(w, title, ctl) {
    return '<div class="head"><div><h1>' + esc(title) + '</h1><div class="subl">NFL ' + esc(w.season) + ' regular season · Scan <span class="num">' + esc(tsFull(w.generated_at)) +
      '</span> · Odds <span class="num">' + esc(tsFull((w.odds_pull || {}).fetched_at)) + '</span></div></div>' + (ctl ? '<div class="ctl">' + ctl + '</div>' : '') + '</div>';
  }
  function suggestion(w, g) {
    // the scanner's own words only: the bet card for BET / POSSIBLE BET rows; NO BET rows have no card
    const c = cardFor(w, g.game_id);
    if (c) return { text: c.bet, price: c.price, book: c.book, card: c, q: c.market + ' · ' + c.place_label };
    if (g.tag === 'NO BET') return { text: 'No suggested wager', price: null, book: null, card: null, q: g.tag_reason || '' };
    return { text: 'No recommendation recorded', price: null, book: null, card: null, q: w.bet_cards ? '' : 'this scan predates bet cards' };
  }
  function offerHtml(w, g) {
    const n = shop(g);
    if (!n) return '<span class="muted">Price unavailable</span>';
    const mk = g.tag_market || 'spread', m = g[mk] || {};
    return '<span class="price">' + esc(lineText(mk, m.lean_side, n.line)) + ' (' + esc(price(n.price)) + ')</span><div class="q">' + esc(n.book) + ' · ' + esc(tsShort((w.odds_pull || {}).fetched_at)) + '</div>';
  }
  function angleCell(g) {
    const f = g.angles_fired || [];
    if (!f.length) return '<span class="muted">No angle fired</span>';
    const cnt = f.filter((a) => a.tier === 'survivor').length;
    return '<span class="n1">' + esc(f[0].name) + '</span> ' + pill(f[0].tier) + (f.length > 1 ? '<div class="q">+' + (f.length - 1) + ' more · ' + cnt + ' survivor</div>' : '');
  }
  function coverage(w) {
    const wr = w.week_resolution || null;
    const scanned = (w.counts || {}).games;
    if (!wr || wr.slate_games == null) return { value: '—', sub: 'Coverage unavailable · ' + (scanned != null ? scanned + ' games scanned' : 'scan count unavailable') };
    return { value: scanned + ' / ' + wr.slate_games, sub: 'scanned / on the odds board · ' + wr.matched + ' matched to the schedule' };
  }
  function clvTile() {
    const c = state.clv && state.clv.all;
    if (!c) return { value: '—', sub: 'No system-sourced bets logged', cls: '' };
    return { value: signed(c.mean_clv_prob, 4), sub: 'mean CLV (probability) · n ' + c.graded + ' graded of ' + c.bets + ' real bets', cls: '' };
  }

  // ------------------------------------------------------------ view: Command Center (#/week)
  function viewWeek(id, gameId) {
    setNav('week');
    const target = id || latestId();
    if (!target) { renderChrome(null); $main.innerHTML = banners(null); announce('week', null); return; }
    loadWeek(target).then((w) => {
      renderChrome(w);
      const ln = lanes(w) || {};
      const cov = coverage(w), clv = clvTile();
      if (gameId) { const g = gameById(w, gameId); if (g && g.tag === 'NO BET' && state.filter === 'all') state.nobetOpen = true; }   // a deep link to a NO BET game shows its row
      let html = headRow(w, 'Week ' + w.week + ' — Command Center', '<span class="dsort">Ranked by the scanner (tag rank)</span>');
      html += banners(w);
      html += '<div class="kpis desk">' +
        '<div class="kpi bet" id="kpi-bet"><div class="k">BET</div><div class="v">' + esc(ln['BET'] != null ? ln['BET'] : '—') + '</div><div class="s">Qualified by the latest scan</div>' + ICON.target.replace('<svg', '<svg class="ic"') + '</div>' +
        '<div class="kpi possible" id="kpi-possible"><div class="k">POSSIBLE BET</div><div class="v">' + esc(ln['POSSIBLE BET'] != null ? ln['POSSIBLE BET'] : '—') + '</div><div class="s">Watch / conditional review</div>' + ICON.eye.replace('<svg', '<svg class="ic"') + '</div>' +
        '<div class="kpi" id="kpi-cov"><div class="k">Slate coverage</div><div class="v">' + esc(cov.value) + '</div><div class="s">' + esc(cov.sub) + '</div>' + ICON.check.replace('<svg', '<svg class="ic"') + '</div>' +
        '<div class="kpi" id="kpi-clv"><div class="k">Real-bet CLV</div><div class="v" id="kpi-clv-v">' + esc(clv.value) + '</div><div class="s">' + esc(clv.sub) + '</div>' + ICON.chart.replace('<svg', '<svg class="ic"') + '</div>' +
        '</div>';
      html += '<div class="asofline">As of the ' + esc(tsFull(w.generated_at)) + ' scan · odds captured ' + esc(tsFull((w.odds_pull || {}).fetched_at)) + ' · ' + esc((w.books || []).join(', ') || 'books unavailable') + '</div>';
      html += phoneFeed(w);   // S5: the phone Week feed (hidden on desktop by CSS; the desktop panels are hidden on the phone)
      html += '<div class="grid2 desk"><div class="col">' + oppsPanel(w) + '</div><div class="col">' + integrityPanel(w) + angleEvidencePanel(w) + '</div></div>';
      html += '<div class="grid2 lower desk"><div class="col">' + movementPanel(w) + '</div><div class="col">' + clvPanel() + '</div></div>';
      html += '<div class="desk">' + matrixPanel(w) + '</div>';
      $main.innerHTML = html;
      bindWeek(w);
      bindFeed(w);
      state.rendered = { view: 'week', id: w.id };
      window.scrollTo(0, state.keepScroll != null ? state.keepScroll : 0);
      state.keepScroll = null;
      announce('week', w);
      if (gameId) openEvidence(w, gameId);
    }).catch(fail);
  }
  // a filter, sort or NO BET toggle re-renders the canvas in place: same route, scroll kept
  function rerender() { state.keepScroll = window.scrollY; state.rendered = null; route(); }

  // ------------------------------------------------------------ S5: the phone Week feed (H5.2-H5.6, H5.10)
  // Same facts as the desktop table: tag, matchup, kickoff, the card's bet and price, the captured offer, the angle strip.
  function feedCard(w, g) {
    const s = suggestion(w, g), n = shop(g), os = oddsState(w), f = g.angles_fired || [];
    const href = '#/week/' + esc(w.id) + '/' + esc(g.game_id);
    if (g.tag === 'NO BET') {
      return '<div class="card fc thin" id="fc-' + esc(g.game_id) + '"><div class="l1">' + tagHtml(g.tag) + '<span class="small muted num">#' + esc(g.tag_rank != null ? g.tag_rank : '—') + '</span></div>' +
        '<div class="mu">' + esc(g.away) + ' @ ' + esc(g.home) + '</div><div class="ko">' + esc(kick(g.kickoff_phoenix)) + '</div>' +
        '<div class="off">No qualified play' + (g.tag_reason ? ' · ' + esc(g.tag_reason) : '') + '</div>' +
        '<a class="cta rev-link" href="' + href + '">Scanner reasons ›</a></div>';
    }
    let h = '<div class="card fc" id="fc-' + esc(g.game_id) + '"><div class="l1">' + tagHtml(g.tag) + '<span class="small muted num">#' + esc(g.tag_rank != null ? g.tag_rank : '—') + '</span></div>';
    h += '<div class="mu">' + esc(g.away) + ' @ ' + esc(g.home) + '</div><div class="ko">' + esc(kick(g.kickoff_phoenix)) + '</div>';
    h += '<div class="cap">Suggested market</div><div class="sug">' + esc(s.text) + (s.price != null ? ' <span class="muted">(' + esc(price(s.price)) + ')</span>' : '') + '</div>';
    if (s.card) h += '<div class="off">' + esc(s.card.market) + ' · ' + esc(s.card.place_label) + '</div>';
    if (n) h += '<div class="off">Best captured offer: <span class="num">' + esc(lineText(g.tag_market || 'spread', (g[g.tag_market || 'spread'] || {}).lean_side, n.line)) + ' (' + esc(price(n.price)) + ')</span> · ' + esc(n.book) + '</div>';
    else h += '<div class="off">Quote unavailable</div>';
    h += '<div class="off">Odds captured ' + esc(tsShort((w.odds_pull || {}).fetched_at)) + (os.cls !== 'ok' ? ' · ' + pill('stale', 'STALE — recheck before betting') : '') + '</div>';
    h += '<div class="ev">' + (f.length ? '<span>' + esc(f[0].name) + '</span>' + pill(f[0].tier) + (f.length > 1 ? '<span class="muted">+' + (f.length - 1) + ' more</span>' : '') : '<span class="muted">Evidence unavailable</span>') + '</div>';
    h += '<a class="cta rev-link" href="' + href + '">Review evidence ›</a></div>';
    return h;
  }
  function phoneFeed(w) {
    const ln = lanes(w) || {}, cov = coverage(w);
    const games = (w.games || []).slice().sort(byRank);
    const shown = games.filter((g) => state.filter === 'all' || g.tag === state.filter);
    let h = '<div class="feed" id="feed">';
    h += '<div class="chips"><div class="chipc bet" id="chip-bet"><div class="v">' + esc(ln['BET'] != null ? ln['BET'] : '—') + '</div><div class="k">BET</div></div>' +
      '<div class="chipc possible" id="chip-possible"><div class="v">' + esc(ln['POSSIBLE BET'] != null ? ln['POSSIBLE BET'] : '—') + '</div><div class="k">POSSIBLE</div></div>' +
      '<div class="chipc cov" id="chip-cov"><div class="v">' + esc(cov.value) + '</div><div class="k">GAMES SCANNED</div></div></div>';
    h += '<div class="pills" id="pills">' + ['all'].concat(LANES).map((o) => '<button type="button" data-f="' + esc(o) + '" class="' + (state.filter === o ? 'on' : '') + '">' + esc(o === 'all' ? 'All' : o === 'POSSIBLE BET' ? 'POSSIBLE' : o) + '</button>').join('') + '</div>';
    h += '<div class="small muted" style="margin:-4px 0 10px">Sorted by scanner tag rank · ' + games.length + ' games</div>';
    if (!games.length) h += '<div class="empty"><b>No games in this scan.</b></div>';
    else if ((ln['BET'] || 0) === 0 && state.filter === 'all') h += '<div class="banner info" id="nobet-week-phone"><b>No BET suggestions this week.</b> A valid result of the scan.</div>';
    if (games.length && !shown.length) h += '<div class="empty">No game carries that tag this week.</div>';
    shown.forEach((g) => { h += feedCard(w, g); });
    return h + '</div>';
  }
  function bindFeed(w) {
    const pills = document.getElementById('pills');
    if (pills) pills.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.filter = b.getAttribute('data-f'); rerender(); }));
  }
  function oppsPanel(w) {
    const games = (w.games || []).slice().sort(state.sort === 'kick' ? byKick : byRank);
    const ln = lanes(w) || {};
    const shown = games.filter((g) => state.filter === 'all' ? g.tag !== 'NO BET' || state.nobetOpen : g.tag === state.filter);
    const nobet = games.filter((g) => g.tag === 'NO BET');
    const seg = ['all'].concat(LANES).map((o) => '<button type="button" data-f="' + esc(o) + '" class="' + (state.filter === o ? 'on' : '') + '">' + esc(o === 'all' ? 'All' : o === 'POSSIBLE BET' ? 'POSSIBLE' : o) + '</button>').join('');
    let h = '<div class="panel opps" id="opps"><div class="ph"><h2>' + ICON.target + 'Ranked Opportunities</h2><div class="ctl"><span class="seg" id="seg">' + seg + '</span><span class="sub">' + games.length + ' games</span></div></div><div class="pb">';
    if (!games.length) { h += '<div class="empty"><b>No games in this scan.</b></div></div></div>'; return h; }
    if ((ln['BET'] || 0) === 0 && state.filter === 'all') h += '<div class="banner info" id="nobet-week"><b>No BET suggestions this week.</b> A valid result of the scan: POSSIBLE BET and NO BET games are listed below.</div>';
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Matchup</th><th>Scanner status</th><th>Suggested market</th><th>Angle evidence</th><th>Best captured offer</th><th></th></tr></thead><tbody>';
    if (!shown.length) h += '<tr><td colspan="6"><div class="empty">No game carries that tag this week.</div></td></tr>';
    shown.forEach((g) => { h += oppRow(w, g); });
    h += '</tbody></table></div>';
    if (state.filter === 'all' && nobet.length) h += '<div class="nobet-sum"><span>' + (state.nobetOpen ? nobet.length + ' NO BET games shown above' : nobet.length + ' NO BET games — no qualified play') + '</span><button type="button" class="btn" id="nobet-toggle">' + (state.nobetOpen ? 'Hide NO BET games' : 'Show ' + nobet.length + ' NO BET games') + '</button></div>';
    h += '<div class="dsort" style="margin-top:8px">Order: ' + (state.sort === 'kick' ? 'display sort by kickoff (does not change a tag)' : "the scanner's tag rank") + ' · <a href="#" id="sort-toggle">' + (state.sort === 'kick' ? 'back to scanner order' : 'sort by kickoff') + '</a></div>';
    return h + '</div></div>';
  }
  function oppRow(w, g) {
    const s = suggestion(w, g);
    return '<tr class="row" id="g-' + esc(g.game_id) + '" data-game="' + esc(g.game_id) + '"><td><div class="mu">' + esc(g.away) + ' @ ' + esc(g.home) + '</div><div class="ko">' + esc(kick(g.kickoff_phoenix)) + '</div></td>' +
      '<td>' + tagHtml(g.tag) + (g.tag_rank != null ? '<div class="q num">#' + esc(g.tag_rank) + '</div>' : '') + '</td>' +
      '<td><div class="sug">' + esc(s.text) + (s.price != null ? ' <span class="muted">(' + esc(price(s.price)) + ')</span>' : '') + '</div><div class="q">' + esc(s.q) + '</div></td>' +
      '<td class="ang">' + angleCell(g) + '</td><td>' + offerHtml(w, g) + '</td>' +
      '<td><a class="rev" href="#/week/' + esc(w.id) + '/' + esc(g.game_id) + '" aria-label="Review ' + esc(g.matchup) + '">' + ICON.chev + '</a></td></tr>';
  }
  function integrityPanel(w) {
    const ss = scanState(w), os = oddsState(w), vs = verifyState(w), cov = coverage(w);
    const led = state.clv ? { cls: 'ok', word: 'Connected', d: state.clv.all.bets + ' real bets · exported ' + tsShort(state.clv.generated_at) } : { cls: 'neutral', word: 'Not connected', d: 'No system-sourced bets logged' };
    const sh = state.shadow ? { cls: 'ok', word: 'Available', d: state.shadow.counts.rows + ' rows · ' + state.shadow.counts.settled + ' settled · graded ' + tsShort(state.shadow.generated_at) } : { cls: 'neutral', word: 'Not available', d: 'no shadow summary' };
    const wx = w.weather ? { cls: w.weather.status === 'ok' ? 'ok' : 'warn', word: w.weather.status === 'ok' ? 'Current' : w.weather.status, d: (w.weather.detail || '') + ' · ' + tsShort(w.weather.fetched_at) } : { cls: 'neutral', word: 'Not checked', d: 'no forecast in this scan' };
    return '<div class="panel" id="integrity"><div class="ph"><h2>' + ICON.db + 'Data Integrity</h2></div><div class="pb">' +
      '<div class="tile"><div class="k">Scanner run</div><div class="v num">' + esc(tsFull(w.generated_at)) + '</div><div class="d">' + esc(ss.word === 'Current' ? 'Completed · ' + (w.counts || {}).games + ' games tagged' : ss.detail) + '</div><div class="d">Verification not connected (the 4-check gate is read by a human)</div></div>' +
      '<div class="rows">' +
      '<div class="row2"><span class="k">Weekly scanner</span>' + chip(ss.cls, ss.word) + '<span class="d">' + esc(ss.detail) + '</span></div>' +
      '<div class="row2"><span class="k">Odds capture</span>' + chip(os.cls, os.word) + '<span class="d">' + esc(tsFull((w.odds_pull || {}).fetched_at)) + (os.detail ? ' · ' + esc(os.detail) : '') + '</span></div>' +
      '<div class="row2"><span class="k">Week verification</span>' + chip(vs.cls, vs.word) + '<span class="d">' + esc(vs.detail) + '</span></div>' +
      '<div class="row2"><span class="k">Game coverage</span>' + chip(cov.value === '—' ? 'neutral' : 'ok', cov.value === '—' ? 'Unknown' : cov.value) + '<span class="d">' + esc(cov.sub) + '</span></div>' +
      '<div class="row2"><span class="k">Weather fetch</span>' + chip(wx.cls, wx.word) + '<span class="d">' + esc(wx.d) + '</span></div>' +
      '<div class="row2"><span class="k">Real-bet ledger</span>' + chip(led.cls, led.word) + '<span class="d">' + esc(led.d) + '</span></div>' +
      '<div class="row2"><span class="k">Shadow ledger</span>' + chip(sh.cls, sh.word) + '<span class="d">' + esc(sh.d) + ' · zero stake, separate</span></div>' +
      '</div></div><div class="pfoot">Scheduled odds pulls: Tue / Thu / Sun mornings · Phoenix time. Next pull time is not exposed by the scheduler.</div></div>';
  }
  // S3: Angle Evidence (H4.8). Registry counts from angles.json; "fired this week" aggregated from games[].angles_fired.
  function angleEvidencePanel(w) {
    const lib = state.angles || {}, c = lib.counts || {};
    const fired = {};
    (w.games || []).forEach((g) => (g.angles_fired || []).forEach((a) => { fired[a.name] = fired[a.name] || { tier: a.tier, n: 0 }; fired[a.name].n += 1; }));
    const names = Object.keys(fired).sort((a, b) => fired[b].n - fired[a].n || a.localeCompare(b));
    const nGames = (w.games || []).length || 1;
    let h = '<div class="panel" id="angle-evidence"><div class="ph"><h2>' + ICON.target + 'Angle Evidence</h2><a class="btn" href="#/angles">Full registry</a></div><div class="pb">';
    h += '<div class="cnts"><div class="cnt"><div class="v">' + esc(c.survivor != null ? c.survivor : '—') + '</div><div class="k">SURVIVOR</div></div><div class="cnt"><div class="v">' + esc(c.watch != null ? c.watch : '—') + '</div><div class="k">WATCH</div></div><div class="cnt"><div class="v">' + esc(c.dead != null ? c.dead : '—') + '</div><div class="k">DEAD</div></div></div>';
    h += '<div class="tiny" style="margin:6px 0">Fired this week in the scan · games out of ' + esc(nGames) + '</div>';
    if (!names.length) h += '<div class="empty">No angle fired on any game this week.</div>';
    names.forEach((n) => {
      const f = fired[n], ticks = Array.from({ length: Math.min(nGames, 16) }, (_, i) => '<i class="' + (i < f.n ? 'on' : '') + '"></i>').join('');
      h += '<div class="arow"><span class="nm">' + esc(n) + '</span>' + pill(f.tier) + '<span class="ticks" aria-hidden="true">' + ticks + '</span><span class="ct">' + esc(f.n) + '</span></div>';
    });
    const nw = w.not_wired || [];
    if (nw.length) h += '<div class="note small muted" style="margin-top:8px">Not wired this week: ' + esc(nw.map((x) => x.name).join(', ')) + ' (forecast wind is shown for reading only).</div>';
    h += '<div class="note small muted" style="margin-top:6px">Registry: ' + esc((lib.harness_log || {}).distinct_expressions != null ? lib.harness_log.distinct_expressions + ' expressions tested over ' + lib.harness_log.runs + ' runs' : 'harness log unavailable') + '. More expressions tested does not strengthen any one of them.</div>';
    return h + '</div></div>';
  }
  // S3: Market Movement (H4.9). The data holds two dated points per market (open, latest): a dated snapshot table, never a curve.
  function stamp(s) {
    const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})/.exec(String(s || ''));
    return m ? m[1] + ' ' + m[2] + ':' + m[3] + ' MST' : (s ? String(s) : 'Timestamp unavailable');
  }
  function movementTable(g) {
    const mv = g.movement || {};
    let h = '';
    ['spread', 'total'].forEach((mk) => {
      const f = mv[mk];
      if (!f || f.open == null || f.latest == null) { h += '<div class="small muted" style="margin:6px 0">' + esc(mk) + ': no snapshot history</div>'; return; }
      const fmt = (x) => mk === 'spread' ? signed(x) : String(x);
      h += '<div class="tiny" style="margin:8px 0 4px">' + esc(mk) + ' · ' + esc(mk === 'spread' ? f.side : 'the ' + f.side) + ' · ' + esc(f.snapshots) + ' snapshots</div>';
      h += '<table class="snap"><thead><tr><th>Captured</th><th>Line</th><th>Price</th><th>Books</th></tr></thead><tbody>' +
        '<tr><td>' + esc(stamp(f.open_at)) + ' <span class="muted">open</span></td><td>' + esc(fmt(f.open)) + '</td><td>' + esc(price(f.open_price)) + '</td><td>' + esc(f.open_books) + '</td></tr>' +
        '<tr><td>' + esc(stamp(f.latest_at)) + ' <span class="muted">latest</span></td><td>' + esc(fmt(f.latest)) + '</td><td>' + esc(price(f.latest_price)) + '</td><td>' + esc(f.latest_books) + '</td></tr></tbody></table>';
      h += '<div class="small sec" style="margin-top:4px">Move ' + esc(signed(f.move)) + (f.direction ? ' · ' + esc(f.direction) : '') + (f.key_crossed && f.key_crossed.length ? ' · key numbers crossed: ' + esc(f.key_crossed.join(', ')) : ' · no key number crossed') + '</div>';
    });
    return h;
  }
  function movementPanel(w) {
    const games = (w.games || []).slice().sort(byRank);
    if (!games.length) return '<div class="panel" id="movement"><div class="ph"><h2>' + ICON.chart + 'Market Movement</h2></div><div class="pb"><div class="empty">No games in this scan.</div></div></div>';
    const sel = gameById(w, state.moveGame) || games[0];
    state.moveGame = sel.game_id;
    return '<div class="panel" id="movement"><div class="ph"><h2>' + ICON.chart + 'Market Movement</h2><span class="sub">Captured snapshots — not a continuous feed</span></div><div class="pb">' +
      '<div class="ctl" style="margin-bottom:8px"><select id="move-sel" aria-label="Game" class="btn">' + games.map((g) => '<option value="' + esc(g.game_id) + '"' + (g.game_id === sel.game_id ? ' selected' : '') + '>' + esc(g.away + ' @ ' + g.home) + ' · ' + esc(g.tag || '') + '</option>').join('') + '</select>' +
      '<span class="small muted">consensus of the books in the pull (' + esc((w.books || []).join(', ')) + ')</span></div><div id="move-body">' + movementTable(sel) + '</div></div></div>';
  }
  // S3: CLV Performance (H4.10). Actual bets only; at n = 0 the designed empty state, never a chart of nothing.
  function clvPanel() {
    const c = state.clv;
    let h = '<div class="panel" id="clv-perf"><div class="ph"><h2>' + ICON.chart + 'CLV Performance</h2><span class="sub">Actual bets only</span></div><div class="pb">';
    if (!c || !c.all) return h + '<div class="empty" id="clv-empty"><div class="big">—</div><b>No system-sourced bets logged yet</b>CLV available after real bets are recorded and closing lines exist.<div class="axis" aria-hidden="true"></div></div></div></div>';
    const a = c.all;
    h += '<div class="cnts"><div class="cnt"><div class="v">' + esc(signed(a.mean_clv_prob, 4)) + '</div><div class="k">MEAN CLV (PROBABILITY)</div></div><div class="cnt"><div class="v">' + esc(a.graded) + '</div><div class="k">N GRADED</div></div><div class="cnt"><div class="v">' + esc(pct(a.beat_close_pct)) + '</div><div class="k">BEAT THE CLOSE</div></div></div>';
    h += '<div class="rows">' + Object.keys(c.by_bettor || {}).map((b) => { const x = c.by_bettor[b]; return '<div class="row2"><span class="k">' + esc(b) + '</span><span class="num">' + esc(signed(x.mean_clv_prob, 4)) + '</span><span class="d">' + esc(x.bets) + ' bets · ' + esc(x.graded) + ' graded · ' + esc(x.record) + '</span></div>'; }).join('') + '</div>';
    h += '<div class="note small muted" style="margin-top:8px">' + esc(c.source) + ' · season ' + esc(c.season) + ' · exported ' + esc(tsFull(c.generated_at)) + '</div>';
    return h + '</div></div>';
  }
  // S3: the full Weekly Game Matrix (H4.11): every game, NO BET included, grouped by actual kickoff slot.
  function slot(iso) {
    const p = parts(iso);
    if (!p) return 'Kickoff unavailable';
    const hour = Number(p.time.slice(0, 2));
    if (p.day === 'Sun') return hour < 12 ? 'Sunday Early' : hour < 16 ? 'Sunday Late' : 'Sunday Night';
    return { Thu: 'Thursday', Mon: 'Monday', Sat: 'Saturday', Fri: 'Friday', Tue: 'Tuesday', Wed: 'Wednesday' }[p.day] || p.day;
  }
  function matrixPanel(w) {
    const games = (w.games || []).slice().sort(byKick);
    let h = '<div class="panel" id="matrix"><div class="ph"><h2>' + ICON.clock + 'Complete Weekly Game Matrix</h2><span class="sub">' + games.length + ' games by kickoff · NO BET included · ' + esc(tsShort(w.generated_at)) + ' scan</span></div><div class="pb">';
    if (!games.length) return h + '<div class="empty"><b>No games in this scan.</b></div></div></div>';
    h += '<div class="tbl-wrap"><table class="tbl mxt"><thead><tr><th>Kickoff</th><th>Road at home</th><th>Scanner tag</th><th>Suggested market</th><th class="num">Angles fired</th><th>Line status</th><th></th></tr></thead><tbody>';
    let cur = null;
    games.forEach((g) => {
      const sl = slot(g.kickoff_phoenix);
      if (sl !== cur) { cur = sl; h += '<tr><td colspan="7" class="dayhead">' + esc(sl) + '</td></tr>'; }
      const s = suggestion(w, g), n = shop(g), os = oddsState(w);
      const ls = !n ? 'Price unavailable' : (os.cls === 'ok' ? 'Captured ' + tsShort((w.odds_pull || {}).fetched_at) : os.word + ' · captured ' + tsShort((w.odds_pull || {}).fetched_at));
      h += '<tr id="mx-' + esc(g.game_id) + '"><td class="num">' + esc(kick(g.kickoff_phoenix)) + '</td><td><b>' + esc(g.away) + ' @ ' + esc(g.home) + '</b></td><td>' + tagHtml(g.tag) + '</td>' +
        '<td class="num">' + esc(s.text) + (s.price != null ? ' (' + esc(price(s.price)) + ')' : '') + '</td><td class="num">' + esc((g.angles_fired || []).length) + '</td><td class="small">' + esc(ls) + '</td>' +
        '<td><a class="rev" href="#/week/' + esc(w.id) + '/' + esc(g.game_id) + '" aria-label="Review ' + esc(g.matchup) + '">' + ICON.chev + '</a></td></tr>';
    });
    return h + '</tbody></table></div></div></div>';
  }
  function bindWeek(w) {
    const ms = document.getElementById('move-sel');
    if (ms) ms.addEventListener('change', () => { state.moveGame = ms.value; const g = gameById(w, ms.value); const body = document.getElementById('move-body'); if (g && body) body.innerHTML = movementTable(g); });
    const seg = document.getElementById('seg');
    if (seg) seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.filter = b.getAttribute('data-f'); rerender(); }));
    const nb = document.getElementById('nobet-toggle');
    if (nb) nb.addEventListener('click', () => { state.nobetOpen = !state.nobetOpen; rerender(); });
    const st = document.getElementById('sort-toggle');
    if (st) st.addEventListener('click', (ev) => { ev.preventDefault(); state.sort = state.sort === 'kick' ? 'rank' : 'kick'; rerender(); });
    document.querySelectorAll('.opps tr.row').forEach((tr) => tr.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      location.hash = '#/week/' + w.id + '/' + tr.getAttribute('data-game');
    }));
  }

  // ------------------------------------------------------------ view: Weekly Slate (#/slate)
  function viewSlate(id, gameId) {
    setNav('slate');
    const target = id || latestId();
    if (!target) { renderChrome(null); $main.innerHTML = banners(null); announce('slate', null); return; }
    loadWeek(target).then((w) => {
      renderChrome(w);
      let html = headRow(w, 'Week ' + w.week + ' — Weekly Slate', '<span class="dsort">Every game by kickoff · ' + (w.games || []).length + ' games</span>');
      html += banners(w);
      const games = (w.games || []).slice().sort(byKick);
      let day = null;
      html += '<div class="panel" id="slate"><div class="ph"><h2>' + ICON.clock + 'All games</h2><span class="sub">grouped by kickoff day (America/Phoenix)</span></div><div class="pb">';
      if (!games.length) html += '<div class="empty"><b>No games in this scan.</b></div>';
      games.forEach((g) => {
        const d = kickDay(g.kickoff_phoenix);
        if (d !== day) { day = d; html += '<div class="dayhead">' + esc(d) + '</div>'; }
        const s = suggestion(w, g);
        html += '<div class="card" id="g-' + esc(g.game_id) + '"><div class="game-line"><h3>' + esc(g.away) + ' @ ' + esc(g.home) + '</h3><span class="small num sec">' + esc(kick(g.kickoff_phoenix)) + '</span>' + tagHtml(g.tag) +
          '<span class="small"><span class="num">' + esc(s.text) + (s.price != null ? ' (' + esc(price(s.price)) + ')' : '') + '</span></span>' +
          '<span class="small muted">' + esc((g.angles_fired || []).length) + ' angle' + ((g.angles_fired || []).length === 1 ? '' : 's') + ' fired</span>' +
          '<a class="btn rev-link" href="#/slate/' + esc(w.id) + '/' + esc(g.game_id) + '">Review</a></div></div>';
      });
      html += '</div></div>';
      $main.innerHTML = html;
      state.rendered = { view: 'slate', id: w.id };
      window.scrollTo(0, 0);
      announce('slate', w);
      if (gameId) openEvidence(w, gameId);
    }).catch(fail);
  }

  // ------------------------------------------------------------ S4: the evidence view. ONE content function (H4.6 drawer order,
  // H5.7 page order), two presentations: a right-side drawer over the canvas on desktop, a full-height page with Back on
  // the phone. Opening and closing never re-render the canvas, so the scroll position and the filter survive.
  const $drawer = document.getElementById('drawer');
  const $backdrop = document.getElementById('backdrop');
  function angleRows(list, against) {
    if (!list || !list.length) return '';
    return list.map((a) => {
      const win = a.windows || {};
      const wtv = score(a.points);   // the configured strength-score contribution (a count of agreeing evidence, no unit)
      const wv = Object.keys(win).map((k) => k + ' ' + pct(win[k].pct) + ' (n ' + win[k].n + ')').join(' · ');
      return '<div class="ang"><span class="nm">' + esc(a.name) + '</span> ' + pill(against ? 'against' : a.tier, against ? 'against' : a.tier) + ' <span class="small sec">' + esc(a.direction_label || '') + '</span>' +
        '<div class="win">' + esc(wv || 'windows unavailable') + ' · n ' + esc(a.n) + (a.tier === 'survivor' ? ' · weight ' + esc(wtv) : ' · no weight') + '</div>' +
        (a.mechanism ? '<div class="mech">' + esc(a.mechanism) + '</div>' : '') + '</div>';
    }).join('');
  }
  function evidenceHtml(w, g) {
    const s = suggestion(w, g), c = s.card, n = shop(g), os = oddsState(w);
    const mk = g.tag_market || 'spread', m = g[mk] || {};
    const sl = (w.shortlist || []).find((x) => x.game_id === g.game_id) || null;
    const wx = g.weather || null;
    let h = '<div class="ev" id="evidence" data-game="' + esc(g.game_id) + '">';
    h += '<div class="evh"><div><div class="tiny">' + tagHtml(g.tag) + ' <span class="num sec">#' + esc(g.tag_rank != null ? g.tag_rank : '—') + '</span></div><h2>' + esc(g.away) + ' @ ' + esc(g.home) + '</h2>' +
      '<div class="ko">' + esc(kick(g.kickoff_phoenix)) + '</div><div class="note">Scan ' + esc(tsFull(w.generated_at)) + '</div></div>' +
      '<button type="button" class="close" id="ev-close" aria-label="Close the evidence view"><span class="only-desk">Close</span><span class="only-phone">‹ Back</span></button></div>';
    // 1. the recommendation
    h += '<section><h3>Suggested market</h3>';
    if (c) {
      h += '<div class="rec">' + esc(c.bet) + ' <small>(' + esc(price(c.price)) + ') · ' + esc(c.book) + '</small></div>' +
        '<div class="small sec" style="margin-top:4px">' + esc(c.market) + ' · ' + esc(c.place_label) + ' · captured ' + esc(tsFull((w.odds_pull || {}).fetched_at)) + (os.cls !== 'ok' ? ' · ' + pill('stale', 'STALE — recheck before betting') : '') + '</div>';
      if (c.worst_line != null) h += '<div class="small sec">Only at ' + esc(lineText(c.market, c.side, c.worst_line)) + ' or better (the card\'s own limit).</div>';
    } else {
      h += '<div class="rec">' + esc(s.text) + '</div><div class="small sec">' + esc(s.q) + '</div>';
    }
    h += '</section>';
    // 2. why it appears, in the scan's own words
    h += '<section><h3>Why it appears</h3><div class="small sec">' + esc(g.tag_reason || 'No reason recorded') + '</div>';
    if (c && c.lines) h += '<ul class="lines">' + c.lines.map((ln) => '<li class="' + (ln.label === 'PLACE THIS BET' ? 'place' : ln.label === 'WATCH' ? 'watch' : '') + '"><b>' + esc(ln.label) + '</b>' + esc(ln.text) + '</li>').join('') + '</ul>';
    if (sl && sl.interpretation && sl.interpretation.what_this_means) h += '<ul class="lines">' + sl.interpretation.what_this_means.map((x) => '<li><b>' + esc(x.label) + '</b>' + esc(x.text) + '</li>').join('') + '</ul>';
    h += '</section>';
    // 3. evidence: the angles that fired, then every angle checked
    const fired = g.angles_fired || [];
    h += '<section><h3>Evidence · ' + esc(fired.length) + ' angle' + (fired.length === 1 ? '' : 's') + ' fired</h3>';
    h += fired.length ? angleRows(fired, false) + angleRows(m.angles_against, true) : '<div class="small sec">No angle fired on this game. Evidence not available.</div>';
    h += '<div class="note" style="margin-top:6px">Percentages are ATS cover rates in the named five-season windows (overlapping). Historical result ≠ calibrated chance of this bet winning.</div>';
    if (g.matrix && g.matrix.angles && g.matrix.angles.length) {
      const mx = g.matrix, wins = mx.windows || [];
      h += '<details class="disc mx"><summary>Every angle checked (' + mx.angles.length + ')</summary><div class="tbl-wrap"><table class="tbl stack"><thead><tr><th>Angle</th><th>Result</th><th>Values this game</th>' + wins.map((x) => '<th class="num">' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' +
        mx.angles.map((a) => '<tr><td data-k="Angle"><b>' + esc(a.name) + '</b> ' + pill(a.tier) + '<div class="q small sec">' + esc(a.direction_text || '') + '</div></td><td data-k="Result"><span class="res ' + ({ 'FIRED': 'fired', 'NOT FIRED': 'notfired', 'NOT WIRED': 'notwired', 'OUT OF SEASON': 'season' }[a.result] || 'notfired') + '">' + esc(a.result) + '</span>' + (a.note ? '<div class="q small muted">' + esc(a.note) + '</div>' : '') + '</td>' +
          '<td data-k="Values" class="mono">' + (a.values || []).map(esc).join('<br>') + '</td>' + wins.map((x) => { const v = (a.windows || {})[x]; return '<td data-k="' + esc(x) + '" class="num">' + (v ? pct(v.pct) + ' <span class="muted">(n ' + esc(v.n) + ')</span>' : '—') + '</td>'; }).join('') + '</tr>').join('') +
        '</tbody></table></div>' + (mx.lean_math ? '<div class="small sec" style="margin-top:8px">' + ['spread', 'total'].map((k) => mx.lean_math[k] ? '<div><b>' + k + '</b>: ' + esc(mx.lean_math[k].net) + ' · ' + esc(mx.lean_math[k].verdict) + '</div>' : '').join('') + '</div>' : '') + '</details>';
    }
    h += '</section>';
    // 4. prices captured: the best number in the pull; per-book quotes are not in the data
    h += '<section><h3>Prices captured</h3>';
    if (n) h += '<div class="small"><span class="num">' + esc(lineText(mk, m.lean_side, n.line)) + ' (' + esc(price(n.price)) + ')</span> at ' + esc(n.book) + ' · best of ' + esc(n.books_quoting) + ' books quoting · consensus <span class="num">' + esc(n.consensus) + '</span> · reachable by ' + esc((n.reachable_by || []).join(', ') || 'nobody') + ' · captured ' + esc(tsFull((w.odds_pull || {}).fetched_at)) + '</div>';
    else h += '<div class="small sec">Quote unavailable for this game in the ' + esc(tsShort((w.odds_pull || {}).fetched_at)) + ' pull.</div>';
    h += '<div class="note" style="margin-top:4px">Odds comparison not available (the pull carries one best number per market, not the quote of every book).</div></section>';
    // 5. market snapshots
    h += '<section><h3>Market snapshots</h3>' + movementTable(g) + '</section>';
    // 6. data checks
    h += '<section><h3>Data checks</h3><div class="kv">';
    if (wx && wx.status === 'forecast') h += '<div class="k">Weather</div><div class="v">wind <span class="num">' + esc(wx.wind_mph) + ' mph</span>' + (wx.gust_mph != null ? ', gusts <span class="num">' + esc(wx.gust_mph) + '</span>' : '') + (wx.temp_f != null ? ', <span class="num">' + esc(wx.temp_f) + '°F</span>' : '') + ' · ' + esc(wx.venue || '') + (wx.roof ? ' (' + esc(wx.roof) + ')' : '') + ' · forecast fetched ' + esc(tsFull(wx.fetched_at)) + ' · information only</div>';
    else if (wx && wx.status === 'dome') h += '<div class="k">Weather</div><div class="v">Indoor venue' + (wx.venue ? ' · ' + esc(wx.venue) : '') + ' · ' + esc(wx.detail || '') + '</div>';
    else if (wx) h += '<div class="k">Weather</div><div class="v">' + esc(wx.badge || 'unknown') + (wx.detail ? ' · ' + esc(wx.detail) : '') + '</div>';
    else h += '<div class="k">Weather</div><div class="v">Not checked</div>';
    h += '<div class="k">Injuries</div><div class="v">Not checked</div>';
    h += '<div class="k">Odds capture</div><div class="v">' + esc(tsFull((w.odds_pull || {}).fetched_at)) + ' · ' + esc(os.word) + (os.detail ? ' · ' + esc(os.detail) : '') + '</div>';
    h += '<div class="k">Week</div><div class="v">' + esc(verifyState(w).word) + '</div></div></section>';
    // 7. shadow lean, zero stake
    const sh = g.shadow_lean && (g.shadow_lean.spread || g.shadow_lean.total);
    if (sh) h += '<section><h3>Shadow research — zero stake</h3>' + ['spread', 'total'].map((k) => { const x = g.shadow_lean[k]; return x ? '<div class="small sec">' + esc(k) + ': ' + esc(x.line != null ? lineText(k, x.side, x.line) : x.side + ' (no line posted)') + ' (' + esc(price(x.price)) + ') · tier ' + esc(x.tier) + (x.forced_default ? ' · default side, no signal' : '') + ' · tracking only, never a bet</div>' : ''; }).join('') + '</section>';
    // 8. decision & logging: the Log control is bets.js's (S8), only when the entry path works; nothing else here
    h += '<section id="ev-log"><h3>Decision &amp; logging</h3><div class="small sec" id="ev-log-state">' + esc(window.NFL_EDGE_FIREBASE && window.NFL_EDGE_FIREBASE.enabled ? 'Sign in to log a manually placed bet.' : 'Bet logging not connected. Every bet is placed by a human at the sportsbook.') + '</div></section>';
    // 9. source record
    h += '<section><h3>Source record</h3><div class="small sec">Scan ' + esc(w.id) + ' · ' + esc(tsFull(w.generated_at)) + ' · ' + esc((w.source || {}).file || 'scan file unknown') + ' · odds ' + esc(tsFull((w.odds_pull || {}).fetched_at)) + '</div><div class="note">Source link unavailable (the scan report is not served beside the site data).</div></section>';
    return h + '</div>';
  }
  function openEvidence(w, gameId) {
    const g = gameById(w, gameId);
    if (!g) { closeEvidence(false); return; }
    if (!state.evidence) state.scrollBefore = window.scrollY;
    state.evidence = gameId;
    $drawer.innerHTML = evidenceHtml(w, g);
    $drawer.hidden = false; $backdrop.hidden = false;
    document.body.classList.add('ev-open');
    requestAnimationFrame(() => { $drawer.classList.add('show'); $backdrop.classList.add('show'); });
    $drawer.scrollTop = 0;
    document.getElementById('ev-close').addEventListener('click', () => closeEvidence(true));
    try { window.dispatchEvent(new CustomEvent('nfl-edge:evidence', { detail: { week: w.id, game: gameId } })); } catch (e) {}
  }
  function closeEvidence(navigate) {
    if (!state.evidence) return;
    state.evidence = null;
    $drawer.classList.remove('show'); $backdrop.classList.remove('show');
    document.body.classList.remove('ev-open');
    const y = state.scrollBefore;
    setTimeout(() => { $drawer.hidden = true; $backdrop.hidden = true; $drawer.innerHTML = ''; }, 160);
    if (navigate && state.rendered) location.hash = '#/' + state.rendered.view + '/' + state.rendered.id;
    window.scrollTo(0, y);
  }
  $backdrop.addEventListener('click', () => closeEvidence(true));
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && state.evidence) closeEvidence(true); });

  // ------------------------------------------------------------ view: Angle Library (#/angles)
  function viewAngles() {
    setNav('angles');
    const lib = state.angles || {};
    const latest = latestId();
    const go = (w) => {
      renderChrome(w);
      const c = lib.counts || {};
      let html = '<div class="head"><div><h1>Angle Library</h1><div class="subl">Registry from ' + esc(lib.source || 'config/angles.yaml') + ' · generated ' + esc(lib.generated || '—') + ' · sample ' + esc(lib.sample || '—') + '</div></div></div>';
      html += '<div class="kpis">' +
        '<div class="kpi"><div class="k">Survivor</div><div class="v">' + esc(c.survivor != null ? c.survivor : '—') + '</div><div class="s">both recent windows at or above ' + esc((lib.alive_rule || {}).min_recent_window_pct) + '%, n ≥ ' + esc((lib.alive_rule || {}).min_recent_n) + '</div></div>' +
        '<div class="kpi"><div class="k">Watch</div><div class="v">' + esc(c.watch != null ? c.watch : '—') + '</div><div class="s">thin samples · no weight</div></div>' +
        '<div class="kpi"><div class="k">Dead</div><div class="v">' + esc(c.dead != null ? c.dead : '—') + '</div><div class="s">tested and retired · never hidden</div></div>' +
        '<div class="kpi"><div class="k">Expressions tested</div><div class="v">' + esc((lib.harness_log || {}).distinct_expressions != null ? lib.harness_log.distinct_expressions : '—') + '</div><div class="s">' + esc((lib.harness_log || {}).runs != null ? lib.harness_log.runs + ' harness runs · the multiple-comparison guard' : 'harness log unavailable') + '</div></div></div>';
      html += '<div class="panel" id="registry"><div class="ph"><h2>' + ICON.target + 'Registry</h2><span class="sub">' + (lib.angles || []).length + ' angles</span></div><div class="pb"><div class="tbl-wrap"><table class="tbl stack"><thead><tr><th>Angle</th><th>Status</th><th>Direction · market</th><th class="num">Weight</th><th class="num">n</th><th>2020-2024</th><th>2021-2025</th><th>Mechanism</th></tr></thead><tbody>';
      (lib.angles || []).forEach((a) => {
        const bt = a.backtest || {}, win = bt.windows || {};
        const wv = (k) => win[k] ? pct(win[k].pct) + ' <span class="muted">(n ' + esc(win[k].n) + ')</span>' : '—';
        html += '<tr class="' + esc(a.status) + '"><td data-k="Angle"><b>' + esc(a.name) + '</b><div class="q"><code>' + esc(a.expression) + '</code></div></td><td data-k="Status">' + pill(a.status) + (a.not_wired_reason ? ' ' + pill('against', 'not wired') : '') + '</td>' +
          '<td data-k="Direction">' + esc(a.direction ? a.direction + ' · ' + a.market : '—') + '</td><td data-k="Weight" class="num">' + esc(a.status === 'dead' ? '—' : score(a.weight_points)) + '</td><td data-k="n" class="num">' + esc(bt.n_full != null ? bt.n_full : '—') + '</td>' +
          '<td data-k="2020-2024" class="num">' + wv('2020-2024') + '</td><td data-k="2021-2025" class="num">' + wv('2021-2025') + '</td><td data-k="Mechanism" class="small sec">' + esc(a.description || '') + (a.not_wired_reason ? '<div class="q">Not wired: ' + esc(a.not_wired_reason) + '</div>' : '') + '</td></tr>';
      });
      html += '</tbody></table></div><p class="small muted">Percentages are ATS cover rates in the named five-season window (the two windows overlap). Historical result ≠ calibrated chance of this bet winning. Weights change only through the 1999-2025 backtest.</p></div></div>';
      if (lib.method && lib.method.strength_score) html += '<div class="panel"><div class="ph"><h2>' + ICON.chart + 'How the strength score is built</h2></div><div class="pb"><p class="sec">' + esc(lib.method.strength_score) + '</p>' +
        (lib.method.movement_rule ? '<p class="small muted"><b>Movement rule (' + esc(lib.method.movement_rule.name) + ', ' + esc(lib.method.movement_rule.status) + ', ' + esc(lib.method.movement_rule.dated) + ').</b> ' + esc(lib.method.movement_rule.statement) + '</p>' : '') + '</div></div>';
      $main.innerHTML = html;
      window.scrollTo(0, 0);
      announce('angles', w);
    };
    (latest ? loadWeek(latest) : Promise.resolve(null)).then(go).catch(() => go(null));
  }

  // ------------------------------------------------------------ view: Bet Ledger (#/ledger)
  function viewLedger() {
    setNav('ledger');
    const latest = latestId();
    const go = (w) => {
      renderChrome(w);
      const c = state.clv;
      let html = '<div class="head"><div><h1>Bet Ledger</h1><div class="subl">Real bets · closing line value · ' + (c ? 'season ' + esc(c.season) + ' · exported ' + esc(tsFull(c.generated_at)) : 'no export yet') + '</div></div></div>';
      html += '<div class="grid2"><div class="col">';
      html += '<div class="panel" id="real-bets"><div class="ph"><h2>' + ICON.db + 'Real bets</h2><span class="sub">actual bets only · n ' + esc(c ? c.all.bets : 0) + '</span></div><div class="pb">';
      if (!c) {
        html += '<div class="empty" id="clv-empty"><div class="big">—</div><b>No system-sourced bets logged</b>CLV available after real bets are recorded and closing lines exist. The ledger lives on the Mac (tracker/bets.sqlite); its summary is exported by make settle.<div class="axis" aria-hidden="true"></div></div>';
      } else {
        const a = c.all;
        html += '<div class="kv"><div class="k">mean CLV (probability)</div><div class="v num">' + esc(signed(a.mean_clv_prob, 4)) + '</div><div class="k">beat the close</div><div class="v num">' + esc(pct(a.beat_close_pct)) + '</div>' +
          '<div class="k">bets / settled / graded</div><div class="v num">' + esc(a.bets) + ' / ' + esc(a.settled) + ' / ' + esc(a.graded) + '</div><div class="k">record</div><div class="v num">' + esc(a.record) + '</div></div>' +
          '<div class="tbl-wrap"><table class="tbl" style="margin-top:12px"><thead><tr><th>Bettor</th><th class="num">bets</th><th class="num">graded</th><th class="num">mean CLV</th><th class="num">beat %</th></tr></thead><tbody>' +
          Object.keys(c.by_bettor || {}).map((b) => { const x = c.by_bettor[b]; return '<tr><td>' + esc(b) + '</td><td class="num">' + esc(x.bets) + '</td><td class="num">' + esc(x.graded) + '</td><td class="num">' + esc(signed(x.mean_clv_prob, 4)) + '</td><td class="num">' + esc(pct(x.beat_close_pct)) + '</td></tr>'; }).join('') +
          '</tbody></table></div><p class="small muted">' + esc(c.source) + '. Bet-by-bet history is not exported to the site.</p>';
      }
      html += '</div></div>';
      html += '<div class="panel" id="bet-logging"><div class="ph"><h2>' + ICON.check + 'Bet logging</h2></div><div class="pb"><div id="bets-logged" class="card ph"><div class="kv">' + BETTORS.map((b) => '<div class="k">' + esc(b) + '</div><div class="v">—</div>').join('') + '</div></div><p class="small muted" id="logging-state">' + esc(window.NFL_EDGE_FIREBASE && window.NFL_EDGE_FIREBASE.enabled ? 'Bet logging connected: sign in to log a manually placed bet.' : 'Bet logging not connected') + '</p></div></div>';
      html += '</div><div class="col">' + shadowPanel() + '</div></div>';
      $main.innerHTML = html;
      window.scrollTo(0, 0);
      announce('ledger', w);
    };
    (latest ? loadWeek(latest) : Promise.resolve(null)).then(go).catch(() => go(null));
  }
  function shadowPanel() {
    const s = state.shadow;
    let h = '<div class="panel" id="shadow"><div class="ph"><h2>' + ICON.eye + 'Shadow research — zero stake</h2><span class="sub">never in real-bet totals</span></div><div class="pb">';
    if (!s || !s.tiers) return h + '<div class="empty"><b>Shadow summary not available.</b></div></div></div>';
    h += '<p class="small sec">One zero-stake lean per game, graded on CLV like a real bet but never counted as one. Rows <span class="num">' + esc(s.counts.rows) + '</span> · settled <span class="num">' + esc(s.counts.settled) + '</span> · pending <span class="num">' + esc(s.counts.pending) + '</span> · graded ' + esc(tsShort(s.generated_at)) + '.</p>';
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tier</th><th class="num">n</th><th class="num">mean CLV</th><th class="num">beat %</th><th>ATS</th></tr></thead><tbody>' +
      s.tiers.map((t) => '<tr><td>' + esc(t.tier) + '</td><td class="num">' + esc(t.rows) + '</td><td class="num">' + esc(signed(t.mean_clv, 4)) + '</td><td class="num">' + esc(pct(t.beat_close_pct)) + '</td><td class="num">' + esc(t.ats) + '</td></tr>').join('') + '</tbody></table></div>';
    h += '<p class="small muted">Tiers: A shortlist rule (a) met · B survivor lean, rule (a) not met · C watch angles only · D forced default (no signal). Stale entries are excluded from the CLV means.</p>';
    return h + '</div></div>';
  }

  // ------------------------------------------------------------ view: System Status (#/system[/<section>])
  const SYS_SECTIONS = [['how-we-grade', 'How we grade'], ['how-to-read', 'How to read the scan'], ['glossary', 'Glossary'], ['house-rules', 'House rules'], ['data-sources', 'Data sources and freshness'], ['market-baseline', 'Market baseline (7.1)'], ['changelog', 'Changelog']];
  function viewSystem(section) {
    setNav('system');
    const latest = latestId();
    const go = (w) => {
      renderChrome(w);
      const m = state.manifest;
      let html = '<div class="head"><div><h1>System Status</h1><div class="subl">Scan, odds, verification, weather, publish · words, not percentages</div></div></div>';
      html += '<div class="grid2"><div class="col"><div class="panel" id="sys"><div class="ph"><h2>' + ICON.db + 'Status</h2></div><div class="pb"><div class="rows">';
      if (w) {
        const ss = scanState(w), os = oddsState(w), vs = verifyState(w);
        html += '<div class="row2"><span class="k">Weekly scan</span>' + chip(ss.cls, ss.word) + '<span class="d">' + esc(w.id) + ' · ' + esc(tsFull(w.generated_at)) + ' · ' + esc((w.counts || {}).games) + ' games · schedule refresh ' + esc(w.data_refresh || 'not recorded') + '</span></div>';
        html += '<div class="row2"><span class="k">Odds capture</span>' + chip(os.cls, os.word) + '<span class="d">' + esc(tsFull((w.odds_pull || {}).fetched_at)) + ' · ' + esc((w.books || []).join(', ')) + (os.detail ? ' · ' + esc(os.detail) : '') + '</span></div>';
        html += '<div class="row2"><span class="k">Week verification</span>' + chip(vs.cls, vs.word) + '<span class="d">' + esc(vs.detail) + (w.week_resolution && w.week_resolution.schedule ? ' · schedule pulled ' + esc(w.week_resolution.schedule.pulled_at) : '') + '</span></div>';
        html += '<div class="row2"><span class="k">Weather fetch</span>' + (w.weather ? chip(w.weather.status === 'ok' ? 'ok' : 'warn', w.weather.status === 'ok' ? 'Current' : w.weather.status) + '<span class="d">' + esc(w.weather.detail || '') + ' · ' + esc(tsFull(w.weather.fetched_at)) + ' · ' + esc(w.weather.host || '') + '</span>' : chip('neutral', 'Not checked') + '<span class="d">no forecast in this scan</span>') + '</div>';
      } else {
        html += '<div class="row2"><span class="k">Weekly scan</span>' + chip('bad', 'Missing') + '<span class="d">Latest weekly scan unavailable</span></div>';
      }
      html += '<div class="row2"><span class="k">Last publish</span>' + (m.last_publish ? chip('ok', 'Published') + '<span class="d">' + esc(m.last_publish.week) + ' · ' + esc(m.last_publish.published_at) + ' · engine ' + esc(m.last_publish.engine_head) + '</span>' : chip('neutral', 'Not published') + '<span class="d">Not published yet</span>') + '</div>';
      html += '<div class="row2"><span class="k">Real-bet ledger</span>' + (state.clv ? chip('ok', 'Connected') + '<span class="d">exported ' + esc(tsFull(state.clv.generated_at)) + '</span>' : chip('neutral', 'Not connected') + '<span class="d">No system-sourced bets logged</span>') + '</div>';
      html += '<div class="row2"><span class="k">Bet logging</span>' + (window.NFL_EDGE_FIREBASE && window.NFL_EDGE_FIREBASE.enabled ? chip('ok', 'Connected') + '<span class="d">' + esc(window.NFL_EDGE_FIREBASE.reason) + '</span>' : chip('neutral', 'Not connected') + '<span class="d">' + esc((window.NFL_EDGE_FIREBASE || {}).reason || 'not configured') + '</span>') + '</div>';
      html += '<div class="row2"><span class="k">Site data</span>' + chip('ok', 'Schema ' + esc(m.site_schema_version)) + '<span class="d">exported ' + esc(tsFull(m.exported_at)) + ' · ' + esc((m.weeks || []).length) + ' week file' + ((m.weeks || []).length === 1 ? '' : 's') + '</span></div>';
      html += '</div></div><div class="pfoot">Scheduled odds pulls: Tue / Thu / Sun mornings · Tuesday scan 07:30 · Phoenix time. Next pull time is not exposed by the scheduler.</div></div>';
      html += '<div class="panel"><div class="ph"><h2>' + ICON.clock + 'Scans on file</h2></div><div class="pb"><div class="rows">' + (m.weeks || []).map((e) => '<div class="row2"><span class="k"><a href="#/week/' + esc(e.id) + '">' + esc(e.id) + '</a></span>' + chip('neutral', 'Week ' + esc(e.week)) + '<span class="d">scan ' + esc(tsFull(e.generated_at)) + ' · odds ' + esc(tsFull(e.odds_pull_at)) + (e.counts && e.counts.lanes ? ' · BET ' + esc(e.counts.lanes['BET']) + ' · POSSIBLE BET ' + esc(e.counts.lanes['POSSIBLE BET']) + ' · NO BET ' + esc(e.counts.lanes['NO BET']) : '') + '</span></div>').join('') + '</div></div></div>';
      html += '</div><div class="col">' + referencePanel(section) + '</div></div>';
      $main.innerHTML = html;
      bindReference();
      if (section) { const el = document.getElementById(section); if (el) el.scrollIntoView({ block: 'start' }); } else window.scrollTo(0, 0);
      announce('system', w);
    };
    (latest ? loadWeek(latest) : Promise.resolve(null)).then(go).catch(() => go(null));
  }
  function breakevenPct(american) { const p = american < 0 ? (-american) / ((-american) + 100) : 100 / (american + 100); return p * 100; }
  function referencePanel(section) {
    const lib = state.angles || {};
    const latest = latestId();
    let h = '<div class="panel" id="reference"><div class="ph"><h2>' + ICON.eye + 'Reference</h2></div><div class="pb">';
    h += '<div class="pills" style="display:flex">' + SYS_SECTIONS.map((s) => '<button type="button" class="btn' + (section === s[0] ? ' on' : '') + '" data-sec="' + s[0] + '">' + esc(s[1]) + '</button>').join('') + '</div>';
    h += '<details class="disc" id="how-we-grade"' + (section === 'how-we-grade' ? ' open' : '') + '><summary>How we grade</summary>' +
      '<p class="small sec"><b>Closing line value (CLV) comes first.</b> A call is graded by whether the number we took beat the number the market closed at, measured as no-vig probability, not by whether it won. At a true 55% win rate it takes several hundred bets before a record separates from luck, while CLV converges in weeks.</p>' +
      '<table class="snap"><thead><tr><th>Price</th><th>Win rate needed to break even</th></tr></thead><tbody>' + [-105, -110, -115, -120].map((a) => '<tr><td>' + esc(price(a)) + '</td><td>' + breakevenPct(a).toFixed(1) + '%</td></tr>').join('') + '</tbody></table>' +
      '<p class="small muted">Computed as |price| / (|price| + 100) for negative prices.</p>' +
      '<p class="small sec"><b>Strength score.</b> ' + esc((lib.method || {}).strength_score || 'Method text not exported.') + '</p>' +
      '<p class="small sec"><b>Bet cards.</b> Every row tagged BET or POSSIBLE BET is printed as four lines: THE LINE, WHAT IT MEANS, OUR EDGE (the backtested cover rate of the row\'s strongest counted angle against the win rate the price requires, in percentage points) and PLACE THIS BET or WATCH. BET means tier A and a positive edge; a card that says PLACE THIS BET always has a positive edge and a BET tag.</p>' +
      '<p class="small sec"><b>Gates.</b> Week 9 gate, Tue 2026-11-10: first read of the production ledger, CLV by source and by bettor. Nothing is promoted or demoted on win/loss.</p></details>';
    h += '<details class="disc" id="how-to-read"' + (section === 'how-to-read' ? ' open' : '') + '><summary>How to read the scan</summary>' +
      '<p class="small sec"><b>Lean.</b> The strength score of a market: survivor weights summed by side and netted, capped at 1.5. A count of agreeing evidence, never a projected margin.</p>' +
      '<p class="small sec"><b>Survivor.</b> An angle whose two most recent five-season backtest windows both cleared the alive rule, in the direction its stated mechanism predicts. <b>Watch.</b> A plausible mechanism whose sample is still too small to promote; no weight.</p>' +
      '<p class="small sec"><b>Shortlist rules.</b> (a) two or more survivors lean the same way, or one survivor plus one watch angle, with no survivor leaning harder the other way; (b) the best available number has not already moved past the lean since the opener. An empty shortlist is a valid output.</p>' +
      '<p class="small sec"><b>Numbers to shop, never stakes.</b> The site names the line and the book where the best number sits and who can reach it. Sizing is yours.</p></details>';
    h += '<details class="disc" id="glossary"' + (section === 'glossary' ? ' open' : '') + '><summary>Glossary</summary><dl class="small sec">' +
      '<dt><b>CLV</b></dt><dd>The difference between the number you took and the number the market closed at, in no-vig probability.</dd>' +
      '<dt><b>Opener</b></dt><dd>The first line this system saw for a game: the earliest odds pull that carried it.</dd>' +
      '<dt><b>Closing line</b></dt><dd>The last available line before kickoff; bets are graded against it.</dd>' +
      '<dt><b>Expression</b></dt><dd>A situational flag or combination the backtest harness evaluated; every expression ever tested is logged, and the count is the multiple-comparison guard.</dd>' +
      '<dt><b>Backtest window</b></dt><dd>A five-season slice of 1999-2025. Two overlapping windows (2020-2024 and 2021-2025) must both pass for an angle to survive.</dd>' +
      '<dt><b>Number to shop</b></dt><dd>The best available line on the leaned side across the books the bettors can reach, with the book that posts it.</dd></dl></details>';
    h += '<details class="disc" id="house-rules"' + (section === 'house-rules' ? ' open' : '') + '><summary>House rules</summary><ul class="small sec">' +
      '<li>The system suggests numbers. Humans place every bet. Entertainment-budget stakes only.</li><li>Weekly win/loss is never a learning signal at this sample size; the backtest and CLV are the only two inputs that change anything.</li>' +
      '<li>No code adjusts angle weights from recent results.</li><li>Three bettors: Q, Mike, Marques. A fourth never requires a migration.</li><li>All timestamps are America/Phoenix (MST, no daylight saving).</li></ul></details>';
    h += '<details class="disc" id="data-sources"' + (section === 'data-sources' ? ' open' : '') + '><summary>Data sources and freshness</summary><dl class="small sec">' +
      '<dt><b>nflverse (via nfl_data_py)</b></dt><dd>Schedules, results, closing spreads and totals, 1999 to the live season; refreshed at each Tuesday scan.</dd>' +
      '<dt><b>The Odds API</b></dt><dd>Current and opening lines from the books listed on the week. Pulled Tue / Thu / Sun mornings; a pull older than ' + esc((state.viewWeek && state.viewWeek.rules || {}).stale_after_hours || 36) + ' hours is flagged stale.</dd>' +
      '<dt><b>Open-Meteo</b></dt><dd>Kickoff wind and temperature forecast, information only (the wind angles are not wired to it).</dd>' +
      '<dt><b>Firebase (bet entry)</b></dt><dd>The Firebase JS SDK 11.10.0 (compat build), pinned, from www.gstatic.com: the only external request this site makes. Signed out, nothing is sent anywhere.</dd>' +
      '<dt><b>Fonts</b></dt><dd>Manrope and IBM Plex Mono, self-hosted (SIL Open Font License, texts beside the files).</dd>' +
      '<dt><b>Latest scan</b></dt><dd>' + (latest ? '<a href="#/week/' + esc(latest) + '">' + esc(latest) + '</a>' : '—') + '. A scan older than ' + STALE_SCAN_DAYS + ' days is flagged stale.</dd></dl></details>';
    h += '<details class="disc" id="market-baseline"' + (section === 'market-baseline' ? ' open' : '') + '><summary>Market baseline (7.1)</summary>' + marketBaseline() + '</details>';
    h += '<details class="disc" id="changelog"' + (section === 'changelog' ? ' open' : '') + '><summary>Changelog</summary><p class="small muted">The build log in the source repo (claude/build-log.md) is the record. 2026-10-10: interface rebuilt as the desktop Command Center and phone Companion.</p></details>';
    return h + '</div></div>';
  }
  function bindReference() {
    document.querySelectorAll('[data-sec]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/system/' + b.getAttribute('data-sec'); }));
  }
  // 7.1: reports/market_baseline.md copied to data/market_baseline.md by make site; a deliberately small markdown subset
  function mdToHtml(md) {
    const lines = md.split(/\r?\n/), out = []; let para = [], table = null;
    const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    const flushP = () => { if (para.length) { out.push('<p class="small sec">' + inline(para.join(' ')) + '</p>'); para = []; } };
    const flushT = () => {
      if (!table) return;
      out.push('<div class="tbl-wrap"><table class="snap"><thead><tr>' + table.head.map((c) => '<th>' + inline(c) + '</th>').join('') + '</tr></thead><tbody>' +
        table.rows.map((r) => '<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>');
      table = null;
    };
    lines.forEach((ln) => {
      let m;
      if (/^\s*\|/.test(ln)) {
        const cells = ln.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());
        if (/^\s*\|?\s*:?-{2,}/.test(ln)) return;
        flushP();
        if (!table) table = { head: cells, rows: [] }; else table.rows.push(cells);
        return;
      }
      flushT();
      if ((m = ln.match(/^(#{1,4})\s+(.*)$/))) { flushP(); out.push('<h4 class="small" style="margin-top:10px">' + inline(m[2]) + '</h4>'); return; }
      if ((m = ln.match(/^\s*[-*]\s+(.*)$/))) { flushP(); out.push('<ul class="small sec"><li>' + inline(m[1]) + '</li></ul>'); return; }
      if (!ln.trim()) { flushP(); return; }
      para.push(ln.trim());
    });
    flushP(); flushT();
    return out.join('\n').replace(/<\/ul>\n<ul class="small sec">/g, '');
  }
  function marketBaseline() {
    const file = state.manifest && state.manifest.reports && state.manifest.reports.market_baseline;
    if (!file) return '<div class="empty">Market baseline report not exported to the site.</div>';
    fetch('data/' + file + '?v=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }).then((r) => r.text()).then((t) => {
      const el = document.getElementById('mb'); if (el) el.innerHTML = mdToHtml(t);
    }).catch(() => { const el = document.getElementById('mb'); if (el) el.innerHTML = '<div class="banner bad">Could not load the report.</div>'; });
    return '<p class="small muted">How far closing spreads and totals miss, by season, week bucket, spread size, favourite side, primetime and divisional. Infrastructure, not a tested angle; nothing here is a suggestion to bet.</p><div id="mb"><div class="loading">Loading…</div></div>';
  }

  // ------------------------------------------------------------ failure + the bets.js hook
  function fail(err) {
    state.rendered = null;
    renderChrome(null);
    $main.innerHTML = '<div class="banner bad" id="banner-missing"><b>Latest weekly scan unavailable.</b> Nothing is suggested. <code>' + esc(err && err.message ? err.message : err) + '</code></div>';
    announce(state.view, null);
  }
  window.NFLEdge = { currentWeek: () => state.viewWeek, bettors: BETTORS.slice() };
  function announce(view, w) {
    state.viewWeek = w || null;
    try { window.dispatchEvent(new CustomEvent('nfl-edge:rendered', { detail: { view: view, week: w ? w.id : null } })); } catch (e) {}
  }

  // ------------------------------------------------------------ router
  function route() {
    const h = location.hash || '#/week';
    const p = h.replace(/^#\/?/, '').split('/').filter(Boolean);
    const page = p[0] || 'week';
    // old links (the 09-20 interface) land on a rendered view
    if (page === 'dashboard') return location.replace('#/week');
    if (page === 'weeks') return location.replace('#/week' + (p[1] ? '/' + p[1] + (p[2] ? '/' + p[2] : '') : ''));
    if (page === 'appendix') return location.replace('#/system' + (p[1] ? '/' + (p[1] === 'angle-library' ? '' : p[1]) : ''));
    state.view = page;
    // the canvas for this week is already in place: only the evidence changes (open / switch / close), the scroll stays
    const id = p[1] || latestId();
    if ((page === 'week' || page === 'slate') && state.rendered && state.rendered.view === page && state.rendered.id === id && state.weeks[id]) {
      if (p[2]) openEvidence(state.weeks[id], p[2]); else closeEvidence(false);
      return;
    }
    closeEvidence(false);
    state.rendered = null;   // every other render replaces the canvas; viewWeek / viewSlate record theirs after rendering
    if (page === 'week') return viewWeek(p[1] || null, p[2] || null);
    if (page === 'slate') return viewSlate(p[1] || null, p[2] || null);
    if (page === 'angles') return viewAngles();
    if (page === 'ledger') return viewLedger();
    if (page === 'system') return viewSystem(p[1] || null);
    location.replace('#/week');
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  Promise.all([fetchJSON('data/manifest.json'), fetchJSON('data/angles.json').catch(() => null),
               fetchJSON('data/shadow_summary.json').catch(() => null), fetchJSON('data/clv_summary.json').catch(() => null)])
    .then((res) => {
      state.manifest = res[0]; state.angles = res[1]; state.shadow = res[2]; state.clv = res[3];
      window.addEventListener('hashchange', route);
      route();
    })
    .catch((err) => {
      $asof.textContent = 'Data unavailable'; $chip.className = 'chip bad'; $chip.textContent = 'Scan missing';
      $main.innerHTML = '<div class="banner bad" id="banner-missing"><b>Latest weekly scan unavailable.</b> Nothing is suggested. <code>' + esc(err && err.message ? err.message : err) + '</code></div>';
    });
})();
