/* NFL Edge site — plain JS, hash routing, renders from data/*.json.
   Routes: #/dashboard | #/weeks | #/weeks/<id> | #/weeks/<id>/<game_id> | #/appendix | #/appendix/<section>
   Nothing here is shared state: the only browser storage is the per-viewer theme choice. */
(function () {
  'use strict';

  var TZ = 'America/Phoenix';
  var STALE_DAYS = 8;
  var BETTORS = ['Q', 'Mike', 'Marques'];
  var state = { manifest: null, angles: null, weeks: {}, leansOnly: false, sortDesc: false, angleFilter: 'all' };
  var $main = document.getElementById('main');
  var $updated = document.getElementById('updated');
  var $stale = document.getElementById('stale');

  // ------------------------------------------------------------ helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTs(iso, opts) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    var o = opts || { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    o.timeZone = TZ;
    try { return d.toLocaleString('en-US', o); } catch (e) { return esc(iso); }
  }
  function fmtDate(iso) { return fmtTs(iso, { month: 'short', day: 'numeric', year: 'numeric' }); }
  function ageDays(iso) { var d = new Date(iso); return isNaN(d) ? null : (Date.now() - d.getTime()) / 864e5; }
  function pct(v) { return v == null ? '—' : Number(v).toFixed(1) + '%'; }
  function signed(v) { return v == null ? '—' : (v > 0 ? '+' : '') + Number(v); }
  function pts(v) { return v == null ? '—' : (Number(v) === 0 ? '0' : Number(v).toFixed(2).replace(/\.?0+$/, '')) + ' pt'; }
  function fetchJSON(path) {
    var sep = path.indexOf('?') < 0 ? '?' : '&';
    return fetch(path + sep + 'v=' + Math.floor(Date.now() / 60000), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' -> HTTP ' + r.status);
      return r.json();
    });
  }
  function pill(tier, text) { return '<span class="pill ' + esc(tier) + '">' + esc(text || tier) + '</span>'; }
  function windowsHtml(w) {
    if (!w) return '<span class="muted">no windows</span>';
    return '<span class="windows">' + Object.keys(w).map(function (k) {
      return '<span class="num">' + esc(k) + ': ' + pct(w[k].pct) + ' (n ' + esc(w[k].n) + ')</span>';
    }).join('') + '</span>';
  }
  function lineText(market, side, line) {
    if (line == null || !side) return '—';
    return market === 'spread' ? side + ' ' + signed(line) : side + ' ' + line;
  }
  function leanText(m) {
    if (!m || !m.lean_side) return '—';
    return m.lean_side + ' ' + (Number(m.lean_points) || 0);
  }
  function setNav(name) {
    var links = document.querySelectorAll('.nav a');
    for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', links[i].getAttribute('data-nav') === name);
  }
  function weekTitle(w) { return 'Week ' + w.week + ' · ' + w.season; }

  // ------------------------------------------------------------ theme (per-viewer only)
  (function theme() {
    var btn = document.getElementById('theme');
    var saved = null;
    try { saved = localStorage.getItem('nfl-edge-theme'); } catch (e) {}
    if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
    btn.addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var sysDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var isDark = cur ? cur === 'dark' : sysDark;
      var next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('nfl-edge-theme', next); } catch (e) {}
    });
  })();

  // ------------------------------------------------------------ data
  function loadWeek(id) {
    if (state.weeks[id]) return Promise.resolve(state.weeks[id]);
    var entry = null;
    (state.manifest.weeks || []).forEach(function (w) { if (w.id === id) entry = w; });
    if (!entry) return Promise.reject(new Error('unknown week ' + id));
    return fetchJSON('data/' + entry.file).then(function (d) { state.weeks[id] = d; return d; });
  }
  function latestId() { return state.manifest && state.manifest.latest_week; }

  function headerFromLatest() {
    var id = latestId();
    var entry = null;
    (state.manifest.weeks || []).forEach(function (w) { if (w.id === id) entry = w; });
    if (!entry) { $updated.textContent = 'No scans yet'; return; }
    $updated.textContent = 'Updated ' + fmtTs(entry.generated_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Phx';
    var age = ageDays(entry.generated_at);
    if (age != null && age > STALE_DAYS) {
      $stale.innerHTML = '<div class="banner warn"><b>Stale.</b> The latest scan (' + esc(entry.id) + ') is ' + Math.floor(age) +
        ' days old. Treat every number on this site as old until a new Tuesday scan is published.</div>';
      $stale.hidden = false;
    } else {
      $stale.hidden = true;
    }
  }

  // ------------------------------------------------------------ shared renderers
  function shopHtml(market, m) {
    var n = m.number_to_shop;
    if (!n) return '';
    return '<div class="shop">Shop: ' + esc(lineText(market, m.lean_side, n.line)) +
      (n.price != null ? ' <span class="num">(' + esc(signed(n.price)) + ')</span>' : '') +
      ' at ' + esc(n.book) + '</div>' +
      '<div class="small muted">reachable by ' + esc((n.reachable_by || []).join(', ') || 'nobody') +
      ' · consensus <span class="num">' + esc(n.consensus) + '</span> across ' + esc(n.books_quoting) + ' books' +
      (m.opener_consensus != null ? ' · opener <span class="num">' + esc(m.opener_consensus) + '</span> → now <span class="num">' + esc(n.line) + '</span>' : '') +
      (m.moved_toward_lean != null ? ' (moved <span class="num">' + esc(signed(m.moved_toward_lean)) + '</span>; <span class="num">' + esc(m.lean_remaining) + '</span> of the lean remains)' : '') +
      '</div>';
  }
  function angleLi(a, against) {
    var tier = against ? 'against' : a.tier;
    return '<li>' + pill(tier, against ? 'against' : a.tier) + ' <span class="name">' + esc(a.name) + '</span> ' +
      '<span class="muted">' + esc(a.direction_label || (a.direction + ' ' + a.flagged_team)) + '</span> · ' +
      '<span class="num">' + esc(pts(a.points)) + '</span> · n <span class="num">' + esc(a.n) + '</span><br>' +
      windowsHtml(a.windows) +
      (a.mechanism ? '<div class="mech">' + esc(a.mechanism) + '</div>' : '') + '</li>';
  }
  function shortlistCard(s, weekId) {
    var m = s;
    var href = '#/weeks/' + weekId + '/' + s.game_id;
    return '<div class="card"><h3>' + esc(lineText(s.market, s.lean_side, (s.number_to_shop || {}).line)) +
      ' · <a href="' + href + '">' + esc(s.matchup) + '</a> <span class="small muted">' + esc(s.kickoff_display) + '</span></h3>' +
      '<div class="small">' + esc(s.market) + ' · lean <b>' + esc(leanText(m)) + '</b> · ' + esc(m.verdict) + '</div>' +
      shopHtml(s.market, m) +
      '<details><summary>Why (' + (m.angles_for || []).length + ' for, ' + (m.angles_against || []).length + ' against)</summary><ul class="angles">' +
      (m.angles_for || []).map(function (a) { return angleLi(a, false); }).join('') +
      (m.angles_against || []).map(function (a) { return angleLi(a, true); }).join('') +
      '</ul></details></div>';
  }
  function shortlistSection(w) {
    var h = '';
    if (!w.shortlist || !w.shortlist.length) {
      h += '<div class="empty"><b>Empty</b> — no game met both rules. Valid output.</div>';
    } else {
      h += w.shortlist.map(function (s) { return shortlistCard(s, w.id); }).join('');
    }
    return h;
  }
  function leansList(w) {
    var rows = [];
    (w.games || []).forEach(function (g) {
      ['spread', 'total'].forEach(function (mk) {
        var m = g[mk];
        if (m && m.lean_side) rows.push({ g: g, mk: mk, m: m });
      });
    });
    if (!rows.length) return '<div class="empty">No game carries a lean this week.</div>';
    return '<ul class="lean-list">' + rows.map(function (r) {
      return '<li><a class="m" href="#/weeks/' + esc(w.id) + '/' + esc(r.g.game_id) + '">' + esc(r.g.matchup) + '</a>' +
        '<span class="small muted">' + esc(r.g.kickoff_display) + '</span>' +
        '<span>' + esc(r.mk) + ' <b>' + esc(leanText(r.m)) + '</b></span>' +
        '<span class="small muted">' + esc(r.m.verdict) + '</span></li>';
    }).join('') + '</ul>';
  }
  function statStrip(w) {
    var c = w.counts || {};
    return '<div class="stats">' +
      '<div class="stat"><div class="k">Games</div><div class="v">' + esc(c.games) + '</div></div>' +
      '<div class="stat"><div class="k">Survivors</div><div class="v">' + esc(c.survivors) + '</div></div>' +
      '<div class="stat"><div class="k">Watch</div><div class="v">' + esc(c.watch) + '</div></div>' +
      '<div class="stat"><div class="k">Odds pull (Phx)</div><div class="v txt">' + fmtTs((w.odds_pull || {}).fetched_at) + '</div></div>' +
      '<div class="stat"><div class="k">Books</div><div class="v txt">' + esc((w.books || []).join(', ') || '—') + '</div></div>' +
      '</div>';
  }
  function placeholderCard(title, rows) {
    return '<div class="card ph"><h3>' + esc(title) + ' ' + pill('ph', 'Not live yet') + '</h3>' +
      '<div class="kv">' + rows.map(function (r) { return '<div class="k">' + esc(r[0]) + '</div><div class="ph-val">' + esc(r[1]) + '</div>'; }).join('') + '</div></div>';
  }

  // ------------------------------------------------------------ views
  function viewDashboard() {
    setNav('dashboard');
    var id = latestId();
    if (!id) { $main.innerHTML = '<h1>Dashboard</h1><div class="empty">No scan has been published yet.</div>' + placeholders(); return; }
    loadWeek(id).then(function (w) {
      var html = '<h1>Dashboard <span class="small muted">' + esc(weekTitle(w)) + '</span></h1>';
      html += pullBanner(w);
      html += statStrip(w);
      html += '<h2>This week\'s shortlist (' + esc((w.counts || {}).shortlist) + ')</h2>' + shortlistSection(w);
      html += '<h2>Games with a lean</h2>' + leansList(w);
      html += '<p class="small"><a href="#/weeks/' + esc(w.id) + '">Open the full Week ' + esc(w.week) + ' view →</a></p>';
      html += placeholders();
      $main.innerHTML = html;
      window.scrollTo(0, 0);
    }).catch(fail);
  }
  function placeholders() {
    return '<h2>Season tracking</h2><div class="grid two">' +
      placeholderCard('Season CLV', [['closing line value', '—'], ['bets graded', '—'], ['source', 'make settle (not yet wired to this site)']]) +
      placeholderCard('Bets logged', BETTORS.map(function (b) { return [b, '—']; })) +
      placeholderCard('Week 6 props gate', [['countdown', '—'], ['CLV denominator', '—'], ['threshold', '—']]) +
      placeholderCard('Angle scoreboard 2026', [['survivors fired', '—'], ['watch fired', '—'], ['CLV by angle', '—']]) +
      '</div><p class="small muted">Dashes are placeholders, not zeros. These cards go live when the bet log and CLV report are wired to the site.</p>';
  }
  function pullBanner(w) {
    var lp = w.odds_pull || {};
    if (!lp.succeeded) return '<div class="banner bad">Line pull failed or missing (' + esc(lp.detail || 'no detail') + '). Numbers below may be stale.</div>';
    if (lp.stale) return '<div class="banner warn">Line pull is stale: ' + esc(lp.detail) + '. Numbers to shop may have moved.</div>';
    return '<div class="banner ok">Line pull OK: ' + esc(lp.detail) + '. Books ' + esc((w.books || []).join(', ')) + '.</div>';
  }
  function fail(err) {
    $main.innerHTML = '<div class="banner bad">Could not load data: ' + esc(err && err.message ? err.message : err) + '</div>';
  }

  function viewWeeks(id, gameId) {
    setNav('weeks');
    var weeks = state.manifest.weeks || [];
    if (!weeks.length) { $main.innerHTML = '<h1>Weeks</h1><div class="empty">No scan has been published yet.</div>'; return; }
    if (!id) { location.replace('#/weeks/' + latestId()); return; }
    var idx = -1;
    weeks.forEach(function (w, i) { if (w.id === id) idx = i; });
    if (idx < 0) {
      $main.innerHTML = '<h1>Weeks</h1>' + picker(null) + '<div class="empty">No scan on file for <b>' + esc(id) + '</b>. Pick a week above.</div>';
      return;
    }
    loadWeek(id).then(function (w) {
      var html = '<h1>' + esc(weekTitle(w)) + '</h1>' + picker(idx);
      if (!w.games || !w.games.length) {
        html += '<div class="empty"><b>Empty week.</b> The scan for ' + esc(w.id) + ' produced no games.</div>';
        $main.innerHTML = html; return;
      }
      html += pullBanner(w);
      html += '<div class="meta">' +
        '<span>generated <b>' + fmtTs(w.generated_at) + ' Phx</b></span>' +
        '<span>odds pull <b>' + fmtTs((w.odds_pull || {}).fetched_at) + ' Phx</b></span>' +
        '<span>books <b>' + esc((w.books || []).join(', ')) + '</b></span>' +
        '<span>games <b class="num">' + esc(w.counts.games) + '</b></span>' +
        '<span>survivors <b class="num">' + esc(w.counts.survivors) + '</b> · watch <b class="num">' + esc(w.counts.watch) + '</b></span>' +
        '<span>expressions tested <b class="num">' + esc(w.counts.expressions_tested) + '</b></span>' +
        (w.data_refresh ? '<span>data refresh <b>' + esc(w.data_refresh) + '</b></span>' : '') +
        '</div>';
      html += '<details class="small"><summary>How this week was scored</summary><p><b>Lean</b> = sum of survivor weights on a market, capped at ±' +
        esc((w.rules || {}).lean_cap_points) + ' points. Watch angles weigh 0.</p><p><b>Shortlist</b>: ' + esc((w.rules || {}).shortlist) + '</p>' +
        '<p>Line pull counts as stale after ' + esc((w.rules || {}).stale_after_hours) + ' hours. <a href="#/appendix/how-to-read">Full reading guide →</a></p></details>';
      html += '<h2>Shortlist (' + esc(w.counts.shortlist) + ')</h2>' + shortlistSection(w);
      html += '<h2>All games</h2>' + gamesTable(w);
      html += '<h2>Angles by game</h2>' + gameCards(w);
      html += '<h2>Not wired this week</h2>' + notWired(w);
      $main.innerHTML = html;
      bindWeekControls(w);
      if (gameId) {
        var el = document.getElementById('g-' + gameId);
        if (el) {
          el.classList.add('hl');
          // twice: once now, once after the browser's own load-time fragment scroll (which resets to top
          // because "#/weeks/..." matches no element) so a deep-link reload still lands on the card.
          var go = function () { el.scrollIntoView({ block: 'start' }); };
          requestAnimationFrame(go);
          setTimeout(go, 250);
        }
      } else {
        window.scrollTo(0, 0);
      }
    }).catch(fail);
  }
  function picker(idx) {
    var weeks = state.manifest.weeks || [];
    var opts = weeks.map(function (w, i) {
      return '<option value="' + esc(w.id) + '"' + (i === idx ? ' selected' : '') + '>' + esc(w.id) + ' — Week ' + esc(w.week) + ', ' + esc(w.season) +
        (w.counts ? ' (' + esc(w.counts.shortlist) + ' shortlisted)' : '') + '</option>';
    }).join('');
    // newest first in the manifest: "prev" = older = higher index
    var prevDisabled = idx == null || idx >= weeks.length - 1;
    var nextDisabled = idx == null || idx <= 0;
    return '<div class="toolbar">' +
      '<button class="btn" id="wk-prev" type="button"' + (prevDisabled ? ' disabled' : '') + '>‹ Older</button>' +
      '<select id="wk-sel" aria-label="Pick a week">' + (idx == null ? '<option value="">Pick a week</option>' : '') + opts + '</select>' +
      '<button class="btn" id="wk-next" type="button"' + (nextDisabled ? ' disabled' : '') + '>Newer ›</button>' +
      '</div>';
  }
  function gamesTable(w) {
    var games = w.games.slice();
    games.sort(function (a, b) {
      var c = String(a.kickoff_phoenix).localeCompare(String(b.kickoff_phoenix));
      return state.sortDesc ? -c : c;
    });
    var shown = games.filter(function (g) { return !state.leansOnly || (g.spread && g.spread.lean_side) || (g.total && g.total.lean_side); });
    var h = '<div class="toolbar">' +
      '<label class="chk"><input type="checkbox" id="leans-only"' + (state.leansOnly ? ' checked' : '') + '> Leans only</label>' +
      '<button class="btn" id="sort-kick" type="button">Kickoff ' + (state.sortDesc ? '↓ latest first' : '↑ earliest first') + '</button>' +
      '<span class="small muted">' + shown.length + ' of ' + games.length + ' games</span></div>';
    if (!shown.length) return h + '<div class="empty">No game carries a lean this week.</div>';
    h += '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Game</th><th>Kick (Phx)</th><th>Spread lean</th><th class="wrap">Spread verdict</th><th>Total lean</th><th class="wrap">Total verdict</th></tr></thead><tbody>';
    shown.forEach(function (g) {
      var hasLean = (g.spread && g.spread.lean_side) || (g.total && g.total.lean_side);
      h += '<tr' + (hasLean ? ' class="lean"' : '') + '><td><a href="#/weeks/' + esc(w.id) + '/' + esc(g.game_id) + '">' + esc(g.matchup) + '</a></td>' +
        '<td class="num">' + esc(g.kickoff_display) + '</td>' +
        '<td class="num">' + esc(leanText(g.spread)) + '</td><td class="wrap">' + esc(g.spread.verdict) + '</td>' +
        '<td class="num">' + esc(leanText(g.total)) + '</td><td class="wrap">' + esc(g.total.verdict) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  function gameCards(w) {
    var games = w.games.slice().sort(function (a, b) { return String(a.kickoff_phoenix).localeCompare(String(b.kickoff_phoenix)); });
    return games.map(function (g) {
      var fired = g.angles_fired || [];
      var h = '<div class="card' + (fired.length ? '' : ' plain') + '" id="g-' + esc(g.game_id) + '">' +
        '<div class="game-line"><h3 style="margin:0">' + esc(g.matchup) + '</h3><span class="small muted">' + esc(g.kickoff_display) + '</span>' +
        '<span class="small">spread <b>' + esc(leanText(g.spread)) + '</b> · ' + esc(g.spread.verdict) + '</span>' +
        '<span class="small">total <b>' + esc(leanText(g.total)) + '</b> · ' + esc(g.total.verdict) + '</span></div>';
      ['spread', 'total'].forEach(function (mk) { if (g[mk] && g[mk].number_to_shop) h += shopHtml(mk, g[mk]); });
      if (fired.length) h += '<ul class="angles">' + fired.map(function (a) { return angleLi(a, false); }).join('') + '</ul>';
      else h += '<div class="small muted">No angle fired.</div>';
      return h + '</div>';
    }).join('');
  }
  function notWired(w) {
    var nw = w.not_wired || [];
    if (!nw.length) return '<div class="empty">Every surviving angle was wired this week.</div>';
    return '<ul class="angles card plain">' + nw.map(function (a) {
      return '<li>' + pill(a.tier || 'watch') + ' <span class="name">' + esc(a.name) + '</span><div class="mech">' + esc(a.reason) + '</div></li>';
    }).join('') + '</ul>';
  }
  function bindWeekControls(w) {
    var weeks = state.manifest.weeks || [];
    var idx = -1;
    weeks.forEach(function (x, i) { if (x.id === w.id) idx = i; });
    var sel = document.getElementById('wk-sel');
    var prev = document.getElementById('wk-prev');
    var next = document.getElementById('wk-next');
    if (sel) sel.addEventListener('change', function () { if (sel.value) location.hash = '#/weeks/' + sel.value; });
    if (prev) prev.addEventListener('click', function () { if (idx < weeks.length - 1) location.hash = '#/weeks/' + weeks[idx + 1].id; });
    if (next) next.addEventListener('click', function () { if (idx > 0) location.hash = '#/weeks/' + weeks[idx - 1].id; });
    var lo = document.getElementById('leans-only');
    var sk = document.getElementById('sort-kick');
    if (lo) lo.addEventListener('change', function () { state.leansOnly = lo.checked; route(); });
    if (sk) sk.addEventListener('click', function () { state.sortDesc = !state.sortDesc; route(); });
  }

  // ------------------------------------------------------------ appendix
  var AP_SECTIONS = [
    ['how-to-read', 'How to read the scan'],
    ['angle-library', 'Angle library'],
    ['glossary', 'Glossary'],
    ['house-rules', 'House rules'],
    ['data-sources', 'Data sources and freshness'],
    ['changelog', 'Changelog']
  ];
  function viewAppendix(section) {
    setNav('appendix');
    var lib = state.angles || { angles: [] };
    var latest = latestId();
    var html = '<h1>Appendix</h1><div class="subnav">' + AP_SECTIONS.map(function (s) {
      return '<a href="#/appendix/' + s[0] + '"' + (section === s[0] ? ' class="active"' : '') + '>' + esc(s[1]) + '</a>';
    }).join('') + '</div>';

    html += '<section class="ap" id="how-to-read"><h2>How to read the scan</h2>' +
      '<p><b>Lean.</b> Each surviving angle that fires on a game pushes that market (spread or total) toward one side by its weight in points. The lean is the sum of survivor weights, capped at ±1.5 points. Watch angles weigh 0 and only count toward the shortlist rule.</p>' +
      '<p><b>Survivor.</b> An angle whose two most recent five-season backtest windows both cleared the alive rule, in the direction its stated mechanism predicts. Survivors carry weight.</p>' +
      '<p><b>Watch.</b> A plausible mechanism whose sample is still too small to promote. Trackable at minimum stake, no weight.</p>' +
      '<p><b>Shortlist rules.</b> A market is shortlisted only when (a) two or more survivors lean the same way, or one survivor plus one watch angle, with no survivor leaning harder the other way; and (b) the best available number has not already moved past the lean since the opener. An empty shortlist is a valid, honest output.</p>' +
      '<p><b>Numbers to shop, not stakes.</b> The site names the line and the book where the best number sits and who can reach it. It never suggests a stake. Sizing is yours.</p></section>';

    html += '<section class="ap" id="angle-library"><h2>Angle library</h2>' +
      '<div class="meta"><span>source <b>' + esc(lib.source || 'config/angles.yaml') + '</b></span><span>generated <b>' + esc(lib.generated || '—') + '</b></span>' +
      '<span>sample <b>' + esc(lib.sample || '—') + '</b></span>' +
      (lib.harness_log ? '<span>expressions tested <b class="num">' + esc(lib.harness_log.distinct_expressions) + '</b> across <b class="num">' + esc(lib.harness_log.runs) + '</b> runs</span>' : '') +
      (lib.alive_rule ? '<span>alive rule <b>both windows ≥ ' + esc(lib.alive_rule.min_recent_window_pct) + '% on ≥ ' + esc(lib.alive_rule.min_recent_n) + ' games</b></span>' : '') + '</div>' +
      angleFilterBar(lib) + '<div id="angle-list">' + angleList(lib) + '</div></section>';

    html += '<section class="ap" id="glossary"><h2>Glossary</h2><dl class="gl">' +
      '<dt>CLV (closing line value)</dt><dd>The difference between the number you took and the number the market closed at. Beating the close consistently is the only weekly signal this system trusts. Win/loss at this sample size is noise.</dd>' +
      '<dt>Opener</dt><dd>The first line this system saw for a game: the earliest odds pull that carried it.</dd>' +
      '<dt>Closing line</dt><dd>The last available line before kickoff. Bets are graded against it for CLV.</dd>' +
      '<dt>Lean</dt><dd>The net push from survivor angles on one market, in points, capped at ±1.5.</dd>' +
      '<dt>Expression</dt><dd>A situational flag or combination of flags (for example <code>off_thursday</code> or <code>dome_team_outdoors_cold,high_wind</code>) that the backtest harness evaluated. Every expression ever tested is logged; the count is the multiple-comparison guard.</dd>' +
      '<dt>Backtest window</dt><dd>A five-season slice of the 1999–2025 history. Two overlapping windows (2020–2024 and 2021–2025) must both pass for an angle to survive.</dd>' +
      '<dt>Number to shop</dt><dd>The best available line on the leaned side across the books our bettors can reach, with the book that posts it.</dd>' +
      '</dl></section>';

    html += '<section class="ap" id="house-rules"><h2>House rules</h2>' +
      '<div class="card ph"><h3>Full house rules ' + pill('ph', 'Placeholder') + '</h3><p class="small muted">The full system brief is not in the repo yet. The rules below are the ones already written into the project instructions.</p></div>' +
      '<ul><li>The system suggests numbers. Humans place every bet. Entertainment-budget stakes only.</li>' +
      '<li>Weekly win/loss is never a learning signal at this sample size. The backtest and CLV are the only two inputs that change anything.</li>' +
      '<li>No code adjusts angle weights from recent results.</li>' +
      '<li>Every angle tested is a logged draw against the same 27 seasons. Candidates are not added casually.</li>' +
      '<li>Three bettors: Q, Mike, Marques. Adding a fourth never requires a migration.</li>' +
      '<li>All timestamps are America/Phoenix, no daylight saving.</li></ul></section>';

    html += '<section class="ap" id="data-sources"><h2>Data sources and freshness</h2><dl class="gl">' +
      '<dt>nflverse (via nfl_data_py)</dt><dd>Schedules, results, closing spreads and totals, 1999 to the live season. Refreshed at each Tuesday scan.</dd>' +
      '<dt>The Odds API</dt><dd>Current and opening lines from the books listed in the week view. Pulled on the scan schedule; the week view shows the pull time and flags a pull older than 36 hours as stale.</dd>' +
      '<dt>Latest scan</dt><dd>' + (latest ? '<a href="#/weeks/' + esc(latest) + '">' + esc(latest) + '</a>' : '—') + '. This site warns when the latest scan is more than ' + STALE_DAYS + ' days old.</dd>' +
      '<dt>Pull timestamps</dt><dd id="pull-ts">' + pullTimestamps() + '</dd>' +
      '<dt>Retention</dt><dd>One JSON file per week under <code>data/weeks/</code>. Re-running a week overwrites only that week. Git history is the archive.</dd>' +
      '</dl></section>';

    html += '<section class="ap" id="changelog"><h2>Changelog</h2>' +
      '<div class="card ph"><h3>Changelog ' + pill('ph', 'Placeholder') + '</h3><p class="small muted">Site and angle-library changes will be listed here once the process is agreed. For now, the build log in the source repo is the record.</p></div></section>';

    $main.innerHTML = html;
    bindAngleFilter(lib);
    if (section) {
      var el = document.getElementById(section);
      if (el) el.scrollIntoView({ block: 'start' });
    } else {
      window.scrollTo(0, 0);
    }
  }
  function pullTimestamps() {
    var weeks = state.manifest.weeks || [];
    if (!weeks.length) return '—';
    return weeks.map(function (w) {
      return '<div><a href="#/weeks/' + esc(w.id) + '">' + esc(w.id) + '</a>: scan ' + fmtTs(w.generated_at) + ' Phx · odds ' + fmtTs(w.odds_pull_at) + ' Phx</div>';
    }).join('');
  }
  function angleFilterBar(lib) {
    var c = lib.counts || {};
    var opts = [['all', 'All'], ['survivor', 'Survivors' + (c.survivor != null ? ' (' + c.survivor + ')' : '')],
      ['watch', 'Watch' + (c.watch != null ? ' (' + c.watch + ')' : '')], ['dead', 'Dead' + (c.dead != null ? ' (' + c.dead + ')' : '')]];
    return '<div class="filter">' + opts.map(function (o) {
      return '<button type="button" class="btn' + (state.angleFilter === o[0] ? ' on' : '') + '" data-f="' + o[0] + '">' + esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }
  function angleList(lib) {
    var rows = (lib.angles || []).filter(function (a) { return state.angleFilter === 'all' || a.status === state.angleFilter; });
    if (!rows.length) return '<div class="empty">No angles with that status.</div>';
    return rows.map(function (a) {
      var bt = a.backtest;
      var h = '<div class="card plain"><h3>' + pill(a.status) + ' ' + esc(a.name) +
        (a.not_wired_reason ? ' ' + pill('against', 'not wired') : '') + '</h3>' +
        '<div class="small muted">expression <code>' + esc(a.expression) + '</code>' +
        (a.direction ? ' · ' + esc(a.direction) + ' ' + esc(a.market) : '') +
        (a.status !== 'dead' ? ' · weight <span class="num">' + esc(pts(a.weight_points)) + '</span>' : '') + '</div>' +
        '<p>' + esc(a.description) + '</p>';
      if (bt) {
        h += '<div class="small">n <span class="num">' + esc(bt.n_full) + '</span> · full-sample ATS <span class="num">' + pct(bt.full_ats_pct) + '</span> · ' +
          windowsHtml(bt.windows) + (bt.recent_n_combined != null ? ' · recent n <span class="num">' + esc(bt.recent_n_combined) + '</span>' : '') +
          (bt.flipped_vs_full_sample ? ' · <span class="pill watch">flipped vs full sample</span>' : '') + '</div>';
      }
      if (a.not_wired_reason) h += '<div class="small muted">Not wired: ' + esc(a.not_wired_reason) + '</div>';
      return h + '</div>';
    }).join('');
  }
  function bindAngleFilter(lib) {
    var btns = document.querySelectorAll('.filter .btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function (ev) {
        state.angleFilter = ev.currentTarget.getAttribute('data-f');
        var bar = document.querySelector('.filter');
        if (bar) bar.outerHTML = angleFilterBar(lib);
        var list = document.getElementById('angle-list');
        if (list) list.innerHTML = angleList(lib);
        bindAngleFilter(lib);
      });
    }
  }

  // ------------------------------------------------------------ router
  function route() {
    var h = location.hash || '#/dashboard';
    var parts = h.replace(/^#\/?/, '').split('/').filter(Boolean);
    var page = parts[0] || 'dashboard';
    if (page === 'dashboard') return viewDashboard();
    if (page === 'weeks') return viewWeeks(parts[1] || null, parts[2] || null);
    if (page === 'appendix') return viewAppendix(parts[1] || null);
    location.replace('#/dashboard');
  }

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  Promise.all([fetchJSON('data/manifest.json'), fetchJSON('data/angles.json').catch(function () { return { angles: [] }; })])
    .then(function (res) {
      state.manifest = res[0];
      state.angles = res[1];
      headerFromLatest();
      window.addEventListener('hashchange', route);
      route();
    })
    .catch(function (err) {
      $updated.textContent = 'Data unavailable';
      fail(err);
    });
})();
