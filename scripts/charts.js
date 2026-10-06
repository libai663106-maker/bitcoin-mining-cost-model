/* ==========================================================================
 * Inline SVG charts — hand-drawn, token-driven, zero CDN
 * ========================================================================== */
(function (root) {
  'use strict';
  var D = root.AppData;
  var tok = D.tok, alpha = D.alpha;

  /* Axis titles, tick words and tooltip lines are baked into the SVG string, so
     they have to be read at draw time. `T()` keeps the table optional — the
     headless Node chart probes load this file without i18n and still work. */
  function T(key, en) {
    var I = root.I18N;
    return (I && I.has(key)) ? I.t(key) : en;
  }

  /* A numbered noun is not spelled the same way in every locale ("Year 1" vs
     "第 1 年"), so the number is a token in a pattern held in the string table
     and `I18N` owns the substitution. Delegating to the module's own helpers
     rather than re-substituting here means the breakdown axis and the tooltip
     headings cannot drift from each other. The inline fallback keeps the
     headless Node chart probes working, which load this file without i18n. */
  function yearLabel(n) { return root.I18N ? root.I18N.yearLabel(n) : 'Year ' + n; }
  function monthLabel(n) { return root.I18N ? root.I18N.monthLabel(n) : 'Month ' + n; }

  /* ---------------- primitives ---------------- */
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** nice axis step: 1 / 1.5 / 2 / 2.5 / 5 / 10 × 10^n */
  function niceStep(raw) {
    if (!(raw > 0) || !isFinite(raw)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / p;
    var s = n <= 1 ? 1 : n <= 1.5 ? 1.5 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return s * p;
  }
  function niceScale(min, max, targetTicks) {
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (max === min) { max = min + Math.abs(min || 1) * 0.1; }
    var span = max - min;
    var step = niceStep(span / (targetTicks || 5));
    var lo = Math.floor(min / step) * step;
    var hi = Math.ceil(max / step) * step;
    if (hi === lo) hi = lo + step;
    /* Re-accumulating `v += step` drifts: 3 × 0.1 lands on 0.30000000000000004,
       which then fails the integer tests in fmtTick and prints "300.0m" next to
       honest "200m"/"100m" labels. Derive each tick from the index instead, and
       round to the step's own precision so the values stay exact. */
    var dp = Math.max(0, Math.min(12, Math.ceil(-Math.log10(step)) + 1));
    var n = Math.round((hi - lo) / step);
    var ticks = [];
    for (var i = 0; i <= n; i++) ticks.push(+(lo + i * step).toFixed(dp));
    return { lo: +lo.toFixed(dp), hi: +hi.toFixed(dp), step: step, ticks: ticks };
  }
  function fmtTick(v, kind) {
    if (kind === 'usd') {
      var a = Math.abs(v);
      if (a >= 1e6) return '$' + (v / 1e6).toFixed(a % 1e6 === 0 ? 0 : 1) + 'M';
      if (a >= 1000) return '$' + Math.round(v / 1000) + 'k';
      return '$' + (v % 1 === 0 ? v : v.toFixed(2));
    }
    if (kind === 'btc') {
      /* zero is an axis origin, not a quantity of millibitcoin — "0.00m" reads
         as noise on the baseline */
      if (v === 0) return '0';
      var m = v * 1e3;
      var am = Math.abs(m);
      if (am >= 1000) return (v).toFixed(v % 0.001 === 0 ? 2 : 3) + '';
      if (am >= 10) return m.toFixed(m % 1 === 0 ? 0 : 1) + 'm';
      if (am >= 1) return m.toFixed(m % 0.1 === 0 ? 0 : 1) + 'm';
      return m.toFixed(2) + 'm';
    }
    if (kind === 'pct') return (v * 100).toFixed(0) + '%';
    if (kind === 'ehs') return Math.round(v);
    if (kind === 'ratio') return v.toFixed(1) + 'x';
    return String(v);
  }
  function linePath(pts) {
    return pts.filter(function (p) {
      return p && isFinite(p[0]) && isFinite(p[1]);
    }).map(function (p, i) {
      return (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
    }).join(' ');
  }
  function hot(attrs, label, value, color) {
    return '<g class="hot" data-label="' + esc(label) + '" data-value="' + esc(value) + '" data-color="' + esc(color) + '">'
      + '<rect ' + attrs + ' fill="none" pointer-events="all"/></g>';
  }

  /* ---------------- generic frame ---------------- */
  /* b: the x-tick row sits at y1 + 20 and the axis caption baseline at H - 6.
     At b=40 (y1 = H - 40) those two rows were 1px apart and their descenders
     clipped into each other; the extra gutter keeps the caption clear. */
  var W = 1180, H = 380, PAD = { t: 22, r: 78, b: 48, l: 66 };
  /* half-width variant for charts that live in a 2-column grid: the same
     stroke widths and font sizes render at the intended size only when the
     viewBox width matches the real pixel width. */
  var W2 = 580, H2 = 330, PAD2 = { t: 20, r: 56, b: 46, l: 58 };

  /** guard: every accessor returns a finite number or the caller skips the point */
  function fin(v) { return typeof v === 'number' && isFinite(v); }

  function frame(opts) {
    var w = opts.w || W, h = opts.h || H, pd = opts.pad || PAD;
    var s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="' + esc(opts.aria || '') + '" preserveAspectRatio="xMidYMid meet">';
    s += '<defs>';
    s += '<clipPath id="' + opts.id + '-clip"><rect x="' + pd.l + '" y="' + pd.t + '" width="' + (w - pd.l - pd.r) + '" height="' + (h - pd.t - pd.b) + '"/></clipPath>';
    s += '</defs>';
    return s;
  }

  function gridY(sc, kind, x0, x1) {
    var s = '', i, y;
    for (i = 0; i < sc.ticks.length; i++) {
      y = 0; // computed by caller
    }
    return s;
  }

  /* ======================================================================
   * 1. SHUTDOWN PRICE
   * ====================================================================== */
  function chartPriceVsShutdown(res, cur, opts) {
    opts = opts || {};
    var id = 'c1';
    var rows = res.rows;
    var n = rows.length;
    var x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = H - PAD.b;

    /* Scaled to the shutdown curve ALONE. It used to share the axis with a BTC
       price line, which pinned the top of the scale several times above the
       data and squashed the one curve this chart exists to show. */
    var shut = [];
    for (var i = 0; i < n; i++) {
      if (rows[i].shutdownPrice !== null) shut.push(rows[i].shutdownPrice);
    }
    /* An empty range is a real state, not an error: with no output at all
       (zero hashrate, or zero uptime) every shutdown price is null. Guarded
       explicitly rather than left to niceScale's own isFinite rescue — that
       rescue keeps the output identical today (verified), so this is intent,
       not a fix, and it stops a future tidy-up of niceScale from silently
       breaking this chart. */
    var hasShut = shut.length > 0;
    var mn = hasShut ? Math.min.apply(null, shut) : 0;
    var mx = hasShut ? Math.max.apply(null, shut) : 1;
    var pad = (mx - mn) * 0.12 || mx * 0.1 || 1;
    var sc = niceScale(Math.max(0, mn - pad), mx + pad, 5);

    function X(i) { return x0 + (x1 - x0) * (n <= 1 ? 0 : i / (n - 1)); }
    function Y(v) { var d = sc.hi - sc.lo; if (!fin(v) || !fin(d) || Math.abs(d) < 1e-9) return NaN; var y = y1 - (y1 - y0) * ((v - sc.lo) / d); return (y < -1e5 || y > 1e5) ? NaN : y; }

    /* The aria-label names the region, so it is the panel's own title — the
       same source the other six charts use. Reading it off `cg.shutdown`
       looked equivalent but drifted in case ("Shutdown price" vs the panel's
       "Shutdown Price"), which is the sort of difference that only shows up
       when a screen reader and the heading disagree. */
    var s = frame({ id: id, aria: T('ch1.title','Shutdown Price') });

    /* grid + y labels */
    sc.ticks.forEach(function (t) {
      var y = Y(t);
      s += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="' + tok('--chart-grid') + '" stroke-width="1"/>';
      s += '<text x="' + (x0 - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + esc(fmtTick(t, 'usd')) + '</text>';
    });

    /* x labels — every 6 months + month 0 */
    var xt = [0];
    for (var k = 6; k <= n; k += 6) xt.push(k);
    xt.forEach(function (i) {
      var x = X(i);
      s += '<line x1="' + x.toFixed(1) + '" y1="' + y1 + '" x2="' + x.toFixed(1) + '" y2="' + (y1 + 5) + '" stroke="' + tok('--chart-grid') + '"/>';
      s += '<text x="' + x.toFixed(1) + '" y="' + (y1 + 20) + '" text-anchor="middle" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + (i === 0 ? T('cg.now','Now') : 'M' + i) + '</text>';
    });
    s += '<text x="' + ((x0 + x1) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" font-family="var(--f-sans)" fill="' + tok('--chart-axis') + '">' + esc(T('cg.months','Months from today')) + '</text>';

    /* shutdown price area (filled, under the line) — skips non-finite points */
    var shutPts = [];
    if (fin(rows[0].shutdownPrice)) shutPts.push([X(0), Y(rows[0].shutdownPrice)]);
    for (var j = 0; j < n; j++) if (fin(rows[j].shutdownPrice)) shutPts.push([X(j + 1), Y(rows[j].shutdownPrice)]);
    if (shutPts.length > 1) {
      s += '<path d="' + linePath(shutPts) + ' L' + shutPts[shutPts.length - 1][0].toFixed(2) + ' ' + y1 + ' L' + shutPts[0][0].toFixed(2) + ' ' + y1 + ' Z" fill="' + alpha('--chart-2', 12) + '" clip-path="url(#' + id + '-clip)"/>';
    }

    /* shutdown line — solid, because it is now the only plotted series and the
       legend swatch for it is solid. (It used to be dashed to stay distinct
       from a solid BTC price line that no longer exists.) Dashes are left to
       the halving marker, where the style means "annotation, not data". */
    s += '<path d="' + linePath(shutPts) + '" fill="none" stroke="' + tok('--chart-2') + '" stroke-width="2.2" stroke-linejoin="round" clip-path="url(#' + id + '-clip)"/>';

    /* endpoint — one series needs no slot juggling: park the label on the
       line's own end, clamped so the pill stays inside the plot area, and back
       it with a card-coloured pill so gridlines do not strike through it. */
    function endLabel(x, y, val, color) {
      var txt = D.fmtUSDCompact(val);
      var wtxt = (String(txt).length * 6.7 + 10).toFixed(0);
      var g = '<g>';
      g += '<rect x="' + (x - 5) + '" y="' + (y - 11).toFixed(1) + '" width="' + wtxt + '" height="16" rx="3" fill="' + tok('--card-bg') + '" opacity=".85"/>';
      g += '<text x="' + x + '" y="' + (y + 2).toFixed(1) + '" font-size="11.5" font-weight="700" font-family="var(--f-mono)" fill="' + color + '">' + esc(txt) + '</text>';
      g += '</g>';
      return g;
    }
    var lastS = shutPts[shutPts.length - 1];
    if (lastS && fin(lastS[1])) {
      var lyS = Math.min(Math.max(lastS[1], y0 + 10), y1 - 4);
      s += '<circle cx="' + lastS[0].toFixed(1) + '" cy="' + lastS[1].toFixed(1) + '" r="4.5" fill="' + tok('--chart-2') + '" stroke="' + tok('--card-bg') + '" stroke-width="2"/>';
      s += endLabel(x1 + 10, lyS + 4, rows[n - 1].shutdownPrice, tok('--chart-2'));
    }

    /* halving marker */
    if (res.summary.halvingMonth) {
      var hx = X(res.summary.halvingMonth);
      s += '<line x1="' + hx.toFixed(1) + '" y1="' + y0 + '" x2="' + hx.toFixed(1) + '" y2="' + y1 + '" stroke="' + tok('--chart-axis') + '" stroke-width="1" stroke-dasharray="3 4" opacity=".7"/>';
      s += '<text x="' + (hx + 6) + '" y="' + (y0 + 13) + '" font-size="10.5" font-weight="700" font-family="var(--f-sans)" fill="' + tok('--chart-axis') + '">' + esc(T('cg.halvingMark', 'HALVING')) + '</text>';
    }

    /* hover bands */
    var bw = (x1 - x0) / n;
    for (var h2 = 0; h2 < n; h2++) {
      var lx = X(h2 + 1);
      s += hot('x="' + (lx - bw / 2).toFixed(1) + '" y="' + y0 + '" width="' + bw.toFixed(2) + '" height="' + (y1 - y0) + '"',
        monthLabel(h2 + 1), T('cg.shutdown','Shutdown price') + ' ' + D.fmtUSD(rows[h2].shutdownPrice), tok('--chart-2'));
    }
    s += '</svg>';
    return s;
  }

  /* ======================================================================
   * 2. MINING COST / BTC (running actual cost per BTC, month by month)
   * ====================================================================== */
  function chartCostPerBtc(res) {
    var id = 'c2';
    var w = W2, h = H2, pd = PAD2;
    var rows = res.rows, n = rows.length;
    var x0 = pd.l, x1 = w - pd.r, y0 = pd.t, y1 = h - pd.b;

    /* Seed the curve with TODAY's all-in cost per BTC. Seeding it from the
       4-year summary value instead made the curve start at the month-48 number
       and immediately drop — a cliff that pointed at nothing. Because the rows
       now carry depreciation, the running average climbs smoothly from today's
       figure and lands exactly on `summary.actualCostPerBtc` (the end label). */
    var cost = [res.current.minerBtcDay > 0 ? res.current.dailyTotalCost / res.current.minerBtcDay : 0];
    for (var i = 0; i < n; i++) cost.push(rows[i].unitCost === null ? null : rows[i].unitCost);
    var vals = cost.filter(function (v) { return v !== null && isFinite(v); });
    if (!vals.length) vals = [0, 1];
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var padv = (mx - mn) * 0.12 || mx * 0.1;
    var sc = niceScale(Math.max(0, mn - padv), mx + padv, 5);

    function X(i) { return x0 + (x1 - x0) * (n <= 1 ? 0 : i / n); }
    function Y(v) { var d = sc.hi - sc.lo; if (!fin(v) || !fin(d) || Math.abs(d) < 1e-9) return NaN; var y = y1 - (y1 - y0) * ((v - sc.lo) / d); return (y < -1e5 || y > 1e5) ? NaN : y; }

    var s = frame({ id: id, aria: T('ch2.title','Mining Cost / BTC'), w: w, h: h, pad: pd });

    sc.ticks.forEach(function (t) {
      var y = Y(t);
      s += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="' + tok('--chart-grid') + '"/>';
      s += '<text x="' + (x0 - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + esc(fmtTick(t, 'usd')) + '</text>';
    });

    var xt = [0]; for (var k = 6; k <= n; k += 6) xt.push(k);
    xt.forEach(function (i) {
      var x = X(i);
      s += '<line x1="' + x.toFixed(1) + '" y1="' + y1 + '" x2="' + x.toFixed(1) + '" y2="' + (y1 + 5) + '" stroke="' + tok('--chart-grid') + '"/>';
      s += '<text x="' + x.toFixed(1) + '" y="' + (y1 + 20) + '" text-anchor="middle" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + (i === 0 ? 'M0' : 'M' + i) + '</text>';
    });
    s += '<text x="' + ((x0 + x1) / 2) + '" y="' + (h - 6) + '" text-anchor="middle" font-size="11" font-family="var(--f-sans)" fill="' + tok('--chart-axis') + '">' + esc(T('cg.months','Months from today')) + '</text>';

    /* reference line: current BTC price */
    if (res.current.btcPrice >= sc.lo && res.current.btcPrice <= sc.hi) {
      var yb = Y(res.current.btcPrice);
      s += '<line x1="' + x0 + '" y1="' + yb.toFixed(1) + '" x2="' + x1 + '" y2="' + yb.toFixed(1) + '" stroke="' + tok('--chart-btc') + '" stroke-width="1.4" stroke-dasharray="2 4" opacity=".9"/>';
      s += '<text x="' + (x0 + 8) + '" y="' + (yb - 7).toFixed(1) + '" font-size="10.5" font-weight="700" font-family="var(--f-sans)" fill="' + tok('--chart-btc') + '">' + esc(T('cg.btcPrice', 'BTC price')) + ' ' + esc(D.fmtUSDCompact(res.current.btcPrice)) + '</text>';
    }

    /* area under running cost */
    var pts = [];
    for (var j = 0; j <= n; j++) if (cost[j] !== null) pts.push([X(j), Y(cost[j])]);
    if (pts.length) {
      s += '<path d="' + linePath(pts) + ' L' + pts[pts.length - 1][0] + ' ' + y1 + ' L' + pts[0][0] + ' ' + y1 + ' Z" fill="' + alpha('--chart-1', 12) + '"/>';
      s += '<path d="' + linePath(pts) + '" fill="none" stroke="' + tok('--chart-1') + '" stroke-width="2.6" stroke-linejoin="round"/>';
      var lp = pts[pts.length - 1];
      s += '<circle cx="' + lp[0].toFixed(1) + '" cy="' + lp[1].toFixed(1) + '" r="4.5" fill="' + tok('--chart-1') + '" stroke="' + tok('--card-bg') + '" stroke-width="2"/>';
      s += '<text x="' + (lp[0] + 10) + '" y="' + (lp[1] + 4).toFixed(1) + '" font-size="12" font-weight="700" font-family="var(--f-mono)" fill="' + tok('--chart-1') + '">' + esc(D.fmtUSDCompact(res.summary.actualCostPerBtc)) + '</text>';
    }

    var bw = (x1 - x0) / n;
    for (var h2 = 0; h2 < n; h2++) {
      var lx = X(h2 + 1);
      s += hot('x="' + (lx - bw / 2).toFixed(1) + '" y="' + y0 + '" width="' + bw.toFixed(2) + '" height="' + (y1 - y0) + '"',
        monthLabel(h2 + 1), T('cg.cost','Cost / BTC') + ' ' + D.fmtUSD(rows[h2].unitCost) + ' · ' + T('proj.month','Month') + ' ' + D.fmtUSD(rows[h2].monthUnitCost), tok('--chart-1'));
    }
    s += '</svg>';
    return s;
  }

  /* ======================================================================
   * 3. NETWORK HASHRATE GROWTH
   * ====================================================================== */
  function chartHashrate(res) {
    var id = 'c3';
    var w = W2, h = H2, pd = PAD2;
    var rows = res.rows, n = rows.length;
    /* The "EH/s" unit caption sits above the top tick and needs its own row, so
       this chart reserves extra top gutter for it. */
    var HEAD = 14;
    var x0 = pd.l, x1 = w - pd.r, y0 = pd.t + HEAD, y1 = h - pd.b;

    var vals = [res.current.networkHashrateEhs];
    for (var i = 0; i < n; i++) vals.push(rows[i].networkHashrate);
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    var pad = (mx - mn) * 0.15 || mx * 0.1;
    var sc = niceScale(Math.max(0, mn - pad), mx + pad, 5);

    function X(i) { return x0 + (x1 - x0) * (n <= 1 ? 0 : i / n); }
    function Y(v) { var d = sc.hi - sc.lo; if (!fin(v) || !fin(d) || Math.abs(d) < 1e-9) return NaN; var y = y1 - (y1 - y0) * ((v - sc.lo) / d); return (y < -1e5 || y > 1e5) ? NaN : y; }

    var s = frame({ id: id, aria: T('ch3.title','Network Hashrate Growth'), w: w, h: h, pad: pd });

    sc.ticks.forEach(function (t) {
      var y = Y(t);
      s += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="' + tok('--chart-grid') + '"/>';
      s += '<text x="' + (x0 - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + esc(fmtTick(t, 'ehs')) + '</text>';
    });
    s += '<text x="' + (x0 - 10) + '" y="' + (pd.t + 4) + '" text-anchor="end" font-size="10" font-weight="700" font-family="var(--f-sans)" fill="' + tok('--chart-axis') + '">' + esc(T('cg.ehUnit', 'EH/s')) + '</text>';

    /* X ticks follow the horizon, not a baked 4-year ladder: a 10-year machine
       needs ticks past 4Y or the curve runs off the labelled axis. Year ticks
       when the horizon is long enough to space them, half-year fallback below
       two years so a short life still gets more than "Now". */
    var tickStep = n >= 24 ? 12 : 6;
    var xt = [0];
    for (var tk = tickStep; tk <= n; tk += tickStep) xt.push(tk);
    xt.forEach(function (i) {
      var x = X(i);
      var lab = i === 0 ? T('cg.now','Now')
        : (i % 12 === 0 ? (i / 12) + esc(T('cg.yearTick','Y')) : 'M' + i);
      s += '<line x1="' + x.toFixed(1) + '" y1="' + y1 + '" x2="' + x.toFixed(1) + '" y2="' + (y1 + 5) + '" stroke="' + tok('--chart-grid') + '"/>';
      s += '<text x="' + x.toFixed(1) + '" y="' + (y1 + 20) + '" text-anchor="middle" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + lab + '</text>';
    });

    var pts = [];
    if (fin(res.current.networkHashrateEhs)) pts.push([X(0), Y(res.current.networkHashrateEhs)]);
    for (var j = 0; j < n; j++) pts.push([X(j + 1), Y(rows[j].networkHashrate)]);
    s += '<path d="' + linePath(pts) + ' L' + X(n) + ' ' + y1 + ' L' + X(0) + ' ' + y1 + ' Z" fill="' + alpha('--chart-4', 12) + '"/>';
    s += '<path d="' + linePath(pts) + '" fill="none" stroke="' + tok('--chart-4') + '" stroke-width="2.6" stroke-linejoin="round"/>';

    /* year-end markers — every year the horizon actually contains */
    for (var y = 1; y * 12 <= n; y++) {
      var pi = y * 12;
      if (pi > n) break;
      var pt = [X(pi), Y(rows[pi - 1].networkHashrate)];
      s += '<circle cx="' + pt[0].toFixed(1) + '" cy="' + pt[1].toFixed(1) + '" r="4" fill="' + tok('--chart-4') + '" stroke="' + tok('--card-bg') + '" stroke-width="2"/>';
      s += '<text x="' + pt[0].toFixed(1) + '" y="' + (pt[1] - 11).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="700" font-family="var(--f-mono)" fill="' + tok('--chart-4') + '">' + D.fmtEH(rows[pi - 1].networkHashrate) + '</text>';
    }

    var growth = res.summary.networkHashrateEnd / (res.current.networkHashrateEhs || 1) - 1;
    /* Bottom-right, just above the axis. The curve's right end is at the TOP of
       the plot — that is the whole point of this chart — so the top band is
       already claimed by the top gridline's label and the year-end marker.
       Anchoring the growth callout in the empty bottom-right corner keeps the
       two apart at any scale; the collision sweep caught them touching by 1px
       once the horizon grew to a real 4 years and the end value got wider. */
    s += '<text x="' + (x1 - 4) + '" y="' + (y1 - 8) + '" text-anchor="end" font-size="11.5" font-weight="700" font-family="var(--f-mono)" fill="' + tok('--chart-4') + '">' + esc(D.fmtPctSigned(growth)) + ' ' + esc(T('cg.vsToday', 'vs today')) + '</text>';

    var bw = (x1 - x0) / n;
    for (var h2 = 0; h2 < n; h2++) {
      var lx = X(h2 + 1);
      s += hot('x="' + (lx - bw / 2).toFixed(1) + '" y="' + y0 + '" width="' + bw.toFixed(2) + '" height="' + (y1 - y0) + '"',
        monthLabel(h2 + 1), T('cg.hashrate','Network hashrate') + ' ' + D.fmtEH(rows[h2].networkHashrate) + ' EH/s · ' + D.fmtBTC(rows[h2].btcPerThDay, 10) + ' BTC/TH/day', tok('--chart-4'));
    }
    s += '</svg>';
    return s;
  }

  /* ======================================================================
   * 4. 4-YEAR COST BREAKDOWN (cumulative stacked bars)
   *
   * Cumulative stacking keeps every bar in the same order of magnitude and
   * stays monotonic, so it answers the question the panel actually asks: how
   * much total cost sits behind each year's BTC. Both bands accrue — capex as
   * straight-line depreciation — because that is the decomposition the
   * projection table publishes; charging the whole machine in Year 1 would
   * make the two panels disagree about Year 1's composition.
   * ====================================================================== */
  function chartBreakdown(res) {
    var id = 'c4';
    var years = res.years;
    var x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = H - PAD.b;
    if (!years.length) return '<svg viewBox="0 0 ' + W + ' ' + H + '"></svg>';

    var capex = res.input.machinePrice || 0;

    var nY = years.length;
    var cCapex = [], cElec = [], cTot = [], accE = 0;
    years.forEach(function (y, i) {
      accE += y.electricity;
      cElec.push(accE);
      var accD = nY > 0 ? capex * (i + 1) / nY : 0;   /* straight-line, matches the table */
      cCapex.push(accD);
      cTot.push(accD + accE);
    });

    var mx = Math.max.apply(null, cTot) || 1;
    var sc = niceScale(0, mx, 5);

    function Y(v) { var d = sc.hi - sc.lo; if (!fin(v) || !fin(d) || Math.abs(d) < 1e-9) return NaN; var y = y1 - (y1 - y0) * ((v - sc.lo) / d); return (y < -1e5 || y > 1e5) ? NaN : y; }

    var n = years.length;
    var slot = (x1 - x0) / n;
    var bw = Math.min(120, slot * 0.46);

    var s = frame({ id: id, aria: T('ch4.title','Cumulative Cost Breakdown') });

    sc.ticks.forEach(function (t) {
      var y = Y(t);
      if (!fin(y)) return;
      s += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="' + tok('--chart-grid') + '"/>';
      s += '<text x="' + (x0 - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + esc(fmtTick(t, 'usd')) + '</text>';
    });

    for (var i = 0; i < n; i++) {
      var yv = years[i];
      var cx = x0 + slot * (i + 0.5);
      var yTop = Y(cTot[i]);
      var yMid = Y(cCapex[i]);          /* capex band sits at the bottom */
      if (!fin(yTop) || !fin(yMid)) continue;

      var hCapex = y1 - yMid;           /* bottom band: sunk capex */
      var hElec = yMid - yTop;          /* top band: accumulated electricity */

      s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + yMid.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hCapex).toFixed(1) + '" fill="' + tok('--chart-2') + '" rx="2"/>';
      s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hElec).toFixed(1) + '" fill="' + tok('--chart-1') + '" rx="2"/>';

      s += '<text x="' + cx.toFixed(1) + '" y="' + (y1 + 21) + '" text-anchor="middle" font-size="12" font-weight="600" font-family="var(--f-sans)" fill="' + tok('--chart-axis') + '">' + esc(yearLabel(i + 1)) + '</text>';
      s += '<text x="' + cx.toFixed(1) + '" y="' + (yTop - 8).toFixed(1) + '" text-anchor="middle" font-size="11.5" font-weight="700" font-family="var(--f-mono)" fill="' + tok('--tx') + '">' + esc(D.fmtUSDCompact(cTot[i])) + '</text>';
      if (hElec > 14) {
        s += '<text x="' + cx.toFixed(1) + '" y="' + (yTop + 15).toFixed(1) + '" text-anchor="middle" font-size="10.5" font-family="var(--f-mono)" fill="' + tok('--accent-contrast') + '">' + esc(D.fmtUSDCompact(cElec[i])) + '</text>';
      }
      s += hot('x="' + (cx - slot / 2).toFixed(1) + '" y="' + y0 + '" width="' + slot.toFixed(1) + '" height="' + (y1 - y0) + '"',
        yearLabel(i + 1) + ' · ' + T('cg.cumulative','cumulative'),
        T('cg.capexShort2','Capex') + ' ' + D.fmtUSD(capex) + ' · ' + T('cg.cumElec','Cum. electricity') + ' ' + D.fmtUSD(cElec[i]) + ' · ' + T('cg.cumCost','Cum. cost') + ' ' + D.fmtUSD(cTot[i]),
        tok('--chart-1'));
    }

    /* legend lives in the panel header — do not duplicate it inside the SVG */
    s += '</svg>';
    return s;
  }

  /* ======================================================================
   * 6. SENSITIVITY — cost per BTC vs hashrate growth (line family)
   * ====================================================================== */
  function chartSensitivity(res, matrix) {
    var id = 'c6';
    var x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = H - PAD.b;
    var rows = matrix.rows, cols = matrix.cols;
    var isRatio = matrix.metric === 'ratio';
    var isUsd = matrix.metric === 'usd' || matrix.metric === 'netPerBtc';

    var all = [];
    rows.forEach(function (r) { r.cells.forEach(function (c) { if (fin(c.v)) all.push(c.v); }); });
    if (!all.length) return '<svg viewBox="0 0 ' + W + ' ' + H + '"></svg>';
    var mn = Math.min.apply(null, all), mx = Math.max.apply(null, all);
    if (isRatio) { mn = Math.min(mn, 1); mx = Math.max(mx, 1); }
    var span = mx - mn;
    var pad = span * 0.16 || Math.abs(mx || 1) * 0.1;
    /* While the grid sits entirely on one side of zero, padding must not carry the
       axis across zero. Doing so hands niceScale a small opposite-signed bound,
       which it rounds up to a full step — for an all-negative grid that meant an
       axis running -60k…+15k, wasting the top third of the plot and squashing the
       lowest labels into each other. Clamping at zero keeps the scale tight. */
    var lo2 = mn - pad, hi2 = mx + pad;
    if (isUsd && mn >= 0) lo2 = Math.max(0, lo2);
    if (isUsd && mx <= 0) hi2 = Math.min(0, hi2);
    if (!isUsd) lo2 = Math.max(0, lo2);
    var sc = niceScale(lo2, hi2, 5);

    function X(i) { return x0 + (x1 - x0) * (cols.length <= 1 ? 0.5 : i / (cols.length - 1)); }
    function Y(v) { var d = sc.hi - sc.lo; if (!fin(v) || !fin(d) || Math.abs(d) < 1e-9) return NaN; var y = y1 - (y1 - y0) * ((v - sc.lo) / d); return (y < -1e5 || y > 1e5) ? NaN : y; }

    var s = frame({ id: id, aria: T('ch6.title','Net Profit per BTC') });
    /* One colour per BTC-growth rung, and the palette has to be as wide as the
       grid. It used to wrap modulo four, which was invisible at four rungs and
       a lie at six: rows 0 and 4 would both draw blue, so the two long paths
       (flat price vs +40% price) would sit on top of each other in the same
       hue with two labels claiming different values. Wrapping is kept as the
       last-ditch case so an over-long grid degrades instead of printing
       "undefined" into a stroke attribute. */
    var seriesColors = [
      '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'
    ].map(function (n) { return tok(n); });
    function serieColor(i) { return seriesColors[i % seriesColors.length]; }

    sc.ticks.forEach(function (t) {
      var y = Y(t);
      var zero = Math.abs(t) < 1e-9;
      s += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="' + tok(zero ? '--chart-axis' : '--chart-grid') + '" stroke-width="' + (zero ? 1.4 : 1) + '"/>';
      s += '<text x="' + (x0 - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + esc(fmtTick(t, isRatio ? 'ratio' : 'usd')) + '</text>';
    });

    /* parity reference at 100% */
    if (isRatio && sc.lo <= 1 && 1 <= sc.hi) {
      var yp = Y(1);
      s += '<line x1="' + x0 + '" y1="' + yp.toFixed(1) + '" x2="' + x1 + '" y2="' + yp.toFixed(1) + '" stroke="' + tok('--chart-axis') + '" stroke-width="1.4" stroke-dasharray="5 4"/>';
      s += '<text x="' + (x1 - 2) + '" y="' + (yp - 7).toFixed(1) + '" text-anchor="end" font-size="10.5" font-weight="700" font-family="var(--f-sans)" fill="' + tok('--chart-axis') + '">' + esc(T('cg.parity', '100% — parity with spot')) + '</text>';
    }

    cols.forEach(function (c, i) {
      var x = X(i);
      s += '<line x1="' + x.toFixed(1) + '" y1="' + y1 + '" x2="' + x.toFixed(1) + '" y2="' + (y1 + 5) + '" stroke="' + tok('--chart-grid') + '"/>';
      s += '<text x="' + x.toFixed(1) + '" y="' + (y1 + 20) + '" text-anchor="middle" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + D.fmtPct(c, 0) + '</text>';
    });
    s += '<text x="' + ((x0 + x1) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" font-family="var(--f-sans)" fill="' + tok('--chart-axis') + '">' + esc(T('cg.hashGrowthAxis', 'Annual network hashrate growth')) + '</text>';

    /* One pass of point maths, shared by the paths and the end labels. */
    var seriesPts = rows.map(function (r) {
      return r.cells.map(function (c, i) { return [X(i), Y(c.v)]; }).filter(function (p) { return fin(p[1]); });
    });

    /* Every end label sits at the same x — the last column — so the gutter is a
       vertical stack, and the labels collide the moment two rungs converge.
       Sampling BTC growth at 10-point steps made that happen: the three lowest
       rungs end 11px apart while an 11px label is 13px tall. Greedy spread down
       the stack, minimum gap = one line. Labels stay in rank order next to their
       own line, and a row that is not displaced keeps its exact y. */
    var LABEL_GAP = 15;
    var labelY = seriesPts.map(function (pts) { return pts.length ? pts[pts.length - 1][1] : null; });
    labelY.map(function (y, i) { return { y: y, i: i }; })
      .filter(function (o) { return o.y !== null; })
      .sort(function (a, b) { return a.y - b.y; })
      .forEach(function (o, k, arr) {
        if (k && o.y - arr[k - 1].y < LABEL_GAP) { o.y = arr[k - 1].y + LABEL_GAP; labelY[o.i] = o.y; }
      });

    seriesPts.forEach(function (pts, ri) {
      if (!pts.length) return;
      var r = rows[ri];
      s += '<path d="' + linePath(pts) + '" fill="none" stroke="' + serieColor(ri) + '" stroke-width="2.4" stroke-linejoin="round"/>';
      pts.forEach(function (p) {
        s += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3.6" fill="' + serieColor(ri) + '" stroke="' + tok('--card-bg') + '" stroke-width="1.8"/>';
      });
      var lp = pts[pts.length - 1];
      s += '<text x="' + (lp[0] + 10) + '" y="' + (labelY[ri] + 4).toFixed(1) + '" font-size="11" font-weight="700" font-family="var(--f-mono)" fill="' + serieColor(ri) + '">' + D.fmtPct(r.btcGrowth, 0) + ' BTC</text>';
      r.cells.forEach(function (c, i) {
        s += hot('x="' + (X(i) - 24).toFixed(1) + '" y="' + y0 + '" width="48" height="' + (y1 - y0) + '"',
          T('cg.btcGrowth','BTC growth') + ' ' + D.fmtPct(r.btcGrowth, 0) + ' · ' + T('cg.hashrateShort','hashrate') + ' ' + D.fmtPct(cols[i], 0),
          T('cg.netPerBtc','Net per BTC') + ' ' + D.fmtUSD(c.v) + ' · ' + T('cg.realised','realised') + ' ' + D.fmtUSD(c.realisedPrice) + ' · ' + T('cg.cost','Cost / BTC') + ' ' + D.fmtUSD(c.cost),
          c.v >= 0 ? tok('--chart-3') : tok('--chart-neg'));
      });
    });
    s += '</svg>';
    return s;
  }

  /* ======================================================================
   * 7. SENSITIVITY — cost per BTC vs electricity price (bars)
   * ====================================================================== */
  function chartElecSens(res, series) {
    var id = 'c7';
    var x0 = PAD.l, x1 = W - PAD.r, y0 = PAD.t, y1 = H - PAD.b;

    var vals = series.map(function (s) { return s.costPerBtc; }).filter(function (v) { return isFinite(v); });
    if (!vals.length) return '<svg viewBox="0 0 ' + W + ' ' + H + '"></svg>';
    var mx = Math.max.apply(null, vals.concat([res.current.btcPrice]));
    var sc = niceScale(0, mx * 1.05, 5);

    function Y(v) { var d = sc.hi - sc.lo; if (!fin(v) || !fin(d) || Math.abs(d) < 1e-9) return NaN; var y = y1 - (y1 - y0) * ((v - sc.lo) / d); return (y < -1e5 || y > 1e5) ? NaN : y; }

    var s = frame({ id: id, aria: T('ch7.title','Cost / BTC vs Electricity Price') });
    var n = series.length;
    var slot = (x1 - x0) / n;
    var bw = Math.min(96, slot * 0.5);

    sc.ticks.forEach(function (t) {
      var y = Y(t);
      s += '<line x1="' + x0 + '" y1="' + y.toFixed(1) + '" x2="' + x1 + '" y2="' + y.toFixed(1) + '" stroke="' + tok('--chart-grid') + '"/>';
      s += '<text x="' + (x0 - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">' + esc(fmtTick(t, 'usd')) + '</text>';
    });

    series.forEach(function (sr, i) {
      var cx = x0 + slot * (i + 0.5);
      var yTop = Y(sr.costPerBtc);
      var profitable = sr.costPerBtc <= res.current.btcPrice;
      var col = profitable ? tok('--chart-3') : tok('--chart-neg');
      s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + yTop.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y1 - yTop).toFixed(1) + '" fill="' + col + '" rx="2" opacity="' + (sr.breakEven ? 0.95 : 0.8) + '"/>';
      s += '<text x="' + cx.toFixed(1) + '" y="' + (yTop - 8).toFixed(1) + '" text-anchor="middle" font-size="11" font-weight="700" font-family="var(--f-mono)" fill="' + tok('--tx') + '">' + esc(D.fmtUSDCompact(sr.costPerBtc)) + '</text>';
      s += '<text x="' + cx.toFixed(1) + '" y="' + (y1 + 20) + '" text-anchor="middle" font-size="11.5" font-weight="600" font-family="var(--f-mono)" fill="' + tok('--chart-axis') + '">$' + sr.price.toFixed(3) + '</text>';
      s += hot('x="' + (cx - slot / 2).toFixed(1) + '" y="' + y0 + '" width="' + slot.toFixed(1) + '" height="' + (y1 - y0) + '"',
        '$' + sr.price.toFixed(3) + '/kWh',
        T('cg.cost','Cost / BTC') + ' ' + D.fmtUSD(sr.costPerBtc) + ' · ' + T('cg.shutdown','Shutdown price') + ' ' + D.fmtUSD(sr.shutdownPrice) + ' · ' + T('cg.daily','daily') + ' ' + D.fmtUSD(sr.dailyProfit, 2),
        col);
    });

    /* BTC price reference (only when it falls inside the plotted range). Same
       concept, same wording as chart 2's reference line — and the axis caption
       below calls it "the dotted line", so naming it BTC price disambiguates. */
    var bp = res.current.btcPrice;
    if (fin(bp) && bp >= sc.lo && bp <= sc.hi) {
      var yb = Y(bp);
      s += '<line x1="' + x0 + '" y1="' + yb.toFixed(1) + '" x2="' + x1 + '" y2="' + yb.toFixed(1) + '" stroke="' + tok('--chart-btc') + '" stroke-width="1.6" stroke-dasharray="4 4"/>';
      s += '<text x="' + (x1 - 2) + '" y="' + Math.max(y0 + 10, yb - 7).toFixed(1) + '" text-anchor="end" font-size="10.5" font-weight="700" font-family="var(--f-sans)" fill="' + tok('--chart-btc') + '">' + esc(T('cg.btcPrice', 'BTC price')) + ' ' + esc(D.fmtUSDCompact(bp)) + '</text>';
    }
    s += '<text x="' + ((x0 + x1) / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" font-family="var(--f-sans)" fill="' + tok('--chart-axis') + '">' + esc(T('cg.elecAxis', 'Electricity price (USDT / kWh) — below the dotted line the operation is profitable')) + '</text>';
    s += '</svg>';
    return s;
  }

  root.Charts = {
    priceVsShutdown: chartPriceVsShutdown,
    costPerBtc: chartCostPerBtc,
    hashrate: chartHashrate,
    breakdown: chartBreakdown,
    sensitivity: chartSensitivity,
    elecSens: chartElecSens,
    fmtTick: fmtTick, niceScale: niceScale, esc: esc
  };
}(window));
