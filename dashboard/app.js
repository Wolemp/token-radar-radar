// Token Radar's page. It reads window.RADAR (data.js, written by main.ts from the same board as
// board.json), and draws four views: the ranked Radar, the Token live set, the Set aside pile and the
// Model. Every number on screen is in the data; nothing is fetched. impliedOf() recomputes a row's value
// from the snapshot figures so the page's arithmetic and the board's are visibly the same.
(function () {
  'use strict';

  var D = window.RADAR;
  var app = document.getElementById('app');
  if (!D) { app.textContent = 'data.js did not load: run main.ts to write it beside this folder.'; return; }
  var R = D.rows;
  var byslug = {};
  R.forEach(function (r) { byslug[r.slug] = r; });

  var DEFAULTS = { tab: 'radar', q: '', cat: 'all', chain: 'all', scope: 'all', win: 'all', tvl: 0, sort: 'implied', dir: -1, share: Math.round(D.model.airdrop_share * 100), reason: 'all', sel: R.length ? R[0].slug : null };
  var state = Object.assign({}, DEFAULTS);
  var open = false;
  var ui = {};

  // ---------- formatting ----------
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e4) return s + '$' + Math.round(a / 1e3) + 'K';
    if (a >= 100) return s + '$' + Math.round(a).toLocaleString('en-US');
    return s + '$' + a.toFixed(2);
  }
  function pct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function ageText(d) { return d === null || d === undefined ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function signed(n) { return (n >= 0 ? '+' : '') + n.toFixed(2); }

  // ---------- the model, in the page ----------
  function impliedOf(r) { return Math.max(1, Math.round(r.tvl_usd * r.peer_multiple * r.growth_multiplier * r.maturity_multiplier)); }
  // An illustrative airdrop: `share` of the implied value paid to depositors pro rata to TVL.
  function payoutFor(r, stake) { return stake / r.tvl_usd * (state.share / 100) * r.implied_value_usd; }

  // ---------- small DOM helper ----------
  function h(tag, props) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }
  function add(node, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(node, x); });
    else node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ---------- hash state: a view can be shared as a link ----------
  var HASH = [['t', 'tab'], ['q', 'q'], ['c', 'cat'], ['n', 'chain'], ['s', 'scope'], ['w', 'win'], ['v', 'tvl'], ['o', 'sort'], ['d', 'dir'], ['a', 'share'], ['r', 'reason'], ['p', 'sel']];
  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    HASH.forEach(function (pair) {
      var v = params.get(pair[0]);
      if (v === null) return;
      var key = pair[1];
      state[key] = typeof DEFAULTS[key] === 'number' ? Number(v) || DEFAULTS[key] : v;
    });
    if (state.sel && !byslug[state.sel]) state.sel = R.length ? R[0].slug : null;
    if (['radar', 'live', 'aside', 'model'].indexOf(state.tab) < 0) state.tab = 'radar';
    open = params.get('p') !== null && window.innerWidth <= 1180;
  }
  function writeHash() {
    var params = new URLSearchParams();
    HASH.forEach(function (pair) {
      var v = state[pair[1]];
      if (v !== DEFAULTS[pair[1]] && v !== null) params.set(pair[0], String(v));
    });
    var next = params.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // ---------- the radar: filter, sort, rows ----------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return R.filter(function (r) {
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.scope !== 'all' && r.scope !== state.scope) return false;
      if (state.win !== 'all' && r.window !== state.win) return false;
      if (r.tvl_usd < state.tvl) return false;
      return !q || [r.name, r.slug, r.category, r.chains.join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  var SORTS = {
    implied: ['Implied value', function (r) { return r.implied_value_usd; }],
    per100: ['Airdrop per $100', function (r) { return payoutFor(r, 100); }],
    tvl: ['TVL', function (r) { return r.tvl_usd; }],
    growth: ['7-day TVL change', function (r) { return r.change_7d === null ? -Infinity : r.change_7d; }],
    age: ['Age (youngest first)', function (r) { return r.age_days === null ? -Infinity : -r.age_days; }],
    name: ['Name', function (r) { return r.name.toLowerCase(); }]
  };
  function sorted(list) {
    var f = SORTS[state.sort][1];
    return list.slice().sort(function (a, b) {
      var x = f(a), y = f(b);
      if (x < y) return -state.dir;
      if (x > y) return state.dir;
      return a.rank - b.rank;
    });
  }
  function sortHead(key, label, cls) {
    var on = state.sort === key;
    return h('th', { scope: 'col', class: cls, 'aria-sort': on ? (state.dir < 0 ? 'descending' : 'ascending') : null },
      h('button', { type: 'button', onclick: function () { if (on) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } syncSort(); changed(); } },
        label + (on ? (state.dir < 0 ? ' ↓' : ' ↑') : '')));
  }

  function boardRow(r, top) {
    var imp = h('div', { class: 'imp' },
      h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(2, Math.round(r.implied_value_usd / top * 100)) + '%' })),
      h('b', { class: 'num', text: money(r.implied_value_usd) }));
    var tr = h('tr', { tabindex: '0', 'aria-selected': state.sel === r.slug ? 'true' : 'false', onclick: function () { select(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.slug); } } },
      h('td', { class: 'num c-rank', text: String(r.rank) }),
      h('td', { class: 'c-nm' }, h('div', { class: 'nm' },
        h('span', { class: 'rk', text: '#' + r.rank }), h('b', { text: r.name }),
        r.scope === 'watchlist' ? h('span', { class: 'badge wl', text: 'watchlist' }) : null,
        h('div', { class: 'sub', text: (r.category || 'Other') + ' · ' + r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }))),
      h('td', { class: 'num r c-tvl', 'data-l': 'TVL', text: money(r.tvl_usd) }),
      h('td', { class: 'num r c-g ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), 'data-l': '7d', text: pct(r.change_7d) }),
      h('td', { class: 'num r c-age', 'data-l': 'Age', text: ageText(r.age_days) }),
      h('td', { class: 'r c-imp' }, imp),
      h('td', { class: 'num r c-per', 'data-l': 'Per $100', text: money(payoutFor(r, 100)) }));
    return tr;
  }
  function boardTable(list) {
    if (!list.length) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' }, h('h2', { text: 'No protocol matches these filters' }),
        h('p', { text: 'Loosen the search, the category or the minimum TVL.' }),
        h('button', { class: 'btn', type: 'button', text: 'Reset filters', onclick: resetFilters })));
    }
    var top = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; }));
    return h('div', { class: 'panel' }, h('div', { class: 'wrap' }, h('table', { class: 'board' },
      h('caption', { text: 'Protocols that record no token. Rank is by implied value whatever the sort. Select a row for its value build-up and farm plan.' }),
      h('thead', null, h('tr', null, sortHead('implied', 'Rank', ''), sortHead('name', 'Protocol', ''), sortHead('tvl', 'TVL', 'r'), sortHead('growth', '7d', 'r'), sortHead('age', 'Age', 'r'), h('th', { scope: 'col', class: 'r', text: 'Implied value' }), sortHead('per100', 'Per $100', 'r'))),
      h('tbody', null, list.map(function (r) { return boardRow(r, top); })))));
  }

  // ---------- the detail: value build-up, airdrop check, farm plan ----------
  function kv(rows) {
    var dl = h('dl', { class: 'kv' });
    rows.forEach(function (x) { dl.appendChild(h('dt', { text: x[0] })); dl.appendChild(h('dd', { class: x[2] || '', text: x[1] })); });
    return dl;
  }
  function factor(label, value, why) {
    return h('div', null, h('span', { class: 'k', text: label }), h('b', { text: value }), h('span', { class: 'sub', text: why }));
  }
  function detailNode(r) {
    var o = D.fit.offsets[r.category || 'Other'];
    var recomputed = impliedOf(r);
    var stakeGet = payoutFor(r, r.farm_capital_usd);
    var net = stakeGet - r.farm_gas_usd;
    var head = h('div', { class: 'dh' },
      h('button', { class: 'btn back', type: 'button', text: '← Back to the board', onclick: closeDetail }),
      h('span', { class: 'rk', text: 'RANK ' + r.rank + ' OF ' + R.length + (r.scope === 'watchlist' ? ' · WATCHLIST' : ' · EARLY RADAR') }),
      h('h2', { id: 'dt', text: r.name }),
      h('p', { class: 'sub', text: (r.category || 'Other') + ' · ' + r.chains.slice(0, 4).join(', ') + (r.chains.length > 4 ? ' and ' + (r.chains.length - 4) + ' more' : '') + ' · tracked ' + (r.listed_at ? 'since ' + r.listed_at : 'with no listing date') }),
      h('div', { class: 'big', text: money(r.implied_value_usd) }),
      h('p', { class: 'range', text: 'Plausible range ' + money(r.implied_low_usd) + ' to ' + money(r.implied_high_usd) + ': the middle half of the peer fit’s errors. Implied value is a claim of this radar, not a price.' }));
    var build = h('section', { class: 'sec' }, h('h3', { text: 'How the value is built' }),
      h('div', { class: 'eq' },
        factor('TVL', money(r.tvl_usd), 'DefiLlama, snapshot of ' + D.as_of + '.'),
        factor('× Peer multiple', r.peer_multiple.toFixed(3), 'Market cap per $1 of TVL for tokened peers of this size (fit slope ' + D.fit.slope + '). ' + (o ? r.category + ': ' + o.peers + (o.peers === 1 ? ' peer' : ' peers') + ', offset ' + signed(o.offset) + '.' : 'No peer in its category: size alone sets it.')),
        factor('× Growth', r.growth_multiplier.toFixed(4), 'TVL ' + pct(r.change_7d) + ' in 7 days, clamped to ' + D.model.growth_floor + '..' + D.model.growth_cap + ', weight ' + D.model.growth_weight + '.'),
        factor('× Maturity', r.maturity_multiplier.toFixed(4), r.age_days === null ? 'No listing date: the neutral ' + D.model.unknown_maturity + '.' : 'Tracked ' + r.age_days + ' days; full credit at ' + D.model.maturity_days + '.'),
        factor('= Implied value', money(r.implied_value_usd), 'Page recomputes $' + recomputed.toLocaleString('en-US') + (recomputed === r.implied_value_usd ? ' ✓ board.json agrees.' : ': board.json differs.'))));
    var airdrop = h('section', { class: 'sec' }, h('h3', { text: 'If it airdrops (' + state.share + '% of implied value, pro rata to TVL)' }),
      kv([['$100 deposited', money(payoutFor(r, 100))], ['Plan stake ' + money(r.farm_capital_usd), money(stakeGet)], ['Gas over the window', money(r.farm_gas_usd)], ['Net of gas', (net < 0 ? '-' : '+') + money(Math.abs(net)), net < 0 ? 'neg' : 'pos']]),
      h('p', { class: 'note', text: 'Illustrative only. Real programs weight time, activity and wallets, and may never come. Move the share in the filter bar to see how little or much it takes.' }));
    var plan = h('section', { class: 'sec' }, h('h3', { text: 'Farm plan' }),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, 'Chain ', h('b', { text: r.farm_chain })), h('span', { class: 'chip' }, 'Stake ', h('b', { text: money(r.farm_capital_usd) })),
        h('span', { class: 'chip' }, 'Gas ', h('b', { text: money(r.farm_gas_usd) })), h('span', { class: 'chip' }, 'Window ', h('b', { text: r.farm_days + ' days' }))),
      h('ol', { class: 'steps' }, r.plan.map(function (s) {
        return h('li', null, h('div', { text: s.text }), h('div', { class: 'chips' }, h('span', { class: 'chip' }, 'Cost ', h('b', { text: s.cost })), h('span', { class: 'chip' }, 'Time ', h('b', { text: s.time }))));
      })));
    var notes = h('section', { class: 'sec' }, h('h3', { text: 'Data notes' }),
      r.flags.map(function (f) { return h('p', { class: 'note', text: f.charAt(0).toUpperCase() + f.slice(1) + '.' }); }),
      h('p', { class: 'sub', text: 'The snapshot records no token for ' + r.name + '; a token its record does not carry may still exist. This radar says nothing on whether or when one is issued. Gas and ticket sizes are planning figures: check live gas first.' }));
    return [head, build, plan, airdrop, notes];
  }
  function showDetail() {
    var r = state.sel ? byslug[state.sel] : null;
    ui.detail.textContent = '';
    if (r) add(ui.detail, detailNode(r));
    ui.detail.scrollTop = 0;
    ui.detail.classList.toggle('open', open);
    ui.scrim.classList.toggle('open', open);
  }
  function select(slug) {
    state.sel = slug;
    open = window.innerWidth <= 1180;
    writeHash();
    updateRadar();
    showDetail();
    if (open) ui.detail.focus();
  }
  function closeDetail() { open = false; ui.detail.classList.remove('open'); ui.scrim.classList.remove('open'); }

  // ---------- radar view ----------
  function field(label, control, id) { return h('div', { class: 'field' }, h('label', { for: id, text: label }), control); }
  function select_(id, options, value, onchange) {
    var s = h('select', { id: id }, options.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
    s.value = String(value);
    s.addEventListener('change', function () { onchange(s.value); });
    return s;
  }
  function countBy(fn) {
    var m = {};
    R.forEach(function (r) { fn(r).forEach(function (k) { m[k] = (m[k] || 0) + 1; }); });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a] || (a < b ? -1 : 1); }).map(function (k) { return [k, m[k]]; });
  }
  function resetFilters() { ['q', 'cat', 'chain', 'scope', 'win', 'tvl', 'sort', 'dir'].forEach(function (k) { state[k] = DEFAULTS[k]; }); showTab(); }
  function changed() { writeHash(); updateRadar(); }
  function syncSort() { if (ui.sort) ui.sort.value = state.sort; }

  function radarView() {
    var total = R.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
    var C = D.counts;
    var hero = h('section', { class: 'hero' },
      h('div', null, h('h1', { text: C.ranked + ' protocols record no token. Here is what one would be worth.' }),
        h('p', { text: 'Implied value = TVL × a peer multiple fitted on ' + D.fit.peers + ' protocols whose token trades × seven-day growth × how long it has run. The watchlist (TVL of ' + money(D.floor_usd) + ' or more) is the floor; the radar adds ' + C.early + ' smaller pre-token protocols. ' + C.live + ' that record a token are kept apart.' })),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', { text: C.watchlist + ' / ' + C.watchlist }), h('span', { text: 'watchlist protocols covered' })),
        h('div', { class: 'stat' }, h('b', { text: String(C.early) }), h('span', { text: 'early rows below the floor' })),
        h('div', { class: 'stat amber' }, h('b', { text: money(total) }), h('span', { text: 'sum of the implied values' })),
        h('div', { class: 'stat' }, h('b', { text: String(C.live) }), h('span', { text: 'token already recorded, set apart' }))));
    var q = h('input', { type: 'search', id: 'q', placeholder: 'Name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    q.addEventListener('input', function () { state.q = q.value; changed(); });
    var seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Scope' }, [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early']].map(function (o) {
      return h('button', { type: 'button', 'data-v': o[0], 'aria-pressed': String(state.scope === o[0]), text: o[1], onclick: function () {
        state.scope = o[0]; seg.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === o[0])); }); changed(); } });
    }));
    var cats = countBy(function (r) { return [r.category || 'Other']; });
    var chains = countBy(function (r) { return r.chains; }).slice(0, 24);
    ui.sort = select_('sort', Object.keys(SORTS).map(function (k) { return [k, SORTS[k][0]]; }), state.sort, function (v) { state.sort = v; state.dir = v === 'name' ? 1 : -1; changed(); });
    var slider = h('input', { type: 'range', id: 'share', min: '1', max: '20', step: '1', value: String(state.share), 'aria-label': 'Assumed airdrop share of implied value' });
    var out = h('output', { for: 'share', text: state.share + '%' });
    slider.addEventListener('input', function () { state.share = Number(slider.value); out.textContent = state.share + '%'; writeHash(); updateRadar(); showDetailKeep(); });
    var controls = h('section', { class: 'controls', 'aria-label': 'Filters' },
      field('Search', q, 'q'),
      field('Category', select_('cat', [['all', 'All categories']].concat(cats.map(function (c) { return [c[0], c[0] + ' (' + c[1] + ')']; })), state.cat, function (v) { state.cat = v; changed(); }), 'cat'),
      field('Chain', select_('chain', [['all', 'Any chain']].concat(chains.map(function (c) { return [c[0], c[0] + ' (' + c[1] + ')']; })), state.chain, function (v) { state.chain = v; changed(); }), 'chain'),
      h('div', { class: 'field full' }, h('span', { class: 'lab', text: 'Scope' }), seg),
      field('Farm window', select_('win', [['all', 'Any age'], ['new', 'New, under 6 months'], ['established', 'Established, to 2 years'], ['long-running', 'Long-running, 2 years+'], ['unknown', 'Age unknown']], state.win, function (v) { state.win = v; changed(); }), 'win'),
      field('Minimum TVL', select_('tvl', [[0, 'Any TVL'], [10e6, '$10M+'], [50e6, '$50M+'], [100e6, '$100M+'], [500e6, '$500M+']], state.tvl, function (v) { state.tvl = Number(v); changed(); }), 'tvl'),
      field('Sort by', ui.sort, 'sort'),
      h('div', { class: 'field full' }, h('label', { for: 'share', text: 'Airdrop share assumed' }), h('div', { class: 'share' }, slider, out)),
      h('button', { class: 'reset', type: 'button', text: 'Reset', onclick: resetFilters }));
    ui.count = h('p', { class: 'count', 'aria-live': 'polite' });
    ui.list = h('div');
    ui.detail = h('aside', { class: 'panel detail', 'aria-labelledby': 'dt', tabindex: '-1' });
    ui.scrim = h('div', { class: 'scrim', onclick: closeDetail });
    var view = h('div', null, hero, controls, ui.count, h('div', { class: 'split' }, ui.list, ui.detail), ui.scrim);
    return view;
  }
  function showDetailKeep() { var keep = ui.detail.scrollTop; showDetail(); ui.detail.scrollTop = keep; }
  function updateRadar() {
    var list = sorted(filtered());
    ui.count.textContent = list.length + ' of ' + R.length + ' protocols shown' + (state.sort !== 'implied' || state.dir > 0 ? ', sorted by ' + SORTS[state.sort][0].toLowerCase() : ', by implied value');
    ui.list.textContent = '';
    ui.list.appendChild(boardTable(list));
  }

  // ---------- a plain table for the live and set-aside views ----------
  var side = { live: { k: 'mcap', d: -1 }, aside: { k: 'tvl', d: -1 } };
  function sideView(kind) {
    var rows = kind === 'live' ? D.live : D.aside;
    var cols = kind === 'live'
      ? [['name', 'Protocol'], ['tvl', 'TVL', 'r'], ['chg', '7d', 'r'], ['mcap', 'Market cap', 'r'], ['ratio', 'Mcap / TVL', 'r'], ['sym', 'Token']]
      : [['name', 'Protocol'], ['cat', 'Category'], ['tvl', 'TVL', 'r'], ['reason', 'Why it is set aside']];
    var get = { name: function (r) { return r.name.toLowerCase(); }, tvl: function (r) { return r.tvl_usd; }, chg: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      mcap: function (r) { return r.mcap_usd === null ? -1 : r.mcap_usd; }, ratio: function (r) { return r.mcap_usd === null ? -1 : r.mcap_usd / r.tvl_usd; },
      sym: function (r) { return r.symbol || ''; }, cat: function (r) { return r.category || ''; }, reason: function (r) { return r.reason; } };
    var s = side[kind];
    var box = h('div', null);
    var body = h('div', { class: 'panel' });
    var q = h('input', { type: 'search', placeholder: 'Search name, category or chain', 'aria-label': 'Search this list', value: state.q });
    q.addEventListener('input', function () { state.q = q.value; writeHash(); draw(); });
    var reasons = {};
    rows.forEach(function (r) { reasons[r.reason] = (reasons[r.reason] || 0) + 1; });
    function draw() {
      var needle = state.q.trim().toLowerCase();
      var list = rows.filter(function (r) {
        if (kind === 'aside' && state.reason !== 'all' && r.reason !== state.reason) return false;
        return !needle || [r.name, r.slug, r.category, r.chains.join(' '), r.symbol || ''].join(' ').toLowerCase().indexOf(needle) >= 0;
      });
      list.sort(function (a, b) { var x = get[s.k](a), y = get[s.k](b); return x < y ? -s.d : x > y ? s.d : (a.slug < b.slug ? -1 : 1); });
      body.textContent = '';
      if (kind === 'aside') {
        body.appendChild(h('div', { class: 'reasons' }, [['all', 'All ' + rows.length]].concat(Object.keys(reasons).sort(function (a, b) { return reasons[b] - reasons[a]; }).map(function (k) { return [k, k.split(':')[0] + ' ' + reasons[k]]; })).map(function (o) {
          return h('button', { type: 'button', 'aria-pressed': String(state.reason === o[0]), text: o[1], onclick: function () { state.reason = o[0]; writeHash(); draw(); } });
        })));
      }
      var head = h('tr', null, cols.map(function (c) {
        var on = s.k === c[0];
        return h('th', { scope: 'col', class: c[2] || '', 'aria-sort': on ? (s.d < 0 ? 'descending' : 'ascending') : null },
          h('button', { type: 'button', text: c[1] + (on ? (s.d < 0 ? ' ↓' : ' ↑') : ''), onclick: function () { if (on) s.d = -s.d; else { s.k = c[0]; s.d = c[0] === 'name' ? 1 : -1; } draw(); } }));
      }));
      var rowsNode = list.slice(0, 500).map(function (r) {
        var tds = kind === 'live'
          ? [h('td', null, h('b', { text: r.name }), h('div', { class: 'sub', text: (r.category || 'Other') + ' · ' + r.chains.slice(0, 2).join(', ') })), h('td', { class: 'num r', text: money(r.tvl_usd) }),
            h('td', { class: 'num r ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }), h('td', { class: 'num r', text: r.mcap_usd === null ? 'no market cap' : money(r.mcap_usd) }),
            h('td', { class: 'num r', text: r.mcap_usd === null ? 'n/a' : (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' }), h('td', { class: 'num', text: r.symbol || 'n/a' })]
          : [h('td', null, h('b', { text: r.name }), h('div', { class: 'sub', text: r.chains.slice(0, 2).join(', ') })), h('td', { text: r.category || 'Other' }), h('td', { class: 'num r', text: money(r.tvl_usd) }), h('td', { class: 'sub', text: r.reason })];
        return h('tr', { style: 'cursor:default' }, tds);
      });
      body.appendChild(h('div', { class: 'wrap' }, h('table', null,
        h('caption', { text: list.length + ' of ' + rows.length + (kind === 'live' ? ' protocols already record a token; the market prices them, so the radar does not. They are the peers the value model learns from.' : ' protocols are kept off the ranked board, each with its reason.') }),
        h('thead', null, head), h('tbody', null, rowsNode))));
    }
    var intro = kind === 'live'
      ? [h('h1', { text: D.counts.live + ' protocols already record a token' }), h('p', { text: D.counts.live_with_mcap + ' carry a market cap, the market’s own value; the rest record a token with no market cap, usually a child of a parent token. None of them is ranked: a token that exists is not one still to come.' })]
      : [h('h1', { text: D.counts.set_aside + ' protocols the radar leaves unranked' }), h('p', { text: 'Exchanges, bridged, staked and wrapped products, versions of another protocol, and pre-token protocols above the floor that DefiLlama counts under a parent. Their TVL belongs to something else.' })];
    box.appendChild(h('section', { class: 'hero', style: 'grid-template-columns:1fr' }, h('div', null, intro)));
    box.appendChild(h('section', { class: 'controls' }, h('div', { class: 'field' }, h('label', { text: 'Search' }), q)));
    box.appendChild(h('div', { style: 'height:12px' }));
    box.appendChild(body);
    draw();
    return box;
  }

  // ---------- the model: the fit, drawn, and the rules ----------
  function scatter() {
    var W = 720, H = 380, m = { l: 58, r: 16, t: 34, b: 42 };
    var tv = D.peers.map(function (p) { return p.tvl_usd; }).concat(R.map(function (r) { return r.tvl_usd; }));
    var lx = function (v) { return Math.log10(v); };
    var x0 = Math.floor(lx(Math.min.apply(null, tv)) * 2) / 2, x1 = Math.ceil(lx(Math.max.apply(null, tv)) * 2) / 2;
    var ys = D.peers.map(function (p) { return lx(p.mcap_usd / p.tvl_usd); }).concat(R.map(function (r) { return lx(r.peer_multiple); }));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function px(x) { return m.l + (x - x0) / (x1 - x0) * (W - m.l - m.r); }
    function py(y) { return m.t + (y1 - y) / (y1 - y0) * (H - m.t - m.b); }
    var F = D.fit, ln10 = Math.LN10;
    function line(x, extra) { return (F.intercept + F.slope * x * ln10 + extra) / ln10; }
    // The chart is written as markup and parsed by the HTML parser, which places <svg> in its own namespace.
    var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log-log scatter of market cap per dollar of TVL against TVL for ' + F.peers + ' protocols whose token trades, with the fitted line and the radar rows placed on it">';
    for (var x = Math.ceil(x0); x <= x1; x++) {
      s += '<line x1="' + px(x) + '" x2="' + px(x) + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="#243631"/>';
      s += '<text x="' + px(x) + '" y="' + (H - m.b + 16) + '" text-anchor="middle">' + money(Math.pow(10, x)) + '</text>';
    }
    for (var y = y0; y <= y1; y++) {
      s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + py(y) + '" y2="' + py(y) + '" stroke="#243631"/>';
      s += '<text x="' + (m.l - 8) + '" y="' + (py(y) + 4) + '" text-anchor="end">' + Math.pow(10, y) + '×</text>';
    }
    s += '<text x="' + W / 2 + '" y="' + (H - 6) + '" text-anchor="middle">TVL, log scale</text>';
    s += '<text x="12" y="16">market cap per $1 of TVL</text>';
    s += '<path d="M' + px(x0) + ',' + py(line(x0, F.q75)) + ' L' + px(x1) + ',' + py(line(x1, F.q75)) + ' L' + px(x1) + ',' + py(line(x1, F.q25)) + ' L' + px(x0) + ',' + py(line(x0, F.q25)) + ' Z" fill="#f0b84a" fill-opacity="0.13"/>';
    s += '<line x1="' + px(x0) + '" y1="' + py(line(x0, 0)) + '" x2="' + px(x1) + '" y2="' + py(line(x1, 0)) + '" stroke="#f0b84a" stroke-width="2"/>';
    D.peers.forEach(function (p) {
      s += '<circle cx="' + px(lx(p.tvl_usd)).toFixed(1) + '" cy="' + py(lx(p.mcap_usd / p.tvl_usd)).toFixed(1) + '" r="3.2" fill="#4fd1a5" fill-opacity="0.7"><title>' + esc(p.name + ': ' + money(p.tvl_usd) + ' TVL, ' + money(p.mcap_usd) + ' market cap') + '</title></circle>';
    });
    R.forEach(function (r) {
      var on = r.slug === state.sel;
      s += '<circle cx="' + px(lx(r.tvl_usd)).toFixed(1) + '" cy="' + py(lx(r.peer_multiple)).toFixed(1) + '" r="' + (on ? 6 : 2.6) + '" fill="' + (on ? '#ffffff' : '#ff8070') + '"' + (on ? ' stroke="#ff8070" stroke-width="2"' : '') + '><title>' + esc(r.name + ': ' + money(r.tvl_usd) + ' TVL, multiple ' + r.peer_multiple.toFixed(3)) + '</title></circle>';
    });
    var box = h('div');
    box.innerHTML = s + '</svg>';
    return box;
  }
  function modelView() {
    var F = D.fit, M = D.model;
    var used = countBy(function (r) { return [r.category || 'Other']; });
    var at100 = function (o) { return Math.exp(F.intercept + F.slope * Math.log(1e8) + o).toFixed(3) + '×'; };
    return h('div', { class: 'model' },
      h('section', { class: 'panel' }, h('h1', { text: 'How implied value is computed' }),
        h('p', { class: 'sub', text: 'One function scores every row; no protocol name is special-cased, and no figure is typed in by hand.' }),
        h('div', { class: 'formula' }, 'implied = tvl × peer_multiple × growth × maturity', h('br'),
          'peer_multiple = exp(' + F.intercept + ' ' + (F.slope < 0 ? '- ' + Math.abs(F.slope) : '+ ' + F.slope) + ' × ln(tvl) + category offset), kept within ' + M.multiple_floor + ' and ' + M.multiple_cap, h('br'),
          'growth = 1 + clamp(change_7d, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 × ' + M.growth_weight, h('br'),
          'maturity = ' + M.maturity_floor + ' + ' + M.maturity_range + ' × min(age_days, ' + M.maturity_days + ') / ' + M.maturity_days + '  (age unknown: ' + M.unknown_maturity + ')')),
      h('div', { class: 'two' },
        h('section', { class: 'panel' }, h('h2', { text: 'What the market pays per dollar of TVL' }),
          h('p', { class: 'sub', text: 'Each teal dot is a protocol whose token trades. Bigger protocols are priced lower per dollar of TVL, so a flat multiple would overvalue the largest names. The amber line is the fit, its band the middle half of the errors; coral dots are the radar’s rows on that line.' }),
          scatter(),
          h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:#4fd1a5' }), F.peers + ' live peers'), h('span', null, h('i', { style: 'background:#f0b84a' }), 'fit, slope ' + F.slope), h('span', null, h('i', { style: 'background:#ff8070' }), R.length + ' radar rows'))),
        h('section', { class: 'panel' }, h('h2', { text: 'Category offsets' }),
          h('p', { class: 'sub', text: 'A category’s offset is its live peers’ mean error, shrunk toward zero by n / (n + ' + M.category_shrink + '); with no peer it is zero and size alone sets the multiple. The last column is the multiple at $100M of TVL.' }),
          h('div', { class: 'wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', { text: 'Radar category' }), h('th', { class: 'r', text: 'Rows' }), h('th', { class: 'r', text: 'Peers' }), h('th', { class: 'r', text: 'Offset' }), h('th', { class: 'r', text: 'At $100M' }))),
            h('tbody', null, used.slice(0, 14).map(function (u) { var o = F.offsets[u[0]] || { peers: 0, offset: 0 }; return h('tr', { style: 'cursor:default' }, h('td', { text: u[0] }), h('td', { class: 'num r', text: String(u[1]) }), h('td', { class: 'num r', text: String(o.peers) }), h('td', { class: 'num r', text: signed(o.offset) }), h('td', { class: 'num r', text: at100(o.offset) })); })))))),
      h('section', { class: 'panel' }, h('h2', { text: 'What the radar does and does not claim' }),
        h('ul', null,
          h('li', null, h('b', { text: 'Ranked: ' }), 'every protocol that records no token and is not an exchange, a bridged, staked or wrapped product, or a version of another. The watchlist is always on the board; so are ' + D.counts.early + ' smaller protocols below its floor.'),
          h('li', null, h('b', { text: 'Apart: ' }), D.counts.live + ' protocols record a token. Their market cap is the market’s own value, so they feed the fit and are never ranked. ' + D.counts.set_aside + ' more are set aside, each with its reason.'),
          h('li', null, h('b', { text: 'Age: ' }), 'DefiLlama’s listing day is the earliest sign of when a protocol began, so it is a floor on how long it has run with no token.'),
          h('li', null, h('b', { text: 'Not claimed: ' }), 'whether or when a token is issued, its price, or any airdrop. A protocol on the list may have a token its DefiLlama record does not carry.'),
          h('li', null, h('b', { text: 'Farm plans: ' }), 'derived from category, chains, TVL and age. Gas and ticket sizes are planning figures, not snapshot data. Source: the DefiLlama protocol list, fetched ' + D.fetched_at + '.'))));
  }

  // ---------- shell, tabs ----------
  var TABS = [['radar', 'Radar', function () { return R.length; }], ['live', 'Token live', function () { return D.counts.live; }], ['aside', 'Set aside', function () { return D.counts.set_aside; }], ['model', 'Model', null]];
  function showTab() {
    ui.view.textContent = '';
    if (state.tab === 'radar') {
      ui.view.appendChild(radarView());
      updateRadar();
      showDetail();
    } else ui.view.appendChild(state.tab === 'model' ? modelView() : sideView(state.tab));
    ui.tabs.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-t') === state.tab)); });
    writeHash();
  }
  function build() {
    ui.tabs = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' }, TABS.map(function (t) {
      return h('button', { type: 'button', role: 'tab', 'data-t': t[0], onclick: function () { state.tab = t[0]; open = false; showTab(); } }, t[1], t[2] ? h('span', { class: 'n', text: String(t[2]()) }) : null);
    }));
    ui.view = h('main', { id: 'view', tabindex: '-1' });
    app.textContent = '';
    app.appendChild(h('div', { class: 'shell' },
      h('header', { class: 'top' }, h('div', { class: 'brand' }, h('span', { class: 'dish', 'aria-hidden': 'true' }), 'Token Radar'), ui.tabs,
        h('div', { class: 'meta' }, h('span', { text: 'Snapshot ' + D.as_of }), h('span', { text: 'DefiLlama protocol index' }), h('span', { text: D.model_version }))),
      ui.view));
    app.setAttribute('aria-busy', 'false');
  }

  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) closeDetail(); });
  readHash();
  build();
  showTab();
})();
