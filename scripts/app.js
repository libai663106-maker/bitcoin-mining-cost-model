/* ==========================================================================
 * Bitcoin Mining Cost Model — UI controller
 * Reads market.json (baked snapshot), computes with MiningEngine, renders.
 * ========================================================================== */
(function () {
  'use strict';

  var E = window.MiningEngine, D = window.AppData, C = window.Charts;
  var $ = function (id) { return document.getElementById(id); };
  var MARKET = null;

  /* ---------------- state ---------------- */
  var state = {
    inputs: Object.assign({}, D.DEFAULTS),
    live: { btcPrice: true, networkHashrate: true },
    manual: { btcPrice: null, networkHashrate: null },
    result: null,
    didInitialRender: false
  };

  /* ---------------- theme ---------------- */
  var THEMES = [
    { key: 'light', glyph: '☀', name: 'Light' },
    { key: 'dark', glyph: '☾', name: 'Dark' },
    { key: 'tech', glyph: '⬡', name: 'Tech' },
    { key: 'minimal', glyph: '▫', name: 'Minimal' }
  ];
  var TKEY = 'bmcm-theme';

  function applyTheme(key, animate) {
    document.documentElement.setAttribute('data-theme', key);
    D.dropTokCache();
    document.querySelectorAll('.theme-pop button').forEach(function (b) {
      b.setAttribute('aria-checked', b.dataset.theme === key ? 'true' : 'false');
    });
    var t = THEMES.find(function (x) { return x.key === key; });
    var g = $('themeGlyph'); if (g && t) g.textContent = t.glyph;
    try { localStorage.setItem(TKEY, key); } catch (e) { }
    if (animate && state.result) renderCharts(state.result);
  }

  /* ---------------- money / status helpers ---------------- */
  function costRatioTag(ratio) {
    if (ratio === null) return '<span class="tag n">' + D.tr('na.value', 'N/A') + '</span>';
    if (ratio > 1) return '<span class="tag bad">' + I18N.t('tag.aboveBE') + '</span>';
    if (ratio >= 0.9) return '<span class="tag warn">' + I18N.t('tag.highPressure') + '</span>';
    if (ratio >= 0.7) return '<span class="tag n">' + I18N.t('tag.normal') + '</span>';
    return '<span class="tag ok">' + I18N.t('tag.lowPressure') + '</span>';
  }

  /* ======================================================================
   * RENDER
   * ====================================================================== */
  function render() {
    var inp = Object.assign({}, state.inputs);
    inp.btcPrice = liveValue('btcPrice');
    inp.networkHashrateEhs = liveValue('networkHashrate');

    var res = E.simulate(inp);
    state.result = res;

    renderKpis(res);
    renderEconomics(res);
    renderPayback(res);
    renderMdet(res);
    renderCharts(res);
    renderVs(res);
    renderSensitivity(res);
    renderAssumptions(res);
    paintHorizonLabels();
    syncUrl();
  }

  /** value used for a live-or-manual source */
  function liveValue(which) {
    if (which === 'btcPrice') {
      if (state.live.btcPrice) return MARKET.btc_price_usd;
      return state.manual.btcPrice !== null ? state.manual.btcPrice : MARKET.btc_price_usd;
    }
    if (which === 'networkHashrate') {
      if (state.live.networkHashrate) return MARKET.network_hashrate_ehs;
      return state.manual.networkHashrate !== null ? state.manual.networkHashrate : MARKET.network_hashrate_ehs;
    }
    return 0;
  }

  /* ---------------- KPI cards ---------------- */
  function renderKpis(res) {
    var F = res.current, S = res.summary;
    var prof = F.dailyNetProfit >= 0;

    $('kpiCostVal').textContent = S.actualCostPerBtc !== null ? D.fmtUSD(S.actualCostPerBtc) : D.tr('na.value', 'N/A');
    $('kpiCostSub').innerHTML = S.actualCostPerBtc !== null
      ? I18N.t('kpi.costSub') + ' · ' + res.input.months + ' ' + D.tr('unit.months','months')
      : I18N.t('na.noBtc');
    $('kpiCostTag').innerHTML = S.actualCostPerBtc !== null && F.btcPrice
      ? (S.actualCostPerBtc <= F.btcPrice ? '<span class="tag ok">' + I18N.t('kpi.belowSpot') + '</span>' : '<span class="tag bad">' + I18N.t('kpi.aboveSpot') + '</span>')
      : '<span class="tag n">' + D.tr('na.value', 'N/A') + '</span>';

    $('kpiShutVal').textContent = F.shutdownPrice !== null ? D.fmtUSD(F.shutdownPrice) : D.tr('na.value', 'N/A');
    $('kpiShutSub').textContent = I18N.t('kpi.shutSub2');
    var margin = F.btcPrice > 0 && F.shutdownPrice !== null ? 1 - F.shutdownPrice / F.btcPrice : null;
    $('kpiShutTag').innerHTML = margin === null ? '<span class="tag n">' + D.tr('na.value', 'N/A') + '</span>'
      : margin > 0 ? '<span class="tag ok">' + D.fmtPct(margin) + ' ' + I18N.t('kpi.headroom') + '</span>'
        : '<span class="tag bad">' + D.fmtPct(-margin) + ' ' + I18N.t('kpi.underwater') + '</span>';

    var pv = $('kpiProfitVal');
    pv.textContent = (prof ? '+' : '-') + D.fmtUSD(Math.abs(F.dailyNetProfit), 2);
    pv.className = 'k-value ' + (prof ? 'pos' : 'neg');
    $('kpiProfitSub').textContent = I18N.t('kpi.revLabel') + ' ' + D.fmtUSD(F.dailyRevenue, 2) + ' − ' + I18N.t('kpi.costLabel') + ' ' + D.fmtUSD(F.dailyTotalCost, 2);
    $('kpiProfitTag').innerHTML = prof ? '<span class="tag ok">' + I18N.t('kpi.profitable') + '</span>' : '<span class="tag bad">' + I18N.t('kpi.unprofitable') + '</span>';

    var sp = D.fmtDays(F.staticPaybackDays);
    $('kpiPayVal').textContent = sp === null ? I18N.t('na.payback') : sp;
    $('kpiPayVal').className = 'k-value' + (sp === null ? ' muted' : '');
    $('kpiPaySub').innerHTML = sp === null
      ? I18N.t('kpi.payNo') : I18N.t('kpi.paySub2');
    $('kpiPayTag').innerHTML = costRatioTag(F.costRatio);
  }

  /* ---------------- detailed economics ---------------- */
  function renderEconomics(res) {
    var F = res.current, S = res.summary;
    /* Every cost row is labelled by basis, because the model deliberately
       carries two: all-in (what "cost" means everywhere else in the product)
       and cash (what a shutdown call compares against). Showing only one of
       them is what made "Daily Machine Cost" read as a missing value. */
    var rows = [
      [I18N.t('econ.btcPerTh'), D.fmtBTC(F.btcPerThDay, 10), ''],
      [I18N.t('econ.btcPerDay'), D.fmtBTC(F.minerBtcDay, 8), ''],
      [I18N.t('econ.btcPerMonth'), D.fmtBTC(F.minerBtcDay * 30, 6), ''],
      [I18N.t('econ.revenue'), D.fmtUSD(F.dailyRevenue, 2), ''],
      [I18N.t('econ.elec'), D.fmtUSD(F.dailyElectricity, 2), ''],
      [I18N.t('econ.machine'), D.fmtUSD(F.dailyMachineCost, 2) + ' ' + I18N.t('unit.perDay'), 'muted'],
      [I18N.t('econ.total'), D.fmtUSD(F.dailyTotalCost, 2), ''],
      [I18N.t('econ.profit'), D.fmtUSD(F.dailyNetProfit, 2), F.dailyNetProfit >= 0 ? 'pos' : 'neg'],
      [I18N.t('econ.cashFlow'), D.fmtUSD(F.dailyCashNetProfit, 2), 'muted'],
      [I18N.t('econ.costRatio'), D.fmtPct(F.costRatio), F.costRatio === null ? 'muted' : (F.costRatio > 1 ? 'neg' : (F.costRatio >= 0.9 ? '' : 'pos'))],
      [I18N.t('kpi.pay'), D.fmtDays(F.staticPaybackDays) || I18N.t('na.payback'), F.staticPaybackDays === null ? 'muted' : ''],
      [I18N.t('econ.breakElec'), D.fmtUSD(F.breakEvenElectricity, 4) + ' ' + I18N.t('unit.perKwhShort'), 'muted']
    ];
    $('econRows').innerHTML = rows.map(function (r) {
      return '<tr><td class="rowhead">' + r[0] + '</td><td class="' + r[2] + '">' + r[1] + '</td></tr>';
    }).join('');

    /* The mix bar splits the ALL-IN daily cost, so depreciation is visible here
       too rather than being reported as an empty band. */
    var mixTot = F.dailyFullCost;
    $('econMix').innerHTML =
      '<div class="bdrow"><div class="lab">' + I18N.t('cg.electricity2') + '</div><div class="barwrap">' +
      bar(F.dailyElectricity, mixTot, '--chart-1') +
      '</div><div class="val">' + D.fmtPct(mixTot > 0 ? F.dailyElectricity / mixTot : null) + '</div></div>' +
      '<div class="bdrow"><div class="lab" style="color:var(--tx-4)">' + I18N.t('econ.machineShort') + '</div><div class="barwrap">' +
      bar(F.dailyMachineCost, mixTot, '--chart-2') +
      '</div><div class="val" style="color:var(--tx-4)">' + D.fmtPct(mixTot > 0 ? F.dailyMachineCost / mixTot : null) + '</div></div>' +
      '<p class="vs-note" style="margin:6px 0 0;font-size:10.5px">' + I18N.t('econ.basisNote') + '</p>';

    $('econVol').innerHTML =
      '<div class="scn-row"><span>' + I18N.t('inp.price') + '</span><b>' + D.fmtUSD(res.input.machinePrice) + '</b></div>' +
      '<div class="scn-row"><span>' + I18N.t('inp.eff') + '</span><b>' + (F.efficiency_jth ? F.efficiency_jth.toFixed(2) + ' J/TH' : D.tr('na.value', 'N/A')) + '</b></div>' +
      '<div class="scn-row"><span>' + I18N.t('inp.life') + '</span><b>' + res.input.lifeYears + ' ' + D.tr('unit.yr','yr') + ' · ' + D.fmtNum(F.serviceLifeDays, 0) + ' ' + D.tr('unit.dShort','d') + '</b></div>' +
      '<div class="scn-row"><span>' + I18N.t('inp.uptime') + '</span><b>' + D.fmtPct(res.input.uptime) + '</b></div>' +
      '<div class="scn-row"><span>' + I18N.t('inp.pool') + '</span><b>' + D.fmtPct(res.input.poolFee) + '</b></div>' +
      '<div class="scn-row"><span>' + I18N.t('inp.power') + '</span><b>' + D.fmtNum(res.input.power, 0) + ' W</b></div>';
  }
  function bar(v, total, token) {
    var pct = total > 0 ? Math.max(0, Math.min(100, v / total * 100)) : 0;
    return '<span style="width:' + pct.toFixed(2) + '%;background:var(' + token + ')"></span>';
  }

  /* ---------------- payback price cards ---------------- */
  function renderPayback(res) {
    var F = res.current;
    var defs = [
      { id: 18, v: F.payback18 },
      { id: 24, v: F.payback24 },
      { id: 48, v: F.payback48 }
    ];
    defs.forEach(function (d) {
      var el = $('pb' + d.id + 'Val');
      if (!el) return;
      el.textContent = d.v !== null ? D.fmtUSD(d.v) : D.tr('na.value','N/A');
      var delta = d.v !== null && F.btcPrice > 0 ? d.v / F.btcPrice - 1 : null;
      $('pb' + d.id + 'Sub').innerHTML = delta === null ? '<span style="color:var(--tx-4)">' + I18N.t('pay.notDefined') + '</span>'
        : (delta >= 0
          ? '<span style="color:var(--negative);font-weight:600">+' + (delta * 100).toFixed(0) + I18N.t('pay.above') + '</span>'
          : '<span style="color:var(--positive);font-weight:600">' + (delta * 100).toFixed(0) + I18N.t('pay.below') + '</span>');
    });
  }

  /* ---------------- monthly cost detail ---------------- */
  /** The life span the copy quotes, in years. Read off the result rather than
   *  the inputs so no label can quote a horizon the simulation did not use.
   *  Every "{n}" in the string table is expected to be this number. */
  function horizonYears() {
    var r = state.result;
    if (r && r.input && isFinite(r.input.lifeYears)) return Math.round(r.input.lifeYears * 10) / 10;
    return isFinite(state.inputs.lifeYears) ? state.inputs.lifeYears : 4;
  }

  /** Static copy that carries the "{n}" horizon token (vs.spotNote, ch1.hint)
   *  must follow 使用年限 exactly like the numbers do. relabelDom() repaints
   *  every label, but it only runs at boot and on a language switch — so an
   *  input change left the note quoting the boot-time life span ("+ 4 年电费")
   *  while the panel above it already showed the new horizon's figures. This
   *  repaint is scoped to {n}-bearing labels and cached on the horizon value,
   *  so a keystroke that does not move 使用年限 repaints nothing. */
  var paintedHorizon = null;
  function paintHorizonLabels() {
    var years = horizonYears();
    if (years === paintedHorizon) return;
    paintedHorizon = years;
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var tpl = I18N.t(el.getAttribute('data-i18n'));
      if (typeof tpl === 'string' && tpl.indexOf('{n}') >= 0) el.textContent = I18N.fill(tpl, years);
    });
  }

  /** One line per billing period from the rack date. A month a halving splits
   *  arrives from the engine already split into a pre and a post line, so this
   *  renderer never has to know what a halving is — it only numbers the rows,
   *  which is why the period count can exceed the month count. */
  function renderMdet(res) {
    var rows = res.detailRows || [];
    var na = D.tr('na.value', 'N/A');
    var payback = res.summary && res.summary.paybackMonth;

    /* Column order is a product decision, not an accident of the data model:
       production sits next to the rate that produces it ($/TH/day → BTC), the
       electricity bill sits immediately before the all-in cost it is a part of,
       and the shutdown price closes the row as the derived break-even line.
       Cost share of revenue used to sit before the shutdown price; it was
       dropped because the cost basis column already answers "does this period
       pay for itself", and the percentage was the one column that restated a
       ratio rather than reporting a quantity. The engine still computes it
       (detailRows[].costRatio) — this is a display decision only. */
    var head = [
      I18N.t('mdet.period'), I18N.t('mdet.time'),
      I18N.t('mdet.impliedHash'), I18N.t('mdet.subsidy'), I18N.t('mdet.perTh'),
      I18N.t('mdet.btc'), I18N.t('mdet.elec'),
      I18N.t('mdet.totalCost'), I18N.t('mdet.holdCost'),
      I18N.t('mdet.shutdown')
    ];
    var HOLD_COL = 8;
    /* The one column whose arithmetic is not guessable from its name carries
       its formula as a tooltip. Attribute only, so the header text the probes
       read stays exactly the label. */
    var holdTitle = ' title="' + I18N.t('mdet.holdCostHint') + '"';
    $('mdetHead').innerHTML = '<tr>' + head.map(function (h, i) {
      return '<th' + (i === HOLD_COL ? holdTitle : '') + '>' + h + '</th>';
    }).join('') + '</tr>';

    var body = rows.map(function (r) {
      var cls = r.split ? ' class="split ' + (r.part === 2 ? 'post' : 'pre') + '"' : '';
      var tag = r.split
        ? '<span class="mtag">' + I18N.t(r.part === 2 ? 'mdet.post' : 'mdet.pre') + '</span>'
        : '';
      /* 矿机回本 — the month the machine's operating cash has paid for itself.
         Marked per detail row so the tag rides the halving split if the two
         ever coincide, and it only ever renders on the single month the model
         named. */
      var payTag = (payback !== null && r.month === payback)
        ? '<span class="mtag pay">' + I18N.t('mdet.payback') + '</span>'
        : '';
      return '<tr' + cls + '><td class="pno">' + r.period + '</td>'
        + '<td>' + r.dateStart + ' → ' + r.dateEnd + tag + payTag
        + ' <small>' + r.days + ' ' + I18N.t('mdet.days') + '</small></td>'
        + '<td>' + D.fmtEH(r.impliedHashrateEhs) + '</td>'
        + '<td>' + D.fmtNum(r.blockSubsidy, 4) + '</td>'
        + '<td>' + D.fmtBTC(r.btcPerThDay, 10) + '</td>'
        + '<td>' + D.fmtBTC(r.btc, 6) + '</td>'
        + '<td>' + D.fmtUSD(r.electricity) + '</td>'
        + '<td>' + D.fmtUSD(r.totalCost) + '</td>'
        + '<td>' + (r.unitCost !== null ? D.fmtUSD(r.unitCost) : na) + '</td>'
        + '<td>' + (r.shutdownPrice !== null ? D.fmtUSD(r.shutdownPrice) : na) + '</td></tr>';
    }).join('');

    /* Totals are summed from the detail rows themselves, so the footer is the
       same money the lines above it add up to by definition. */
    var tot = rows.reduce(function (a, r) {
      a.days += r.days; a.btc += r.btc; a.elec += r.electricity;
      a.cost += r.totalCost; return a;
    }, { days: 0, btc: 0, elec: 0, cost: 0 });

    body += '<tr class="total"><td>' + I18N.t('mdet.total')
      + ' <small>' + rows.length + ' ' + I18N.t('mdet.nPeriods') + '</small></td>'
      + '<td><small>' + tot.days + ' ' + I18N.t('mdet.days') + '</small></td>'
      + '<td>' + D.fmtEH(res.summary.networkHashrateEnd) + '</td>'
      + '<td>' + na + '</td><td>' + na + '</td>'
      + '<td>' + D.fmtBTC(tot.btc, 5) + '</td>'
      + '<td>' + D.fmtUSD(tot.elec) + '</td>'
      + '<td>' + D.fmtUSD(tot.cost) + '</td>'
      /* Horizon cost basis — the same division as every line above it, so it
         lands on summary.actualCostPerBtc and on the KPI's end-of-life label. */
      + '<td>' + (tot.btc > 0 ? D.fmtUSD(tot.cost / tot.btc) : na) + '</td>'
      /* A shutdown price is a per-period break-even, not a quantity that sums:
         one number cannot represent the whole horizon, so it stays blank. */
      + '<td>' + na + '</td></tr>';

    $('mdetBody').innerHTML = body;
    $('mdetNote').innerHTML = I18N.t('mdet.note');
  }

  /* ---------------- charts ---------------- */
  function renderCharts(res) {
    var inp = Object.assign({}, state.inputs);
    inp.btcPrice = liveValue('btcPrice');
    inp.networkHashrateEhs = liveValue('networkHashrate');

    $('chartPrice').innerHTML = C.priceVsShutdown(res, res.current);
    $('chartCost').innerHTML = C.costPerBtc(res);
    $('chartHash').innerHTML = C.hashrate(res);
    $('chartBreak').innerHTML = C.breakdown(res);
  }

  /* ---------------- mining vs spot ---------------- */
  function renderVs(res) {
    var vs = res.vs, F = res.current;
    if (vs.spotBtc === null || vs.miningBtc <= 0) {
      $('vsMining').textContent = D.tr('na.value', 'N/A');
      $('vsSpot').textContent = D.tr('na.value', 'N/A');
      $('vsRatio').textContent = D.tr('na.value', 'N/A');
      $('vsGauge').innerHTML = '';
      $('vsRows').innerHTML = '';
      return;
    }
    $('vsMining').innerHTML = D.fmtBTC(vs.miningBtc, 6) + '<small>BTC</small>';
    $('vsSpot').innerHTML = D.fmtBTC(vs.spotBtc, 6) + '<small>BTC</small>';
    $('vsRatio').textContent = D.fmtPct(vs.ratio);
    $('vsRatio').className = 'k-value ' + (vs.ratio >= 1 ? 'pos' : 'neg');

    var pct = Math.max(0, Math.min(200, vs.ratio * 100));
    $('vsGauge').innerHTML =
      '<div class="gauge"><div class="fill" style="width:' + Math.min(100, pct / 2).toFixed(1) + '%"></div>'
      + '<div class="mark" style="left:50%"></div></div>'
      + '<div class="gauge-lbl"><span>0%</span><span>' + I18N.t('vs.parity') + '</span><span>200%</span></div>';

    $('vsRows').innerHTML =
      row(I18N.t('vs.perMining'), (vs.miningValuePerCost * 1e6).toFixed(4) + ' BTC')
      + row(I18N.t('vs.perSpot'), (1 / res.input.btcPrice * 1e6).toFixed(4) + ' BTC')
      + row(I18N.t('vs.exitPrice'), D.fmtUSD(vs.exitPrice))
      + row(I18N.t('vs.miningRoi'), D.fmtPctSigned(vs.miningRoi), vs.miningRoi >= 0 ? 'pos' : 'neg')
      + row(I18N.t('vs.spotRoi'), D.fmtPctSigned(vs.spotRoi), vs.spotRoi >= 0 ? 'pos' : 'neg')
      + row(I18N.t('vs.recoverExit'), vs.breakEvenExit !== null ? D.fmtUSD(vs.breakEvenExit) : D.tr('na.value', 'N/A'))
      + row(I18N.t('vs.spotBasis'), D.fmtUSD(res.input.btcPrice))
      + row(I18N.t('vs.netProfit'), D.fmtUSD(res.summary.netProfit), res.summary.netProfit >= 0 ? 'pos' : 'neg');

    function row(k, v, cls) { return '<div class="scn-row"><span>' + k + '</span><b class="' + (cls || '') + '">' + v + '</b></div>'; }
  }

  /* ---------------- sensitivity ---------------- */
  function renderSensitivity(res) {
    var inp = baseInput();
    var matrix = E.sensitivityCostMatrix(inp, D.BTC_GROWTH_GRID, D.HASHRATE_GROWTH_GRID, { metric: 'netPerBtc' });

    /* Diverging scale (spec §34 asks for a readable matrix).
       A single-hue |value| ramp collapses here: when every cell sits on the same
       side of zero the whole grid turns one flat colour and the ramp carries no
       information. So normalise each side against its own extreme — negatives
       against the worst loss, positives against the best gain — and let 0 sit at
       the neutral midpoint. That keeps the sign readable and the gradient intact
       whether the grid is all-negative, all-positive, or straddling zero. */
    var negs = [], poss = [];
    matrix.rows.forEach(function (r) {
      r.cells.forEach(function (c) {
        if (!isFinite(c.v)) return;
        (c.v < 0 ? negs : poss).push(Math.abs(c.v));
      });
    });
    var mxNeg = negs.length ? Math.max.apply(null, negs) : 0;
    var mxPos = poss.length ? Math.max.apply(null, poss) : 0;

    function cellTone(v) {
      if (!isFinite(v)) return { tone: '--bg-inset', pct: 100, dim: true };
      /* floor of 16% so a near-zero cell never renders as bare background */
      var t = v < 0
        ? (mxNeg > 0 ? Math.abs(v) / mxNeg : 0)
        : (mxPos > 0 ? v / mxPos : 0);
      return { tone: v < 0 ? '--chart-neg' : '--chart-pos', pct: Math.round(16 + t * 36), dim: false };
    }

    /* corner label is right-aligned by CSS to sit against the data block, so it
       must not carry an inline text-align:left or the rule loses the cascade */
    var thead = '<tr><th class="edge">' + I18N.t('sens.corner') + '</th>'
      + matrix.cols.map(function (c) { return '<th class="colh">' + D.fmtPct(c, 0) + '</th>'; }).join('') + '</tr>';
    var tbody = matrix.rows.map(function (r) {
      return '<tr><th class="edge" style="font-family:var(--f-mono)">' + D.fmtPct(r.btcGrowth, 0) + '</th>'
        + r.cells.map(function (c) {
          var t = cellTone(c.v);
          return '<td class="cell' + (t.dim ? ' dim' : '') + '" style="background:' + D.alpha(t.tone, t.pct) + '">' + D.fmtUSD(c.v) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    $('heat').innerHTML = thead + tbody;
    $('chartSens').innerHTML = C.sensitivity(res, matrix);

    /* scale legend — the ramp is normalised per sign, so state what it means */
    var scaleNote;
    if (mxNeg > 0 && mxPos > 0) {
      scaleNote = I18N.t('sens.scaleBoth');
    } else if (mxNeg > 0) {
      scaleNote = I18N.t('sens.scaleNegPrefix') + D.fmtUSD(-mxNeg) + ').';
    } else if (mxPos > 0) {
      scaleNote = I18N.t('sens.scalePosPrefix') + D.fmtUSD(mxPos) + ').';
    } else {
      scaleNote = I18N.t('sens.scaleNone');
    }
    $('heatLabel').textContent = I18N.t('sens.heatLabel');
    $('heatScale').textContent = scaleNote;

    var elec = E.sensitivityElectricity(inp, D.ELECTRICITY_GRID);
    $('elecRows').innerHTML = elec.map(function (r) {
      return '<tr><td class="rowhead">$' + r.price.toFixed(3) + ' ' + I18N.t('unit.perKwhShort') + '</td>'
        + '<td>' + D.fmtUSD(r.costPerBtc) + '</td>'
        + '<td>' + D.fmtUSD(r.shutdownPrice) + '</td>'
        + '<td class="' + (r.miningRoi >= 0 ? 'pos' : 'neg') + '">' + D.fmtPctSigned(r.miningRoi) + '</td>'
        + '<td class="' + (r.dailyProfit >= 0 ? 'pos' : 'neg') + '">' + D.fmtUSD(r.dailyProfit, 2) + '</td></tr>';
    }).join('');
    $('chartElec').innerHTML = C.elecSens(res, elec);
  }

  /* ---------------- assumptions ---------------- */
  function renderAssumptions(res) {
    var S = res.summary, F = res.current;
    var h = MARKET.next_halving_est_date;
    var list = [
      I18N.t('asm.1'),
      I18N.t('asm.2prefix') + ' (1+g)^(1/12) − 1 = ' + D.fmtPct(res.monthlyGrowth.hashrate, 3) + '.',
      I18N.t('asm.3prefix') + ' (' + D.fmtNum(res.input.blockHeight, 0) + ' → ' + D.fmtNum(res.input.nextHalvingHeight, 0) + '), ' + I18N.t('asm.3suffix') + ' ' + h + '.',
      I18N.t('asm.4'),
      I18N.t('asm.5'),
      I18N.t('asm.6prefix') + ' ' + D.fmtPct(res.input.poolFee) + '.',
      I18N.t('asm.7'),
      I18N.t('asm.8')
    ];
    $('assumptions').innerHTML = list.map(function (t) { return '<div>' + t + '</div>'; }).join('');

    var U = MARKET.sources || {};
    $('dataSrc').innerHTML =
      srcRow(I18N.t('data.btcPrice'), D.fmtUSD(liveValue('btcPrice')), U.btc_price_usd)
      + srcRow(I18N.t('data.hashrate'), D.fmtEH(liveValue('networkHashrate')) + ' EH/s', U.network_hashrate_ehs)
      + srcRow(I18N.t('data.difficulty'), (MARKET.difficulty / 1e12).toFixed(2) + ' T', U.difficulty)
      + srcRow(I18N.t('data.blockHeight'), D.fmtNum(MARKET.block_height, 0), U.block_height)
      + srcRow(I18N.t('data.subsidy'), MARKET.block_subsidy_btc + ' BTC', I18N.t('data.halvingSched'))
      + '<div class="scn-row"><span>' + I18N.t('data.snapshot') + '</span><b>' + MARKET.asof_utc.replace('T', ' ').replace('Z', ' UTC') + '</b></div>';

    function srcRow(k, v, s) {
      return '<div class="scn-row"><span>' + k + ' <em style="font-style:normal;color:var(--tx-4)">· ' + s + '</em></span><b>' + v + '</b></div>';
    }

    $('formulas').innerHTML = [
      [I18N.t('fx.btcPerTh'), I18N.t('fx.btcPerTh.d')],
      [I18N.t('fx.minerBtc'), I18N.t('fx.minerBtc.d')],
      [I18N.t('fx.elec'), I18N.t('fx.elec.d')],
      [I18N.t('fx.machine'), I18N.t('fx.machine.d')],
      [I18N.t('fx.total'), I18N.t('fx.total.d')],
      [I18N.t('fx.revenue'), I18N.t('fx.revenue.d')],
      [I18N.t('fx.profit'), I18N.t('fx.profit.d')],
      [I18N.t('fx.shutdown'), I18N.t('fx.shutdown.d')],
      [I18N.t('fx.ratio'), I18N.t('fx.ratio.d')],
      [I18N.t('fx.payback'), I18N.t('fx.payback.d')],
      [I18N.t('fx.paybackTarget'), I18N.t('fx.paybackTarget.d')],
      [I18N.t('fx.prodCost'), I18N.t('fx.prodCost.d')],
      [I18N.t('fx.miningSpot'), I18N.t('fx.miningSpot.d')]
    ].map(function (f) {
      return '<div class="f"><code>' + f[0] + '</code><span>' + f[1] + '</span></div>';
    }).join('');
  }

  /* ---------------- URL ---------------- */
  function baseInput() {
    var inp = Object.assign({}, state.inputs);
    inp.btcPrice = liveValue('btcPrice');
    inp.networkHashrateEhs = liveValue('networkHashrate');
    return inp;
  }
  function syncUrl() {
    var q = E.toQuery(state.inputs);
    var url = location.pathname + (q ? '?' + q : '') + location.hash;
    history.replaceState(null, '', url);
    $('shareUrl').value = location.origin + location.pathname + (q ? '?' + q : '');
  }

  /* Hand the engine a hook so `lang` rides along in the share link without the
     engine ever having to know that a UI locale exists. */
  E.toQuery.onPair = function () {
    return ['lang=' + encodeURIComponent(I18N.current)];
  };

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 1900);
  }

  /* ======================================================================
   * INPUT BINDING
   * ====================================================================== */
  var PCT_KEYS = { uptime: 1, poolFee: 1, hashrateGrowthAnnual: 1, btcGrowthAnnual: 1 };

  /* Fields shown — and quantised — to a fixed number of decimals. The
     electricity price is quoted in fractions of a cent ($0.06 vs $0.055), so it
     is a three-decimal field: the number on screen is the number the model used,
     with no invisible fourth decimal hiding behind it. */
  var INPUT_DECIMALS = { electricityPrice: 3 };

  /* Repaint callbacks for the Live/Manual switches, so any code path that flips
     `state.live` behind the user's back can refresh the header controls. */
  var manualPaints = [];

  function initInputs() {
    /* miner select */
    var sel = document.querySelector('select[data-k="minerKey"]');
    sel.innerHTML = D.MINERS.map(function (m) {
      return '<option value="' + m.key + '">' + m.name + (m.note && m.note !== 'manual' ? ' · ' + I18N.t('cool.' + m.note) : '') + '</option>';
    }).join('');
    sel.value = state.inputs.minerKey;
    bindMiner(sel);

    /* number fields */
    document.querySelectorAll('input[data-k]').forEach(function (el) {
      bindNum(el);
    });
    document.querySelectorAll('input[data-manual]').forEach(function (el) {
      bindManual(el);
    });

    /* Price per TH — a reciprocal view of machinePrice (see paintPricePerTh).
       Editing it writes the product back into machinePrice and repaints the
       machine-price box live; the field itself re-normalises on blur. */
    var pth = document.getElementById('pricePerThIn');
    if (pth) {
      var commitPth = function () {
        var raw = parseFloat(pth.value);
        var h = state.inputs.hashrate;
        if (!isFinite(raw) || !isFinite(h) || h <= 0) { paintPricePerTh(); return; }
        state.inputs.machinePrice = raw * h;
        var mp = document.querySelector('input[data-k="machinePrice"]');
        if (mp) mp.value = paintValue('machinePrice', state.inputs.machinePrice);
        render();
      };
      pth.addEventListener('input', commitPth);
      pth.addEventListener('change', commitPth);
      pth.addEventListener('blur', paintPricePerTh);
    }

    /* Rack date. A date input carries a string, not a number, so it cannot ride
       through `bindNum` — it gets its own binding. The value is the anchor the
       whole calendar horizon hangs off, so it goes straight into the inputs and
       out to the share link. */
    document.querySelectorAll('input[data-date]').forEach(function (el) {
      var commit = function () {
        var v = String(el.value || '').trim();
        if (!E.parseISODate(v)) { el.value = state.inputs.rackDate; return; }
        state.inputs.rackDate = v;
        render();
      };
      el.addEventListener('change', commit);
      el.addEventListener('blur', function () { el.value = state.inputs.rackDate; });
    });

    /* info drawers */
    document.querySelectorAll('.info').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var target = document.getElementById(b.dataset.drawer);
        if (target) target.classList.toggle('on');
      });
    });

    /* reset / copy */
    $('btnReset').addEventListener('click', function () {
      state.inputs = Object.assign({}, D.DEFAULTS);
      state.manual = { btcPrice: null, networkHashrate: null };
      state.live = { btcPrice: true, networkHashrate: true };
      hydrateInputs();
      manualPaints.forEach(function (fn) { fn(); });
      render();
      toast(I18N.t('toast.reset'));
    });
    $('btnCopy').addEventListener('click', function () {
      var el = $('shareUrl');
      el.select();
      try {
        navigator.clipboard.writeText(el.value).then(function () { toast(I18N.t('toast.copied')); },
          function () { document.execCommand('copy'); toast(I18N.t('toast.copied')); });
      } catch (e) { document.execCommand('copy'); toast(I18N.t('toast.copied')); }
    });
  }

  function bindNum(el) {
    var k = el.dataset.k;
    var scale = PCT_KEYS[k] ? 100 : 1;
    var commit = function () {
      var raw = parseFloat(el.value);
      if (!isFinite(raw)) { el.value = paintValue(k, state.inputs[k] * scale); return; }
      if (PCT_KEYS[k]) raw = Math.max(0, Math.min(100, raw));
      var dec = INPUT_DECIMALS[k];
      if (dec !== undefined) raw = Number(raw.toFixed(dec));
      state.inputs[k] = raw / scale;
      if (k === 'btcPrice') state.manual.btcPrice = raw;
      if (k === 'networkHashrateEhs') state.manual.networkHashrate = raw;
      render();
    };
    el.addEventListener('input', commit);
    el.addEventListener('change', commit);
    el.addEventListener('blur', function () { el.value = paintValue(k, state.inputs[k] * scale); });
  }

  /* The single entry point for putting a value INTO an input box, so a field's
     precision cannot be applied on load but forgotten on blur (or vice versa). */
  function paintValue(k, v) {
    var dec = INPUT_DECIMALS[k];
    return dec === undefined ? roundInput(v) : (isFinite(v) ? v.toFixed(dec) : v);
  }

  function roundInput(v) {
    if (!isFinite(v)) return v;
    if (Math.abs(v) >= 1000) return Math.round(v);
    if (Math.abs(v) >= 10) return Math.round(v * 100) / 100;
    return Math.round(v * 10000) / 10000;
  }

  /* Price per TH is a reciprocal view of machinePrice, not a model input: the
     engine reads `machinePrice` only. Repaint it from the canonical
     machinePrice ÷ hashrate so any edit to price or hashrate keeps it in step.
     Skipped while the field is focused so typing is never clobbered. */
  function paintPricePerTh() {
    var el = document.getElementById('pricePerThIn');
    if (!el) return;
    if (document.activeElement === el) return;
    var h = state.inputs.hashrate;
    var v = isFinite(h) && h > 0 ? state.inputs.machinePrice / h : NaN;
    el.value = isFinite(v) ? roundInput(v) : '';
  }

  /* The miner picker is the one control in the form that is not an `<input>`,
     which is exactly how it stayed unwired: the generic binder below walks
     `input[data-k]`, and a `<select>` is not one. It rendered, carried the right
     label and the right options, and did nothing when changed — only the
     "switch to hydro unit" preset button ever reached the catalogue, so
     removing that button removed the whole catalogue with it.
     Picking a model does two things: records WHICH model (that value rides in
     the share link) and copies its specs into the three numeric fields.
     "Custom / 自定义" carries no specs, so it only records the choice — that is
     what "pick a model or enter your own" has always claimed. */
  function bindMiner(sel) {
    sel.addEventListener('change', function () {
      state.inputs.minerKey = sel.value;
      applyMiner(sel.value);
      hydrateInputs();
      render();
    });
  }

  function bindManual(el) {
    var which = el.dataset.manual;
    var btn = document.querySelector('[data-live="' + which + '"]');
    function paint() {
      var isLive = state.live[which];
      btn.classList.toggle('on', isLive);
      btn.textContent = isLive ? I18N.t('live.live') : I18N.t('live.manual');
      var dotEl = document.querySelector('[data-dot="' + which + '"]');
      if (dotEl) {
        dotEl.className = 'dot ' + (isLive ? 'live' : 'manual');
        var lab = document.querySelector('[data-livlab="' + which + '"]');
        if (lab) lab.textContent = isLive ? I18N.t('live.live') + ' · ' + D.agoText(MARKET.asof_utc) : I18N.t('live.override');
      }
      el.disabled = isLive;
    }
    btn.addEventListener('click', function () {
      state.live[which] = !state.live[which];
      if (state.live[which]) {
        el.value = which === 'btcPrice' ? MARKET.btc_price_usd : MARKET.network_hashrate_ehs;
        render(); // live value feeds the model
      } else {
        var cur = which === 'btcPrice' ? liveValue('btcPrice') : liveValue('networkHashrate');
        el.value = roundInput(cur);
        if (which === 'btcPrice') state.manual.btcPrice = cur; else state.manual.networkHashrate = cur;
      }
      paint();
    });
    /* Programmatic state changes (reset) also have to repaint the switch,
       otherwise the header keeps showing a stale "Manual" label while the model
       is already back on live values. */
    manualPaints.push(paint);
    paint();
  }

  /* Applying a catalogue entry to the numeric fields. Called by `bindMiner`
     when the model picker changes. A "custom" entry carries no specs, so this
     leaves the numbers where the user put them. */
  function applyMiner(key) {
    var m = D.findMiner(key);
    if (!m || m.hashrate === null) return;
    state.inputs.hashrate = m.hashrate;
    state.inputs.power = m.power;
    state.inputs.machinePrice = m.price;
  }

  /* ---------------- hydrate DOM from state ---------------- */
  function hydrateInputs() {
    document.querySelectorAll('input[data-k]').forEach(function (el) {
      var k = el.dataset.k;
      var scale = PCT_KEYS[k] ? 100 : 1;
      var v = state.inputs[k];
      if (k === 'btcPrice') v = liveValue('btcPrice');
      if (k === 'networkHashrateEhs') v = liveValue('networkHashrate');
      el.value = paintValue(k, v * scale);
      el.classList.add('flash');
      setTimeout(function () { el.classList.remove('flash'); }, 520);
    });
    var sel = document.querySelector('select[data-k="minerKey"]');
    if (sel) sel.value = state.inputs.minerKey;
    var rd = document.querySelector('input[data-date="rackDate"]');
    if (rd) rd.value = state.inputs.rackDate;
    var b = document.querySelector('input[data-manual="btcPrice"]');
    var nb = document.querySelector('input[data-manual="networkHashrate"]');
    if (b) b.disabled = state.live.btcPrice;
    if (nb) nb.disabled = state.live.networkHashrate;
  }

  function refreshDerived() {
    var eff = E.efficiency(state.inputs.power, state.inputs.hashrate);
    var effTxt = eff === null ? D.tr('na.value', 'N/A') : eff.toFixed(2);
    $('effOut').value = effTxt;
    $('lifeDaysOut').value = D.fmtNum(state.inputs.lifeYears * 365, 0);
    paintPricePerTh();

    var a = state.inputs.hashrateGrowthAnnual;
    var m = a <= -1 ? -1 : Math.pow(1 + a, 1 / 12) - 1;
    $('mrOut').value = (m * 100).toFixed(2);

    /* drawer live values */
    set('dEffP', D.fmtNum(state.inputs.power, 0) + ' W');
    set('dEffH', D.fmtNum(state.inputs.hashrate, 0) + ' TH/s');
    set('dEffR', effTxt + ' J/TH');

    var res = state.result;
    if (res) {
      var F = res.current;
      set('dElP', D.fmtNum(state.inputs.power, 0) + ' W');
      set('dElR', '$' + Number(state.inputs.electricityPrice).toFixed(4) + ' ' + I18N.t('unit.perKwh'));
      set('dElU', D.fmtPct(state.inputs.uptime));
      set('dElC', D.fmtUSD(F.dailyElectricity, 2) + ' ' + I18N.t('unit.perDay'));
      set('dHalvH', D.fmtNum(state.inputs.blockHeight, 0));
      set('dHalvR', D.fmtNum(Math.max(0, state.inputs.nextHalvingHeight - state.inputs.blockHeight), 0) + ' ' + D.tr('unit.blocks','blocks'));
      set('dHalvD', estimateHalvingDate(state.inputs.blockHeight, state.inputs.nextHalvingHeight));
    }
    function set(id, v) { var el = $(id); if (el) el.textContent = v; }
  }

  /** blocks remaining ÷ 144 blocks/day → calendar date */
  function estimateHalvingDate(height, nextHeight) {
    var days = Math.max(0, (nextHeight - height)) / 144;
    var d = new Date(Date.now() + days * 86400000);
    var t = d.toISOString().slice(0, 10);
    if (MARKET && MARKET.next_halving_est_date && nextHeight === MARKET.next_halving_height) return MARKET.next_halving_est_date + ' ' + D.tr('time.snapshot','(snapshot)');
    return t + ' ' + D.tr('time.est','(est.)');
  }

  /* ======================================================================
   * THEME POPOVER
   * ====================================================================== */
  function initTheme() {
    var pop = $('themePop');
    var trig = $('themeBtn');
    document.body.appendChild(pop);
    document.documentElement.classList.add('theme-portal-ready');

    pop.innerHTML = '<div class="theme-lab">' + I18N.t('theme.label') + '</div>' + THEMES.map(function (t) {
      return '<button type="button" role="menuitemradio" data-theme="' + t.key + '" aria-checked="false">'
        + '<span class="g">' + t.glyph + '</span>' + I18N.t('theme.' + t.key) + '<span class="ck">✓</span></button>';
    }).join('');

    var saved = 'light';
    try { saved = localStorage.getItem(TKEY) || 'light'; } catch (e) { }
    if (!THEMES.some(function (t) { return t.key === saved; })) saved = 'light';
    applyTheme(saved, false);

    function placePop() {
      if (window.matchMedia('(max-width: 640px)').matches) return;
      var r = trig.getBoundingClientRect();
      var pr = pop.getBoundingClientRect();
      var left = Math.min(window.innerWidth - pr.width - 12, Math.max(12, r.right - pr.width));
      pop.style.left = left + 'px';
      pop.style.top = (r.bottom + 8) + 'px';
      pop.style.right = 'auto';
      pop.style.bottom = 'auto';
    }
    function isOpen() { return pop.classList.contains('on'); }
    function open() { pop.classList.add('on'); placePop(); }
    function close() { pop.classList.remove('on'); }

    trig.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) close(); else open();
    });
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { if (isOpen()) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', function () { if (isOpen()) placePop(); });
    window.addEventListener('scroll', function () { if (isOpen()) placePop(); }, true);

    document.querySelectorAll('#themePop button').forEach(function (b) {
      b.setAttribute('aria-checked', b.dataset.theme === saved ? 'true' : 'false');
      b.addEventListener('click', function () {
        applyTheme(b.dataset.theme, true);
        close();
        toast(I18N.t('theme.label') + ': ' + I18N.t('theme.' + b.dataset.theme));
      });
    });
    /* Repaint the popover through the shared language hook so the heading and
       theme names flip with the locale. */
    langPaints.push(function () {
      pop.querySelector('.theme-lab').textContent = I18N.t('theme.label');
      pop.querySelectorAll('button').forEach(function (b) {
        b.childNodes[2].nodeValue = I18N.t('theme.' + b.dataset.theme);
      });
      var tb = $('themeBtn'); if (tb) tb.setAttribute('aria-label', I18N.t('theme.aria'));
    });
  }

  /* ======================================================================
   * LANGUAGE POPOVER  (spec §45 discipline applied to locale)
   *
   * Switching locale must behave like switching theme: no reload, no input
   * loss, no recomputation. It is a re-label, not a re-run — `applyLanguage()`
   * therefore re-renders from the *existing* `state.result` and never touches
   * `state.inputs` or the model params in the URL.
   * ====================================================================== */
  var I18N = window.I18N;
  var langPaints = [];

  /** Static markup: rewrite text and the attributes listed in data-i18n-attr. */
  function relabelDom() {
    /* Copy may carry the "{n}" horizon token (a 3-year machine must not read
       "48 months, hashrate-adjusted"), so every static label is filled with the
       current life span before it lands. */
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var v = I18N.t(el.getAttribute('data-i18n'));
      if (v !== undefined) el.textContent = I18N.fill(v, horizonYears());
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      /* format: "placeholder:key,aria-label:key2" */
      el.getAttribute('data-i18n-attr').split(',').forEach(function (pair) {
        var i = pair.indexOf(':');
        if (i < 0) return;
        var attr = pair.slice(0, i).trim();
        var key = pair.slice(i + 1).trim();
        if (attr && key) el.setAttribute(attr, I18N.fill(I18N.t(key), horizonYears()));
      });
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', I18N.fill(I18N.t(el.getAttribute('data-i18n-title')), horizonYears()));
    });
    /* The two popovers and the select options are built in JS, so they carry
       no data-i18n attributes — repaint them through their own callbacks. */
    langPaints.forEach(function (fn) { fn(); });
  }

  function applyLanguage(lang, announce) {
    if (I18N.SUPPORTED.indexOf(lang) < 0) lang = I18N.DEFAULT_LANG;
    I18N.current = lang;
    I18N.persist(lang);

    var meta = I18N.localeMeta(lang);
    document.documentElement.setAttribute('lang', meta.html);
    var lab = $('langLabel'); if (lab) lab.textContent = meta.label;
    var lb = $('langBtn'); if (lb) lb.setAttribute('aria-label', I18N.t('lang.aria'));

    relabelDom();

    /* Chart axis titles, legends and tick units are baked into the SVG string,
       so a locale change has to rebuild them — geometry is identical because
       the engine output is untouched. */
    if (state.result) {
      renderCharts(state.result);
      renderSensitivity(state.result);
    }

    /* Re-render derived readouts from the result we already have. If the model
       has not run yet (language applied during boot) this is skipped — start()
       will render immediately afterwards. */
    if (state.result) {
      render();
    } else {
      refreshDerived();
    }

    if (announce) toast(I18N.t('toast.lang') + ': ' + meta.label);
  }

  function initLang() {
    var pop = $('langPop');
    var trig = $('langBtn');
    if (!pop || !trig) return;
    document.body.appendChild(pop);

    function paintPop() {
      pop.innerHTML = '<div class="theme-lab">' + I18N.t('lang.label') + '</div>' + I18N.LOCALES.map(function (l) {
        return '<button type="button" role="menuitemradio" data-lang="' + l.key + '" aria-checked="false">'
          + '<span class="g">' + l.short + '</span>' + l.label + '<span class="ck">✓</span></button>';
      }).join('');
      pop.querySelectorAll('button').forEach(function (b) {
        b.setAttribute('aria-checked', b.dataset.lang === I18N.current ? 'true' : 'false');
      });
    }
    /* Re-painted on every language change so the popover heading and the
       checkmark follow the new locale. */
    langPaints.push(paintPop);
    paintPop();

    function placePop() {
      if (window.matchMedia('(max-width: 640px)').matches) return;
      var r = trig.getBoundingClientRect();
      var pr = pop.getBoundingClientRect();
      var left = Math.min(window.innerWidth - pr.width - 12, Math.max(12, r.right - pr.width));
      pop.style.left = left + 'px';
      pop.style.top = (r.bottom + 8) + 'px';
      pop.style.right = 'auto';
      pop.style.bottom = 'auto';
    }
    function isOpen() { return pop.classList.contains('on'); }
    function open() { pop.classList.add('on'); trig.setAttribute('aria-expanded', 'true'); placePop(); }
    function close() { pop.classList.remove('on'); trig.setAttribute('aria-expanded', 'false'); }

    trig.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isOpen()) close(); else open();
    });
    /* Delegated: `paintPop()` replaces the buttons, so per-button listeners
       would be lost on the first switch. */
    pop.addEventListener('click', function (e) {
      e.stopPropagation();
      var b = e.target.closest ? e.target.closest('button[data-lang]') : null;
      if (!b) return;
      applyLanguage(b.dataset.lang, true);
      syncUrl();
      close();
    });
    document.addEventListener('click', function () { if (isOpen()) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', function () { if (isOpen()) placePop(); });
    window.addEventListener('scroll', function () { if (isOpen()) placePop(); }, true);
  }

  /* ======================================================================
   * CHART TOOLTIPS
   * ====================================================================== */
  function initTips() {
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    document.body.appendChild(tip);

    document.addEventListener('pointerover', function (e) {
      var g = e.target.closest ? e.target.closest('g.hot') : null;
      if (!g) return;
      var label = g.getAttribute('data-label') || '';
      var value = g.getAttribute('data-value') || '';
      var color = g.getAttribute('data-color') || 'var(--accent)';
      tip.innerHTML = '<span style="color:var(--tx-3)">' + label + '</span>'
        + '<b style="color:' + color + '">' + value.replace(/ · /g, '<br>') + '</b>';
      tip.classList.add('on');
      moveTip(e);
    });
    document.addEventListener('pointermove', function (e) {
      if (tip.classList.contains('on')) moveTip(e);
    });
    document.addEventListener('pointerout', function (e) {
      var g = e.target.closest ? e.target.closest('g.hot') : null;
      if (g) tip.classList.remove('on');
    });

    function moveTip(e) {
      var pad = 14;
      var w = tip.offsetWidth, h = tip.offsetHeight;
      var x = e.clientX + pad, y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
      tip.style.left = Math.max(8, x) + 'px';
      tip.style.top = Math.max(8, y) + 'px';
    }
  }

  /* ======================================================================
   * BOOT
   * ====================================================================== */
  function boot() {
    /* The snapshot is embedded in index.html so the model works from file://
       (where fetch is blocked by CORS). We still try the JSON so a refreshed
       data/market.json takes precedence when served over http(s). */
    var embedded = window.__MARKET_FALLBACK__;
    var canFetch = location.protocol === 'http:' || location.protocol === 'https:';

    if (!canFetch) {
      MARKET = embedded;
      start();
      return;
    }
    fetch('data/market.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) { MARKET = j; start(); })
      .catch(function () {
        MARKET = embedded;
        start();
        var s = $('dataStatus');
        if (s && s.querySelector('.txt')) {
          s.querySelector('.txt').textContent = I18N.t('status.offline');
          s.querySelector('.dot').className = 'dot stale';
        }
      });
  }

  function start() {
    /* Locale first: the data-status line, "N/A" placeholders and every label
       below are produced in the active language, so resolving it after the
       first render would flash English. `E.fromQueryExtra` reads `lang` as a
       presentation param — it is deliberately NOT part of `state.inputs`. */
    var extra = E.fromQueryExtra(location.search);
    var lang = (extra.lang && I18N.SUPPORTED.indexOf(extra.lang) >= 0)
      ? extra.lang                     /* explicit share link wins */
      : I18N.detect();                 /* else saved choice, else browser */
    applyLanguage(lang, false);

    /* URL overrides */
    var urlInputs = E.fromQuery(location.search, {});
    Object.keys(urlInputs).forEach(function (k) {
      if (k in state.inputs) state.inputs[k] = urlInputs[k];
    });
    /* clamps for hostile URLs */
    state.inputs.uptime = Math.max(0, Math.min(1, state.inputs.uptime));
    state.inputs.poolFee = Math.max(0, Math.min(1, state.inputs.poolFee));
    state.inputs.lifeYears = Math.max(0.5, Math.min(20, state.inputs.lifeYears));
    /* The horizon IS the service life — one input, not two. Kept in sync here so
       the monthly detail table, the charts and the depreciation basis can
       never be laid out over different spans. */
    state.inputs.months = Math.round(state.inputs.lifeYears * 12);
    /* Anchored to today unless the link pinned a date: without an anchor the
       horizon would silently slide forward every midnight. */
    if (!E.parseISODate(state.inputs.rackDate)) state.inputs.rackDate = E.toISODate(new Date());

    /* live values: adopt snapshot unless URL pinned them */
    state.manual.btcPrice = MARKET.btc_price_usd;
    state.manual.networkHashrate = MARKET.network_hashrate_ehs;
    if (!('btcPrice' in urlInputs)) state.inputs.btcPrice = MARKET.btc_price_usd;
    if (!('networkHashrateEhs' in urlInputs)) state.inputs.networkHashrateEhs = MARKET.network_hashrate_ehs;
    if (!('nextHalvingHeight' in urlInputs)) {
      state.inputs.nextHalvingHeight = E.nextHalvingHeight(MARKET.block_height, MARKET.blocks_per_halving);
    }
    if (!('blockHeight' in urlInputs)) state.inputs.blockHeight = MARKET.block_height;
    if (!('blockSubsidy' in urlInputs)) state.inputs.blockSubsidy = MARKET.block_subsidy_btc;

    /* header status */
    var st = $('dataStatus');
    if (st) {
      st.querySelector('.dot').className = 'dot live';
      st.querySelector('.txt').textContent = I18N.t('status.live') + ' · ' + D.agoText(MARKET.asof_utc);
      st.title = 'Snapshot ' + MARKET.asof_utc + '\nBTC price: ' + (MARKET.sources ? MARKET.sources.btc_price_usd : '') +
        '\nHashrate: ' + (MARKET.sources ? MARKET.sources.network_hashrate_ehs : '');
    }

    initLang();
    initTheme();
    initInputs();
    initTips();
    hydrateInputs();
    refreshDerived();
    /* Re-label once more now that every JS-built surface (select options,
       popovers, manual switches) exists. */
    langPaints.forEach(function (fn) { fn(); });
    render();
    syncUrl();
    state.didInitialRender = true;
  }

  /* keep derived readouts in sync on every render */
  var _render = render;
  render = function () {
    _render();
    refreshDerived();
  };

  /* QA handle — lets the headless suites drive state without simulating DOM
     events, and reset cleanly between cases. Not used by the app itself.
     Assigned by boot() once state exists, and refreshed here so an early
     script evaluation (before DOMContentLoaded) still gets a live handle. */
  window.__model = {
    get state() { return state; },
    get render() { return render; },
    engine: E,
    set: function (key, value) {
      /* live-backed keys are driven by MARKET unless the user flips to Manual —
         mirror that rule here so programmatic writes behave like real input */
      if (key === 'btcPrice') { state.live.btcPrice = false; state.manual.btcPrice = value; }
      else if (key === 'networkHashrateEhs') { state.live.networkHashrate = false; state.manual.networkHashrate = value; }
      else { state.inputs[key] = value; }
      hydrateInputs();
      manualPaints.forEach(function (fn) { fn(); });
      render();
      return value;
    },
    resetToLive: function () {
      state.inputs = Object.assign({}, D.DEFAULTS);
      state.live = { btcPrice: true, networkHashrate: true };
      state.manual = { btcPrice: null, networkHashrate: null };
      hydrateInputs();
      refreshDerived();
      manualPaints.forEach(function (fn) { fn(); });
      render();
      return state.inputs;
    },
    read: function () { return state.result; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
