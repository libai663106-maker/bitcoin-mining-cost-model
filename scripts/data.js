/* ==========================================================================
 * Reference data: ASIC catalogue, colours, formatting, token reader
 * ========================================================================== */
(function (root) {
  'use strict';

  /* ---- Design-token reader (SVG presentation attributes need computed values) ---- */
  var _tokCache = new Map();
  function tok(name, fallback) {
    var hit = _tokCache.get(name);
    if (hit) return hit;
    var v = '';
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) { }
    if (!v) v = fallback || 'currentColor';
    _tokCache.set(name, v);
    return v;
  }
  function dropTokCache() { _tokCache.clear(); }

  function alpha(token, pct) {
    return 'color-mix(in srgb,' + tok(token) + ' ' + pct + '%,transparent)';
  }

  /* ---- ASIC catalogue ----------------------------------------------------
   * Machine prices are indicative market levels per used/new unit (USD).
   * Users are expected to override with their own quote.
   * ----------------------------------------------------------------------- */
  var MINERS = [
    { key: 's23-305t', name: 'Antminer S23 305T', hashrate: 305, power: 3355, price: 7700, note: 'air-cooled' },
    { key: 's23-hyd', name: 'Antminer S23 Hyd', hashrate: 580, power: 5510, price: 14300, note: 'hydro' },
    { key: 's21xp', name: 'Antminer S21 XP', hashrate: 270, power: 3645, price: 8500, note: 'air-cooled' },
    { key: 's21xp-hyd', name: 'Antminer S21 XP Hyd', hashrate: 473, power: 5676, price: 16500, note: 'hydro' },
    { key: 's21e-hyd', name: 'Antminer S21e Hyd', hashrate: 385, power: 5000, price: 11000, note: 'hydro' },
    { key: 's21pro', name: 'Antminer S21 Pro', hashrate: 234, power: 3510, price: 4900, note: 'air-cooled' },
    { key: 'm60', name: 'WhatsMiner M60', hashrate: 196, power: 3400, price: 4000, note: 'air-cooled' },
    { key: 'm60s', name: 'WhatsMiner M60S', hashrate: 173, power: 3200, price: 3300, note: 'air-cooled' },
    { key: 'm63s-hyd', name: 'WhatsMiner M63S+ Hyd', hashrate: 508, power: 7130, price: 14000, note: 'hydro' },
    { key: 's19xp', name: 'Antminer S19 XP', hashrate: 140, power: 3010, price: 1500, note: 'air-cooled' },
    { key: 'a1566', name: 'Avalon A1566', hashrate: 185, power: 3420, price: 2600, note: 'air-cooled' },
    { key: 'custom', name: 'Custom / 自定义', hashrate: null, power: null, price: null, note: 'manual' }
  ];

  function findMiner(key) {
    for (var i = 0; i < MINERS.length; i++) if (MINERS[i].key === key) return MINERS[i];
    return null;
  }

  /* ---- default model inputs ----
     The single source of truth for "what the form starts at". engine.js carries
     the same numbers as its absent-input fallbacks — test_engine pins the two
     copies together, because a default that exists twice drifts the day one of
     them is edited. */
  var DEFAULTS = {
    minerKey: 's23-305t',
    hashrate: 305, power: 3355, machinePrice: 7700, lifeYears: 4,
    btcPrice: 86431,
    networkHashrateEhs: 957.97,
    blockSubsidy: 3.125,
    hashrateGrowthAnnual: 0.10,
    btcGrowthAnnual: 0.20,
    electricityPrice: 0.06,
    uptime: 0.95,
    poolFee: 0.01,
    exitPrice: 200000,
    blockHeight: 969947,
    nextHalvingHeight: 1050000,
    blocksPerHalving: 210000,
    months: 48,
    /* Rack date (ISO) anchors the calendar horizon. Left null here so the app
       can default it to "today" at boot rather than freezing a build date; a
       real value always travels in the share link. */
    rackDate: null
  };

  var ELECTRICITY_GRID = [0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.10];
  /* Sensitivity ladder for the matrix: six rungs, 10 points apart, starting at
     flat. Both axes carry the same list — the matrix is square, so the down axis
     (BTC growth) and the right axis (hashrate growth) can be read against each
     other cell by cell. They stay two arrays rather than one shared constant
     because they are two axes: the day the spec diverges them (hashrate growth
     capped below price growth, say) only one line moves.
     The ladder is independent of the form's defaults: the shipped default BTC
     growth is 20%, which happens to land on the fourth rung — a coincidence of
     two separate ladders, not a coupling. This is a grid of what-ifs; the form
     default may sit on a rung, between rungs, or off the end without changing
     the table. */
  var HASHRATE_GROWTH_GRID = [0, 0.10, 0.20, 0.30, 0.40, 0.50];
  var BTC_GROWTH_GRID = [0, 0.10, 0.20, 0.30, 0.40, 0.50];

  /* ---- formatting ----
     Number formatting is locale-aware: English uses en-US grouping (2,000.00),
     Simplified and Traditional Chinese use zh-CN / zh-TW (2,000.00 as well, but
     the intent is explicit rather than accidental). Units stay in their ASCII
     form (W, TH/s, kWh) because that is what mining hardware and pools publish.
     The placeholder for "no value" is an em dash outside English so it does not
     read as a missed translation. */
  function L() { return (window.I18N && window.I18N.current) || 'en'; }
  function NA() { return L() === 'en' ? 'N/A' : '—'; }
  function num(v, o) { return Number(v).toLocaleString(L(), o); }

  function fmtUSD(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return NA();
    var d = dec === undefined ? 0 : dec;
    return '$' + num(v, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtUSDCompact(v) {
    if (v === null || !isFinite(v)) return NA();
    var a = Math.abs(v);
    if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return '$' + (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'k';
    return '$' + v.toFixed(0);
  }
  function fmtBTC(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return NA();
    var d = dec === undefined ? 8 : dec;
    return num(v, { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtSats(v) {
    if (v === null || !isFinite(v)) return NA();
    return num(Math.round(v * 1e8), { maximumFractionDigits: 0 });
  }
  function fmtPct(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return NA();
    return (v * 100).toFixed(dec === undefined ? 1 : dec) + '%';
  }
  function fmtPctSigned(v, dec) {
    if (v === null || !isFinite(v)) return NA();
    return (v >= 0 ? '+' : '') + (v * 100).toFixed(dec === undefined ? 1 : dec) + '%';
  }
  function fmtNum(v, dec) {
    if (v === null || v === undefined || !isFinite(v)) return NA();
    return num(v, { minimumFractionDigits: dec || 0, maximumFractionDigits: dec === undefined ? 2 : dec });
  }
  function fmtEH(v) {
    if (v === null || !isFinite(v)) return NA();
    return num(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  function fmtDays(d) {
    if (d === null || !isFinite(d)) return null;
    if (d < 400) return Math.round(d) + ' ' + tr('unit.days', 'days');
    return (d / 30.44).toFixed(1) + ' ' + tr('unit.months', 'months');
  }
  function agoText(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return tr('time.unknown', 'unknown');
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 90) return s + ' ' + tr('unit.secAgo', 'sec ago');
    if (s < 5400) return Math.round(s / 60) + ' ' + tr('unit.minAgo', 'min ago');
    if (s < 172800) return Math.round(s / 3600) + ' ' + tr('unit.hAgo', 'h ago');
    return Math.round(s / 86400) + ' ' + tr('unit.dAgo', 'd ago');
  }
  /** Word lookup that degrades to the English literal when the i18n table is
      not loaded — keeps the engine's Node unit tests working unchanged. */
  function tr(key, en) {
    var I = window.I18N;
    return (I && I.has(key)) ? I.t(key) : en;
  }

  root.AppData = {
    tok: tok, dropTokCache: dropTokCache, alpha: alpha,
    MINERS: MINERS, findMiner: findMiner, DEFAULTS: DEFAULTS,
    ELECTRICITY_GRID: ELECTRICITY_GRID,
    HASHRATE_GROWTH_GRID: HASHRATE_GROWTH_GRID,
    BTC_GROWTH_GRID: BTC_GROWTH_GRID,
    tr: tr,
    fmtUSD: fmtUSD, fmtUSDCompact: fmtUSDCompact, fmtBTC: fmtBTC, fmtSats: fmtSats,
    fmtPct: fmtPct, fmtPctSigned: fmtPctSigned, fmtNum: fmtNum, fmtEH: fmtEH,
    fmtDays: fmtDays, agoText: agoText
  };
}(window));
