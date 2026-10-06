/* ==========================================================================
 * Bitcoin Mining Cost Model — Calculation Engine
 * Pure functions. No DOM. No render. Independently testable.
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiningEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BLOCKS_PER_DAY = 144;
  /* Nominal month, used only where a horizon is quoted as "N months" rather
     than anchored to a date (the §15 payback targets). The simulation grid
     does NOT use this: it walks real calendar months from the rack date, so a
     February carries 28 days and a January 31, and four years is 1461 days
     rather than 1440. */
  var DAYS_PER_MONTH = 30;
  var DAYS_PER_YEAR = 365;
  var MONTHS = 48;
  var MS_PER_DAY = 86400000;

  /* ---------- helpers ---------- */
  function num(v, d) { v = Number(v); return isFinite(v) ? v : (d === undefined ? 0 : d); }
  function safeDiv(a, b) { b = num(b); return b === 0 || !isFinite(b) ? null : num(a) / b; }
  function clamp01(v) { return Math.max(0, Math.min(1, num(v))); }

  /** Compound growth over a period expressed in months, given an annual rate. */
  function periodsToAnnual(rate, months) {
    return Math.pow(1 + num(rate), months / 12) - 1;
  }
  function monthlyFromAnnual(annual) {
    // (1+g)^(1/12) - 1 ; guarded for annual <= -1
    var a = num(annual);
    if (a <= -1) return -1;
    return Math.pow(1 + a, 1 / 12) - 1;
  }
  /** Compound growth per day, given an annual rate. The simulation compounds
   *  this by each window's real day count, so a 31-day month grows more than a
   *  28-day one instead of both being treated as "one month". */
  function dailyFromAnnual(annual) {
    var a = num(annual);
    if (a <= -1) return -1;
    return Math.pow(1 + a, 1 / DAYS_PER_YEAR) - 1;
  }

  /* ---------- calendar ----------
     A mining cost statement is anchored to the day the machine is racked, so
     the projection walks real calendar months instead of a flat 30-day
     convention. Everything below is date arithmetic only — no hardcoded
     halving date ever enters: the halving is found from the block height, and
     the height is what advances the subsidy. */

  /** 'YYYY-MM-DD' → local midnight Date, or null when unparseable. */
  function parseISODate(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s === undefined || s === null ? '' : s).trim());
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var out = new Date(y, mo - 1, d);
    if (!isFinite(out.getTime()) || out.getMonth() !== mo - 1 || out.getDate() !== d) return null;
    return out;
  }
  function toISODate(d) {
    var mo = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (mo < 10 ? '0' + mo : mo) + '-' + (day < 10 ? '0' + day : day);
  }
  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  /** Month arithmetic that clamps instead of rolling over (Jan 31 + 1M → Feb 28). */
  function addMonths(d, n) {
    var y = d.getFullYear(), mo = d.getMonth() + n, day = d.getDate();
    var lastDay = new Date(y, mo + 1, 0).getDate();
    return new Date(y, mo, Math.min(day, lastDay));
  }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

  /**
   * Billing windows anchored on the rack date: window k spans
   * [rack + k months, rack + (k+1) months). Exactly `months` windows covering
   * exactly `months` calendar months — so a 4-year life is 1461 days, and every
   * window carries its own real day count into production and electricity.
   */
  function monthWindows(start, months) {
    var out = [];
    for (var k = 0; k < months; k++) {
      var a = addMonths(start, k), b = addMonths(start, k + 1);
      out.push({ index: k + 1, start: a, end: b, days: daysBetween(a, b) });
    }
    return out;
  }

  /* ---------- derived helpers ---------- */

  /** Efficiency J/TH = Power(W) / Hashrate(TH/s) */
  function efficiency(power, hashrateTh) {
    var h = num(hashrateTh);
    return h <= 0 ? null : num(power) / h;
  }

  /** Block subsidy for a given height (halving every 210,000 blocks) */
  function blockSubsidy(height, genesisSubsidy, blocksPerHalving) {
    genesisSubsidy = num(genesisSubsidy, 50);
    blocksPerHalving = num(blocksPerHalving, 210000);
    var era = Math.floor(Math.max(0, num(height)) / blocksPerHalving);
    return genesisSubsidy / Math.pow(2, era);
  }

  /**
   * Dynamic (market-wide) halving: if the user did not override the next
   * halving date, infer the next halving height from the current height.
   */
  function nextHalvingHeight(height, blocksPerHalving) {
    blocksPerHalving = num(blocksPerHalving, 210000);
    return (Math.floor(Math.max(0, num(height)) / blocksPerHalving) + 1) * blocksPerHalving;
  }

  /* ======================================================================
   * A. CURRENT-DAY ECONOMICS  (spec §11)
   * ====================================================================== */
  function computeCurrent(I) {
    var I_ = I;
    var F = {};
    F.btcPrice = num(I_.btcPrice);
    F.networkHashrateEhs = num(I_.networkHashrateEhs);   /* echo for chart baselines */

    F.efficiency_jth = efficiency(I_.power, I_.hashrate);
    /* Nominal service life, kept at a flat ×365 on purpose: it is the guard
       that asks "could this hardware ever reach that payback day", not a date.
       The simulated horizon is the calendar one (rack date + N months) and can
       exceed this by a leap day — 1461 days against 1460 for a 4-year life. */
    F.serviceLifeDays = num(I_.lifeYears, 4) * DAYS_PER_YEAR;

    /* 11.1 BTC per TH per day = subsidy * 144 / (networkHashrateEH * 1e6) */
    var netTh = num(I_.networkHashrateEhs) * 1e6;
    F.btcPerThDay = safeDiv(num(I_.blockSubsidy) * BLOCKS_PER_DAY, netTh) || 0;

    /* 11.2 Miner BTC/day = btcPerThDay * hashrate * uptime * (1 - poolFee) */
    F.minerBtcDay = F.btcPerThDay * num(I_.hashrate) * clamp01(I_.uptime) * (1 - clamp01(I_.poolFee));
    F.minerBtcEffectiveDay = F.btcPerThDay * num(I_.hashrate) * clamp01(I_.uptime); // pre-fee

    /* 11.3 Daily electricity = power/1000 * 24 * price * uptime */
    F.dailyElectricity = num(I_.power) / 1000 * 24 * num(I_.electricityPrice) * clamp01(I_.uptime);

    /* 11.4 Daily machine cost = machinePrice / serviceLifeDays (straight-line) */
    F.dailyMachineCost = safeDiv(num(I_.machinePrice), F.serviceLifeDays) || 0;

    /* Two cost bases coexist here and must never be silently mixed:
         CASH  electricity only. A machine that is already bought is a sunk
               cost, so capex cannot influence the on/off decision (§12).
         FULL  electricity + straight-line depreciation — the accounting cost
               of producing one coin, and the basis of the all-in cost/BTC.
       Both are always published so callers pick a basis explicitly instead of
       inheriting one by accident. */
    F.dailyCashCost = F.dailyElectricity;
    F.dailyFullCost = F.dailyMachineCost + F.dailyElectricity;

    /* 11.5 Daily total cost. "Cost" in this model means ALL-IN — the same basis
       the cost/BTC headline and the 4-year summary use. The cash line lives in
       `dailyCashCost`, the full break-even in `cashShutdownPrice`'s twin below. */
    F.dailyTotalCost = F.dailyFullCost;

    /* 11.6 Daily revenue */
    F.dailyRevenue = F.minerBtcDay * num(I_.btcPrice);

    /* 11.7 Daily net profit — FULL basis, so it agrees with the all-in cost/BTC
       headline and with `summary.netProfit`. The operating cash figure the
       shutdown decision actually turns on is reported as `dailyCashNetProfit`. */
    F.dailyNetProfit = F.dailyRevenue - F.dailyFullCost;
    F.dailyCashNetProfit = F.dailyRevenue - F.dailyCashCost;

    /* §12 Shutdown BTC price. `simulate` reports the CASH break-even here
       (revenue vs electricity); the full-cost break-even stays available so the
       two lines are never conflated. */
    F.shutdownPrice = safeDiv(F.dailyFullCost, F.minerBtcDay);
    F.cashShutdownPrice = safeDiv(F.dailyCashCost, F.minerBtcDay);

    /* §13 Cost ratio */
    F.costRatio = safeDiv(F.dailyTotalCost, F.dailyRevenue);

    /* §14 Static payback = machinePrice ÷ operating CASH flow. Depreciation is
       not a cash outflow, so it is excluded — otherwise the machine's own cost
       is charged twice: once as a daily cost, then again as the thing being
       repaid. A payback that outruns the machine's service life is not a
       payback, so it reports null instead of a date the hardware cannot
       reach. */
    var cashPayback = F.dailyCashNetProfit > 0
      ? safeDiv(num(I_.machinePrice), F.dailyCashNetProfit) : null;
    F.staticPaybackDays = (cashPayback !== null && cashPayback <= F.serviceLifeDays)
      ? cashPayback : null;

    /* §15 Required BTC price for target-day payback
     *     = (machinePrice/targetDays + dailyElectricity) / minerBtcDay */
    F.payback18 = paybackPrice(I_.machinePrice, 18 * DAYS_PER_MONTH, F.dailyElectricity, F.minerBtcDay);
    F.payback24 = paybackPrice(I_.machinePrice, 24 * DAYS_PER_MONTH, F.dailyElectricity, F.minerBtcDay);
    F.payback48 = paybackPrice(I_.machinePrice, 48 * DAYS_PER_MONTH, F.dailyElectricity, F.minerBtcDay);

    /* §29/30/31 unit-based metrics. "BTC buyable today" is deliberately NOT
       published here: the comparison that needs it (mining vs buy & hold) also
       funds the horizon's electricity, so its spot figure is horizon-shaped and
       lives on `vs.spotBtc`. One definition, in one place — a machine-only twin
       sitting on `current` would be read as the same number and be wrong for
       every horizon but one. */
    F.dailyRevenuePerBtc = F.minerBtcDay > 0 ? num(I_.btcPrice) : null;

    /* break-even electricity price at current BTC price (handy for sensitivity) */
    var maxPowerCost = F.minerBtcDay * num(I_.btcPrice) - F.dailyMachineCost;
    F.maxPowerCostDay = maxPowerCost;
    F.breakEvenElectricity = (num(I_.power) > 0 && clamp01(I_.uptime) > 0)
      ? safeDiv(maxPowerCost, (num(I_.power) / 1000 * 24 * clamp01(I_.uptime)))
      : null;

    return F;
  }

  function paybackPrice(machinePrice, targetDays, dailyElec, minerBtcDay) {
    if (!(minerBtcDay > 0) || !(targetDays > 0)) return null;
    return (num(machinePrice) / targetDays + num(dailyElec)) / minerBtcDay;
  }

  /* ======================================================================
   * B. 4-YEAR MONTHLY SIMULATION  (spec §16-§22)
   * ====================================================================== */
  function simulate(input) {
    /* Absent / non-finite inputs fall back to the shipped form defaults
       (scripts/data.js `DEFAULTS`), so a caller that knows only half the model
       still gets the model the page is showing. The two copies are pinned
       together by test_engine — a default edited in one place and not the other
       is invisible in both the page and the docs. */
    var I = {
      hashrate: num(input.hashrate, 305),
      power: num(input.power, 3355),
      machinePrice: num(input.machinePrice, 7700),
      lifeYears: num(input.lifeYears, 4),
      networkHashrateEhs: num(input.networkHashrateEhs, 957.97),
      blockSubsidy: num(input.blockSubsidy, 3.125),
      nextHalvingHeight: num(input.nextHalvingHeight, 1050000),
      blocksPerHalving: num(input.blocksPerHalving, 210000),
      blockHeight: num(input.blockHeight, 969947),
      hashrateGrowthAnnual: num(input.hashrateGrowthAnnual, 0.10),
      btcGrowthAnnual: num(input.btcGrowthAnnual, 0.20),
      electricityPrice: num(input.electricityPrice, 0.06),
      uptime: clamp01(input.uptime === undefined ? 0.95 : input.uptime),
      poolFee: clamp01(input.poolFee === undefined ? 0.01 : input.poolFee),
      btcPrice: num(input.btcPrice, 86431),
      exitPrice: num(input.exitPrice, 200000),
      /* The horizon IS the service life — one number, not two. A 4-year machine
         gets 48 windows; `months` is still accepted so a caller that only knows
         months keeps working. */
      months: Math.max(1, Math.round(
        input.lifeYears === undefined || input.lifeYears === null || input.lifeYears === ''
          ? num(input.months, MONTHS)
          : num(input.lifeYears) * 12
      )),
      /* When the machine goes live. Absent → today, which reproduces the old
         "months from now" behaviour. Everything calendar-shaped (day counts,
         block advance, the halving date) hangs off this one value. */
      rackDate: toISODate(midnight(parseISODate(input.rackDate) || new Date()))
    };

    /* `computeCurrent` already publishes both cost bases. The 4-year model
       changes exactly one thing: it reports the CASH break-even as
       `shutdownPrice`, because the machine is already bought — the on/off call
       compares revenue against electricity, not against the machine as well.
       Everything else stays on the full basis, so the all-in cost/BTC, the cost
       ratio and the net profit all agree with each other and with the summary.

       Capex enters the grid as straight-line depreciation spread over the
       horizon (see the monthly loop), so that
         Σ(monthly totalCost) == machinePrice + Σ(electricity) == summary.totalCost
       exactly — the annual table reconciles with the 4-year summary, and the
       running cost/BTC converges on the headline figure. Nothing is counted
       twice: the two bases are the same money, just placed at different times. */
    var F = computeCurrent(I);
    F.shutdownPrice = F.cashShutdownPrice;                     // §12 — cash break-even
    F.fullCostPerBtc = safeDiv(F.dailyFullCost, F.minerBtcDay); // all-in break-even line

    /* --- per-month loop --- */
    /* Two rates are reported: the monthly-equivalent (documented in the
       assumptions panel) and the daily one the loop actually compounds with.
       Windows are calendar months, so they are not equal lengths — compounding
       a flat monthly rate would let a 28-day February grow as much as a 31-day
       January. Over a whole life the annual total is identical either way. */
    var gH = monthlyFromAnnual(I.hashrateGrowthAnnual);
    var gP = monthlyFromAnnual(I.btcGrowthAnnual);
    var gHd = dailyFromAnnual(I.hashrateGrowthAnnual);
    var gPd = dailyFromAnnual(I.btcGrowthAnnual);
    var gHYear = I.hashrateGrowthAnnual;

    var H = I.networkHashrateEhs;
    var P = I.btcPrice;
    var height = I.blockHeight;

    var rack = parseISODate(I.rackDate) || midnight(new Date());
    var win = monthWindows(rack, I.months);
    var totalDays = win.reduce(function (a, w) { return a + w.days; }, 0);

    var rows = [];
    var detailRows = [];
    var cumBtc = 0, cumElec = 0, cumCost = 0, cumRevenue = 0, cumDays = 0;
    /* §14's static payback read off the SIMULATED path instead of a snapshot:
       the first month whose cumulative operating cash (revenue − electricity)
       has covered the machine purchase price. `staticPaybackDays` is the same
       idea at today's price and difficulty; this is the same idea on the actual
       curve the table below draws. Null when the horizon never reaches it. */
    var paybackMonth = null;
    /* Running 期数 for the detail table. It counts billing PERIODS, not months:
       a month a halving splits in two advances it twice, which is the whole
       point of numbering the rows — two lines of the same month must not share
       a row label. */
    var period = 0;
    /* Capex spread straight-line across the horizon's DAYS. Putting it in the
       grid — rather than dropping it in at the summary — is what makes the
       "Total cost" column differ from "Electricity", and what lets the running
       cost/BTC converge on the life figure instead of sitting permanently
       below it. Day-proportional, so a 31-day month carries more of the machine
       than a 28-day one. (§12's cash break-even never sees capex at all.) */
    var depPerDay = totalDays > 0 ? I.machinePrice / totalDays : 0;

    for (var m = 1; m <= I.months; m++) {
      var w = win[m - 1];
      var days = w.days;

      /* halving: height advances even when the network is offline for us, so
         advance by networkBlocks (uptime-independent). */
      var heightStart = height;
      var heightEnd = height + BLOCKS_PER_DAY * days;
      height = heightEnd;

      /* Split the window at any halving boundary inside it FIRST, then build
         the month totals by adding the parts back up. Doing it in this order is
         what makes the detail table and the month table the same money by
         construction: computing the month from an averaged subsidy and the
         split from whole days would leave the two a rounding apart, which is
         exactly the class of drift this model is not allowed to have. */
      var segs = subsidySegments(heightStart, heightEnd, I.blockSubsidy, I.nextHalvingHeight, I.blocksPerHalving);
      var netTh = H * 1e6;
      var parts = [], offset = 0;
      for (var k = 0; k < segs.length; k++) {
        var sg = segs[k];
        var remain = days - offset;
        /* Whole-day boundary nearest the exact block crossing. A halving rarely
           lands on midnight, and a cost statement cannot bill 0.4 of a day. */
        var segDays = k === segs.length - 1
          ? remain
          : Math.max(0, Math.min(remain, Math.round((sg.h1 - heightStart) / BLOCKS_PER_DAY) - offset));
        var perTh = netTh > 0 ? (sg.subsidy * BLOCKS_PER_DAY) / netTh : 0;
        var pBtc = perTh * I.hashrate * segDays * I.uptime * (1 - I.poolFee);
        var pElec = I.power / 1000 * 24 * segDays * I.electricityPrice * I.uptime;
        var pMachine = depPerDay * segDays;
        parts.push({
          part: k + 1, split: segs.length > 1,
          days: segDays, subsidy: sg.subsidy, perTh: perTh,
          btc: pBtc, elec: pElec, machine: pMachine, total: pElec + pMachine,
          dateStart: segDays > 0 ? toISODate(addDays(w.start, offset)) : null,
          dateEnd: segDays > 0 ? toISODate(addDays(w.start, offset + segDays - 1)) : null
        });
        offset += segDays;
      }

      /* Day-weighted blends, so `subsidy × 144 / netTh` still reproduces the
         month's per-T output and the summed parts reproduce its BTC exactly. */
      /* A halving landing within half a day of the window's edge rounds to a
         zero-day part. Drop it: the rule is that a month splits in two only
         when the halving day genuinely falls inside it (not on its first or
         last day), and a billing period cannot be zero days long. This is
         money-neutral — a zero-day part contributes nothing to any of the
         day-weighted sums below — and it is what stops the table from ever
         printing a period with no dates. */
      var booked = parts.filter(function (p) { return p.days > 0; });
      booked.forEach(function (p, i) { p.part = i + 1; p.split = booked.length > 1; });

      var btcPerThDay = days > 0
        ? booked.reduce(function (a, p) { return a + p.perTh * p.days; }, 0) / days : 0;
      var subsidy = days > 0
        ? booked.reduce(function (a, p) { return a + p.subsidy * p.days; }, 0) / days : 0;
      var btc = booked.reduce(function (a, p) { return a + p.btc; }, 0);
      var elec = booked.reduce(function (a, p) { return a + p.elec; }, 0);
      var machine = booked.reduce(function (a, p) { return a + p.machine; }, 0);  // §11.4 — amortised
      var cashCost = elec;                                   // §12 — what shutting down avoids
      var totalCost = elec + machine;                         // all-in production cost
      var shutdown = btc > 0 ? cashCost / btc : null;         // §12 — cash break-even
      var btcMonthPrice = P;

      cumBtc += btc;
      cumElec += elec;
      cumCost += totalCost;
      cumRevenue += btc * btcMonthPrice;
      cumDays += days;

      if (paybackMonth === null && I.machinePrice > 0
        && (cumRevenue - cumElec) >= I.machinePrice) {
        paybackMonth = m;
      }

      rows.push({
        month: m,
        year: Math.ceil(m / 12),
        yearMonth: ((m - 1) % 12) + 1,
        label: 'M' + (m < 10 ? '0' + m : m),
        dateStart: toISODate(w.start),
        dateEnd: toISODate(addDays(w.end, -1)),
        days: days,
        cumDays: cumDays,
        networkHashrate: H,
        blockSubsidy: subsidy,
        btcPerThDay: btcPerThDay,
        /* Reverse derivation published for cross-checking against the public
           network figure: what hashrate does this month's per-T output imply,
           given the block reward? */
        impliedHashrateEhs: btcPerThDay > 0 ? (subsidy * BLOCKS_PER_DAY) / (btcPerThDay * 1e6) : null,
        btc: btc,
        cumBtc: cumBtc,
        electricity: elec,
        depreciation: machine,
        machineCost: machine,
        cashCost: cashCost,
        totalCost: totalCost,
        cumCost: cumCost,
        unitCost: cumBtc > 0 ? cumCost / cumBtc : null,     // running all-in Actual Cost / BTC
        monthUnitCost: btc > 0 ? totalCost / btc : null,
        costRatio: btc * btcMonthPrice > 0 ? totalCost / (btc * btcMonthPrice) : null,
        btcPrice: btcMonthPrice,
        revenue: btc * btcMonthPrice,
        netProfit: btc * btcMonthPrice - totalCost,          // all-in (matches summary.netProfit)
        cashNetProfit: btc * btcMonthPrice - cashCost,       // operating cash flow
        shutdownPrice: shutdown,
        margin: btcMonthPrice > 0 && shutdown !== null ? 1 - shutdown / btcMonthPrice : null
      });

      /* ---- detail rows: the same window, one line per subsidy segment ---- */
      booked.forEach(function (p) {
        var pRev = p.btc * btcMonthPrice;
        period += 1;
        detailRows.push({
          period: period,
          month: m,
          part: p.part,
          parts: booked.length,
          split: p.split,
          label: 'M' + (m < 10 ? '0' + m : m),
          dateStart: p.dateStart,
          dateEnd: p.dateEnd,
          days: p.days,
          networkHashrate: H,
          impliedHashrateEhs: p.perTh > 0 ? (p.subsidy * BLOCKS_PER_DAY) / (p.perTh * 1e6) : null,
          blockSubsidy: p.subsidy,
          btcPerThDay: p.perTh,
          shutdownPrice: p.btc > 0 ? p.elec / p.btc : null,
          totalCost: p.total,
          electricity: p.elec,
          machineCost: p.machine,
          /* 综合持仓成本 — this period's all-in cost divided by the BTC it
             actually produced, i.e. the cost basis of the coins you are left
             holding. Same construction as `rows[].monthUnitCost` and
             `summary.actualCostPerBtc`, so the column's total row lands on the
             KPI's end-of-life figure. Null (never Infinity) with no production. */
          unitCost: p.btc > 0 ? p.total / p.btc : null,
          costRatio: pRev > 0 ? p.total / pRev : null,
          btc: p.btc,
          revenue: pRev,
          netProfit: pRev - p.total,
          btcPrice: btcMonthPrice
        });
      });

      /* Growth applies AFTER the window is booked, over that window's real
         day count. */
      H = H * Math.pow(1 + gHd, days);
      P = P * Math.pow(1 + gPd, days);
    }

    /* --- annual aggregation --- */
    var years = [];
    for (var y = 1; y <= Math.ceil(I.months / 12); y++) {
      var seg = rows.slice((y - 1) * 12, y * 12);
      if (!seg.length) break;
      var yBtc = sum(seg, 'btc');
      var yElec = sum(seg, 'electricity');
      var yMachine = sum(seg, 'machineCost');
      var yCost = sum(seg, 'totalCost');
      var yRev = sum(seg, 'revenue');
      years.push({
        year: y,
        days: sum(seg, 'days'),
        dateStart: seg[0].dateStart,
        dateEnd: seg[seg.length - 1].dateEnd,
        networkHashrateStart: seg[0].networkHashrate,
        networkHashrateEnd: seg[seg.length - 1].networkHashrate,
        networkHashrateAvg: avg(seg, 'networkHashrate'),
        blockSubsidy: seg[seg.length - 1].blockSubsidy,
        btc: yBtc,
        cumBtc: seg[seg.length - 1].cumBtc,
        electricity: yElec,
        machineCost: yMachine,
        totalCost: yCost,
        cumCost: seg[seg.length - 1].cumCost,
        unitCost: yCost / (yBtc || 1),
        revenue: yRev,
        netProfit: yRev - yCost,
        shutdownPrice: avg(seg.filter(function (r) { return r.shutdownPrice !== null; }), 'shutdownPrice'),
        btcPriceStart: seg[0].btcPrice,
        btcPriceEnd: seg[seg.length - 1].btcPrice,
        cumUnitCost: seg[seg.length - 1].unitCost
      });
    }

    var totalCost = I.machinePrice + cumElec;
    var aPoC = cumBtc > 0 ? totalCost / cumBtc : null;

    var result = {
      input: I,
      current: F,
      currentNoPayback: F.staticPaybackDays === null,
      rows: rows,
      /* Same money as `rows`, but a month that contains a halving is split into
         pre / post lines so the reward step is visible rather than averaged
         away. This is what the monthly cost-detail table renders. */
      detailRows: detailRows,
      years: years,
      calendar: {
        rackDate: I.rackDate,
        horizonEnd: win.length ? toISODate(addDays(win[win.length - 1].end, -1)) : I.rackDate,
        totalDays: totalDays,
        windows: win.length,
        /* Billing periods the detail table prints: == windows, plus one for
           each halving that falls strictly inside a month. */
        periods: detailRows.length,
        halvings: detailRows.filter(function (r) { return r.part === 2; }).length
      },
      summary: {
        months: I.months,
        totalDays: totalDays,
        rackDate: I.rackDate,
        cumBtc: cumBtc,
        cumElectricity: cumElec,
        machineCost: I.machinePrice,
        totalCost: totalCost,
        revenue: cumRevenue,
        netProfit: cumRevenue - totalCost,
        actualCostPerBtc: aPoC,
        avgShutdownPrice: avg(rows.filter(function (r) { return r.shutdownPrice !== null; }), 'shutdownPrice'),
        y1Btc: years[0] ? years[0].btc : 0,
        y4Btc: years.length ? years[years.length - 1].btc : 0,
        btcDecay: (years.length > 1 && years[0].btc > 0) ? years[years.length - 1].btc / years[0].btc : null,
        networkHashrateEnd: rows.length ? rows[rows.length - 1].networkHashrate : H,
        halvingMonth: findHalvingMonth(rows),
        paybackMonth: paybackMonth
      },
      /* Mining vs Buy & Hold (§28-§32) */
      vs: null,
      monthlyGrowth: { hashrate: gH, btcPrice: gP },
      dailyGrowth: { hashrate: gHd, btcPrice: gPd },
      hashrateGrowthAnnual: gHYear
    };

    result.vs = computeVsSpot(result, I);
    return result;
  }

  /** Subsidy in force at a block height, measured against the FIRST halving
   *  boundary supplied. At or past it, each further `blocksPerHalving` halves
   *  the reward again — so a 4-year window that straddles two halvings is
   *  handled without hardcoding either date. */
  function subsidyAtHeight(height, baseSubsidy, nextHalvingHeight, blocksPerHalving) {
    var base = num(baseSubsidy);
    var bph = num(blocksPerHalving, 210000);
    var first = num(nextHalvingHeight);
    var h = Math.max(0, num(height));
    if (bph <= 0 || !(h >= first)) return base;
    var steps = 1 + Math.floor((h - first) / bph);
    return base / Math.pow(2, steps);
  }

  /**
   * Split [h0, h1) at every halving boundary strictly inside it. Each segment
   * carries a CONSTANT subsidy, which is what lets the detail table show a
   * halving as two lines (pre / post) instead of one averaged blur.
   */
  function subsidySegments(h0, h1, baseSubsidy, nextHalvingHeight, blocksPerHalving) {
    var bph = num(blocksPerHalving, 210000);
    var first = num(nextHalvingHeight);
    var a = num(h0), b = num(h1);
    if (!(b > a) || bph <= 0) {
      return [{ h0: a, h1: b, subsidy: subsidyAtHeight(a, baseSubsidy, first, bph) }];
    }
    /* first boundary strictly above h0 */
    var boundary = first <= a ? first + bph * (Math.floor((a - first) / bph) + 1) : first;
    var segs = [], cur = a, guard = 0;
    while (cur < b - 1e-9 && guard++ < 512) {
      var stop = Math.min(b, boundary);
      segs.push({ h0: cur, h1: stop, subsidy: subsidyAtHeight(cur, baseSubsidy, first, bph) });
      cur = stop;
      if (boundary <= b) boundary += bph;
    }
    if (!segs.length) segs.push({ h0: a, h1: b, subsidy: subsidyAtHeight(a, baseSubsidy, first, bph) });
    return segs;
  }

  function findHalvingMonth(rows) {
    for (var i = 1; i < rows.length; i++) {
      if (Math.abs(rows[i].blockSubsidy - rows[i - 1].blockSubsidy) > 1e-9) return rows[i].month;
    }
    return null;
  }

  /** §28-§32 Mining vs Buy & Hold. The two routes are CAPITAL-MATCHED: whatever
   *  the machine costs plus every electricity bill the horizon runs up is what
   *  the spot side gets to deploy, converted once at today's price
   *  (`summary.totalCost` is exactly capex + Σ electricity). Pricing the spot leg
   *  off the machine alone would let the mining route carry its opex for free,
   *  and it would put this ratio at odds with the two "BTC per $1M spent" rows
   *  inside the same panel — those were already spending matching capital. */
  function computeVsSpot(res, I) {
    var S = res.summary;
    var spotBtc = safeDiv(S.totalCost, I.btcPrice);
    var ratio = null;
    if (spotBtc && spotBtc > 0 && S.cumBtc > 0) ratio = S.cumBtc / spotBtc;

    var exit = num(I.exitPrice, 200000);
    var miningValue = S.cumBtc * exit;
    var miningRoi = S.totalCost > 0 ? (miningValue - S.totalCost) / S.totalCost : null;
    var spotRoi = I.btcPrice > 0 ? (exit - I.btcPrice) / I.btcPrice : null;

    /* BTC per USD spent, both routes, on the same capital. The panel prints
       these two side by side and `ratio` is exactly their quotient — an
       invariant that holds only while the spot leg spends what mining spends,
       which is why the definitions above and here move together. */
    var miningValuePerCost = S.totalCost > 0 ? S.cumBtc / S.totalCost : null;  // BTC per USD spent mining
    var breakEvenExit = S.cumBtc > 0 ? S.totalCost / S.cumBtc : null;          // exit price for mining ROI = 0

    return {
      spotBtc: spotBtc,
      miningBtc: S.cumBtc,
      ratio: ratio,
      exitPrice: exit,
      miningValue: miningValue,
      miningRoi: miningRoi,
      spotRoi: spotRoi,
      miningValuePerCost: miningValuePerCost,
      breakEvenExit: breakEvenExit,
      winner: ratio === null ? 'n/a' : (ratio >= 1 ? 'mining' : 'spot')
    };
  }

  /* ======================================================================
   * C. SENSITIVITY  (spec §34, §35)
   * ====================================================================== */
  function sensitivityCostMatrix(input, btcGrowths, hashrateGrowths, opts) {
    opts = opts || {};
    var metric = opts.metric || 'netPerBtc';
    var rows = [];
    for (var i = 0; i < btcGrowths.length; i++) {
      var cells = [];
      for (var j = 0; j < hashrateGrowths.length; j++) {
        var r = simulate(Object.assign({}, input, {
          btcGrowthAnnual: btcGrowths[i],
          hashrateGrowthAnnual: hashrateGrowths[j]
        }));
        var S = r.summary;
        /* netPerBtc: realised profit per BTC produced — the only headline metric
           that responds to BOTH axes (cost/BTC ignores price, ROI uses a fixed
           exit price, so neither discriminates the BTC-growth axis). */
        var v = metric === 'netPerBtc'
          ? (S.cumBtc > 0 ? S.netProfit / S.cumBtc : null)
          : metric === 'ratio' ? r.vs.ratio
            : metric === 'shutdown' ? r.summary.avgShutdownPrice
              : metric === 'roi' ? r.vs.miningRoi
                : r.summary.actualCostPerBtc;
        cells.push({
          v: v,
          cost: S.actualCostPerBtc,
          roi: r.vs.miningRoi,
          ratio: r.vs.ratio,
          btc: S.cumBtc,
          net: S.netProfit,
          realisedPrice: S.cumBtc > 0 ? S.revenue / S.cumBtc : null
        });
      }
      rows.push({ btcGrowth: btcGrowths[i], cells: cells });
    }
    return { rows: rows, cols: hashrateGrowths, metric: metric };
  }

  function sensitivityElectricity(input, prices) {
    return prices.map(function (p) {
      var r = simulate(Object.assign({}, input, { electricityPrice: p }));
      return {
        price: p,
        costPerBtc: r.summary.actualCostPerBtc,
        shutdownPrice: r.current.shutdownPrice,
        miningRoi: r.vs.miningRoi,
        dailyProfit: r.current.dailyNetProfit,
        breakEven: r.current.dailyNetProfit >= 0
      };
    });
  }

  /* ======================================================================
   * D. STATE / URL  (spec §49)
   * ====================================================================== */
  var URL_KEYS = [
    ['hashrate', 'hashrate'], ['power', 'power'], ['machinePrice', 'machinePrice'],
    ['btcPrice', 'btcPrice'], ['networkHashrate', 'networkHashrateEhs'],
    ['electricity', 'electricityPrice'], ['uptime', 'uptime'], ['poolFee', 'poolFee'],
    ['hashrateGrowth', 'hashrateGrowthAnnual'], ['btcGrowth', 'btcGrowthAnnual'],
    ['lifetime', 'lifeYears'], ['exitPrice', 'exitPrice'], ['miner', 'minerKey'],
    ['rack', 'rackDate'],
    ['subsidy', 'blockSubsidy'], ['height', 'blockHeight'], ['halvingHeight', 'nextHalvingHeight']
  ];

  /* Keys that belong in the URL but are NOT model inputs. Kept in a separate
     list so `fromQuery()` keeps returning a pure input dictionary — the app
     reads presentation params (language) through `fromQueryExtra()` instead.
     Mixing them in would put a non-input key through the numeric coercion
     below and leave `state.inputs.lang` sitting in the model. */
  var EXTRA_KEYS = [['lang', 'lang']];

  function queryPairs(input) {
    var p = [];
    URL_KEYS.forEach(function (pair) {
      var v = input[pair[1]];
      if (v === undefined || v === null || v === '') return;
      if (pair[1] === 'minerKey' && v === 'custom') return;
      p.push(pair[0] + '=' + encodeURIComponent(v));
    });
    return p;
  }

  /** Presentation params (model-external), read separately from inputs. */
  function fromQueryExtra(search) {
    var out = {};
    var q = String(search || '').replace(/^\?/, '');
    if (!q) return out;
    var map = {}; EXTRA_KEYS.forEach(function (p) { map[p[0]] = p[1]; });
    q.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='); if (i < 0) return;
      var k = decodeURIComponent(kv.slice(0, i));
      if (!map[k]) return;
      out[map[k]] = decodeURIComponent(kv.slice(i + 1));
    });
    return out;
  }

  function toQuery(input) {
    var p = queryPairs(input);
    /* Presentation params (language) are appended by the host through out.set()
       so this module stays free of UI state. */
    if (typeof toQuery.onPair === 'function') {
      p = p.concat(toQuery.onPair());
    }
    return p.join('&');
  }

  function fromQuery(search, defaults) {
    var out = {}; Object.keys(defaults || {}).forEach(function (k) { out[k] = defaults[k]; });
    var q = String(search || '').replace(/^\?/, '');
    if (!q) return out;
    var map = {}; URL_KEYS.forEach(function (p) { map[p[0]] = p[1]; });
    q.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='); if (i < 0) return;
      var k = decodeURIComponent(kv.slice(0, i));
      var v = decodeURIComponent(kv.slice(i + 1));
      if (!map[k]) return;
      var f = map[k];
      out[f] = (f === 'minerKey') ? v : (v === '' ? out[f] : (isFinite(Number(v)) && v.trim() !== '' ? Number(v) : v));
    });
    return out;
  }

  /* ---------- tiny stats ---------- */
  function sum(arr, k) { var s = 0; for (var i = 0; i < arr.length; i++) s += num(arr[i][k]); return s; }
  function avg(arr, k) { return arr.length ? sum(arr, k) / arr.length : 0; }

  /* ---------- exports ---------- */
  return {
    BLOCKS_PER_DAY: BLOCKS_PER_DAY,
    DAYS_PER_MONTH: DAYS_PER_MONTH,
    DAYS_PER_YEAR: DAYS_PER_YEAR,
    efficiency: efficiency,
    blockSubsidy: blockSubsidy,
    nextHalvingHeight: nextHalvingHeight,
    /* calendar surface — exported so the tables, the probes and the tests all
       read the same month windows the simulation used */
    parseISODate: parseISODate,
    toISODate: toISODate,
    addMonths: addMonths,
    daysBetween: daysBetween,
    monthWindows: monthWindows,
    subsidyAtHeight: subsidyAtHeight,
    computeCurrent: computeCurrent,
    simulate: simulate,
    sensitivityCostMatrix: sensitivityCostMatrix,
    sensitivityElectricity: sensitivityElectricity,
    toQuery: toQuery,
    queryPairs: queryPairs,
    fromQuery: fromQuery,
    fromQueryExtra: fromQueryExtra,
    safediv: safeDiv
  };
}));
