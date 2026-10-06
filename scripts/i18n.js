/* ==========================================================================
 * i18n — three-locale string table + language state
 *
 * Design notes
 * ------------
 * 1. Copy lives here and nowhere else. `app.js` and `charts.js` call `t(key)`;
 *    markup carries `data-i18n="key"`. Nothing hardcodes a user-visible string,
 *    so a missing translation is a *visible* fallback rather than a silent
 *    English leak, and the whole corpus is auditable from one file.
 *
 * 2. `en` is the source of truth. A missing key in another locale falls back to
 *    English rather than rendering the raw key, so a partial table degrades to
 *    readable English instead of "kpi.cost.sub".
 *
 * 3. Traditional Chinese here is Taiwan usage, not a character-level conversion:
 *    網路 not 網絡, 雜湊率 not 哈希率, 礦機 not 礦機直轉. Term-for-term:
 *       hashrate  → 算力 / 算力 (same in TW usage for mining context)
 *       network hashrate → 全網算力 / 全網算力
 *       shutdown price   → 關機幣價 / 關機幣價
 *       payback          → 回本 / 回本
 *       pool fee         → 礦池費 / 礦池費
 *       spot             → 現貨 / 現貨
 *       uptime           → 線上率 (TW) — 開機率 reads oddly in TW
 *
 * 4. Switching language must never touch numbers, inputs, or the URL's model
 *    params. It only re-labels. `applyLanguage()` therefore re-renders, never
 *    re-computes from defaults.
 * ========================================================================== */
(function (root) {
  'use strict';

  var STORE_KEY = 'bmcm-lang';
  var SUPPORTED = ['en', 'zh-CN', 'zh-TW'];
  var DEFAULT_LANG = 'en';

  /* ----------------------------------------------------------------------
   * Locale metadata (for the switcher UI)
   * -------------------------------------------------------------------- */
  var LOCALES = [
    { key: 'zh-CN', short: '简', label: '简体中文', html: 'zh-CN' },
    { key: 'zh-TW', short: '繁', label: '繁體中文', html: 'zh-TW' },
    { key: 'en', short: 'EN', label: 'English', html: 'en' }
  ];

  /* ----------------------------------------------------------------------
   * String table
   *
   * Grouped by surface so a reviewer can diff one panel at a time.
   * -------------------------------------------------------------------- */
  var STRINGS = {

    /* ---------------- app chrome ---------------- */
    'app.title': { en: 'Bitcoin Mining Cost Model', 'zh-CN': '比特币挖矿成本模型', 'zh-TW': '比特幣挖礦成本模型' },
    'app.brandFull': {
      en: 'Bitcoin Mining Cost Model',
      'zh-CN': '比特币挖矿成本模型 · Bitcoin Mining Cost Model',
      'zh-TW': '比特幣挖礦成本模型 · Bitcoin Mining Cost Model'
    },
    'theme.label': { en: 'Theme', 'zh-CN': '主题', 'zh-TW': '主題' },
    'theme.aria': { en: 'Change theme', 'zh-CN': '切换主题', 'zh-TW': '切換主題' },
    'lang.label': { en: 'Language', 'zh-CN': '语言', 'zh-TW': '語言' },
    'lang.aria': { en: 'Change language', 'zh-CN': '切换语言', 'zh-TW': '切換語言' },
    'status.connecting': { en: 'Connecting…', 'zh-CN': '连接中…', 'zh-TW': '連線中…' },

    /* theme names */
    'theme.light': { en: 'Light', 'zh-CN': '浅色', 'zh-TW': '淺色' },
    'theme.dark': { en: 'Dark', 'zh-CN': '深色', 'zh-TW': '深色' },
    'theme.tech': { en: 'Tech', 'zh-CN': '科技', 'zh-TW': '科技' },
    'theme.minimal': { en: 'Minimal', 'zh-CN': '简约', 'zh-TW': '簡約' },

    /* ---------------- hero ---------------- */
    'hero.title': { en: 'Bitcoin Mining Cost', 'zh-CN': '比特币挖矿成本', 'zh-TW': '比特幣挖礦成本' },
    'hero.sub': {
      en: 'Estimate the real cost of mining BTC — all-in cost per coin, the price at which the machine shuts down, and how both move as network hashrate grows.',
      'zh-CN': '估算比特币的真实挖矿成本 —— 每枚币的综合成本、矿机停机币价，以及两者随全网算力增长的变化。',
      'zh-TW': '估算比特幣的真實挖礦成本 —— 每枚幣的綜合成本、礦機關機幣價，以及兩者隨全網算力增長的變化。'
    },

    /* ---------------- inputs ---------------- */
    'inp.title': { en: 'Model Inputs', 'zh-CN': '模型输入', 'zh-TW': '模型輸入' },
    'inp.hint': {
      en: 'every edit recomputes the whole model',
      'zh-CN': '每次修改都会重算整个模型',
      'zh-TW': '每次修改都會重算整個模型'
    },
    'inp.hw': { en: 'Miner parameters', 'zh-CN': '矿机参数', 'zh-TW': '礦機參數' },
    'inp.miner': { en: 'Miner model', 'zh-CN': '矿机型号', 'zh-TW': '礦機型號' },
    'inp.hashrate': { en: 'Hashrate per unit', 'zh-CN': '单机算力', 'zh-TW': '單機算力' },
    'inp.power': { en: 'Power draw', 'zh-CN': '整机功耗', 'zh-TW': '整機功耗' },
    'inp.price': { en: 'Machine price', 'zh-CN': '矿机价格', 'zh-TW': '礦機價格' },
    'inp.pricePerTh': { en: 'Price per TH', 'zh-CN': '单T算力价格', 'zh-TW': '單T算力價格' },
    'inp.life': { en: 'Service life', 'zh-CN': '使用年限', 'zh-TW': '使用年限' },
    'inp.lifeDays': { en: 'Service life days', 'zh-CN': '使用天数', 'zh-TW': '使用天數' },
    'inp.rack': { en: 'Rack date', 'zh-CN': '上架时间', 'zh-TW': '上架時間' },
    'inp.rackHint': {
      en: 'anchors the month windows and the block clock',
      'zh-CN': '决定月份窗口与区块高度的起点',
      'zh-TW': '決定月份視窗與區塊高度的起點'
    },
    'inp.days': { en: 'Days', 'zh-CN': '天', 'zh-TW': '天' },
    'inp.eff': { en: 'Efficiency', 'zh-CN': '能效比', 'zh-TW': '能效比' },
    'inp.years': { en: 'years', 'zh-CN': '年', 'zh-TW': '年' },
    'inp.ops': { en: 'Operating parameters', 'zh-CN': '运营参数', 'zh-TW': '營運參數' },
    'inp.elec': { en: 'Electricity price', 'zh-CN': '电价', 'zh-TW': '電價' },
    'inp.uptime': { en: 'Uptime', 'zh-CN': '在线率', 'zh-TW': '線上率' },
    'inp.pool': { en: 'Pool fee', 'zh-CN': '矿池费', 'zh-TW': '礦池費' },
    'inp.perKwh': { en: 'per kWh', 'zh-CN': '每度电', 'zh-TW': '每度電' },
    'inp.mkt': { en: 'Market & projection', 'zh-CN': '市场与预测', 'zh-TW': '市場與預測' },
    'inp.btcPrice': { en: 'BTC price', 'zh-CN': 'BTC 币价', 'zh-TW': 'BTC 幣價' },
    'inp.netHash': { en: 'Network hashrate', 'zh-CN': '全网算力', 'zh-TW': '全網算力' },
    'inp.subsidy': { en: 'Block subsidy', 'zh-CN': '区块奖励', 'zh-TW': '區塊獎勵' },
    'inp.nextHalving': { en: 'Next halving block', 'zh-CN': '下次减半高度', 'zh-TW': '下次減半高度' },
    'inp.hashGrowth': { en: 'Hashrate growth', 'zh-CN': '算力增长率', 'zh-TW': '算力成長率' },
    'inp.monthlyEq': { en: 'Monthly equivalent', 'zh-CN': '等效月增速', 'zh-TW': '等效月增速' },
    'inp.exit': { en: 'BTC exit price (end of life)', 'zh-CN': '退出时 BTC 价（使用年限末）', 'zh-TW': '出場時 BTC 價（使用年限末）' },
    'inp.btcGrowth': { en: 'BTC price growth', 'zh-CN': '币价增长率', 'zh-TW': '幣價成長率' },
    'inp.annual': { en: 'annual · compound', 'zh-CN': '年化 · 复利', 'zh-TW': '年化 · 複利' },
    'inp.blockHeight': { en: 'Block height', 'zh-CN': '当前区块高度', 'zh-TW': '當前區塊高度' },
    'inp.manualHint': {
      en: 'Live price is read from the baked market snapshot. Switch to <b>Manual</b> to model any scenario — the whole dashboard and the charts update instantly.',
      'zh-CN': '实时价格来自内置的市场快照。切到<b>手动</b>即可模拟任意情景 —— 整个面板与所有图表会即时更新。',
      'zh-TW': '即時價格來自內建的市場快照。切到<b>手動</b>即可模擬任意情境 —— 整個面板與所有圖表會即時更新。'
    },
    'btn.reset': { en: 'Reset', 'zh-CN': '重置', 'zh-TW': '重設' },
    'btn.copy': { en: 'Copy link', 'zh-CN': '复制链接', 'zh-TW': '複製連結' },

    /* ---------------- KPI cards ---------------- */
    'kpi.cost': { en: 'Mining Cost / BTC', 'zh-CN': '每 BTC 挖矿成本', 'zh-TW': '每 BTC 挖礦成本' },
    'kpi.costSub': { en: 'Current all-in cost', 'zh-CN': '当前综合成本', 'zh-TW': '當前綜合成本' },
    'kpi.shut': { en: 'Shutdown BTC Price', 'zh-CN': '关机币价', 'zh-TW': '關機幣價' },
    'kpi.shutSub': { en: 'Daily break-even', 'zh-CN': '每日盈亏平衡', 'zh-TW': '每日損益兩平' },
    'kpi.profit': { en: 'Daily Net Profit', 'zh-CN': '每日净利润', 'zh-TW': '每日淨利潤' },
    'kpi.pay': { en: 'Static Payback', 'zh-CN': '静态回本周期', 'zh-TW': '靜態回本週期' },
    'kpi.paySub': { en: 'At current BTC price', 'zh-CN': '按当前币价', 'zh-TW': '按當前幣價' },
    'kpi.belowSpot': { en: 'Below Spot', 'zh-CN': '低于现价', 'zh-TW': '低於現價' },
    'kpi.aboveSpot': { en: 'Above Spot', 'zh-CN': '高于现价', 'zh-TW': '高於現價' },
    'kpi.headroom': { en: 'headroom', 'zh-CN': '安全垫', 'zh-TW': '安全邊際' },
    'kpi.underwater': { en: 'under water', 'zh-CN': '已亏损', 'zh-TW': '已虧損' },
    'kpi.profitable': { en: 'Profitable', 'zh-CN': '盈利', 'zh-TW': '獲利' },
    'kpi.unprofitable': { en: 'Unprofitable', 'zh-CN': '亏损', 'zh-TW': '虧損' },
    'kpi.revLabel': { en: 'Revenue', 'zh-CN': '收入', 'zh-TW': '收入' },
    'kpi.costLabel': { en: 'cost', 'zh-CN': '成本', 'zh-TW': '成本' },
    'kpi.shutSub2': {
      en: 'Cash break-even — BTC below this → shut down',
      'zh-CN': '现金盈亏平衡 —— 币价低于此值即关机',
      'zh-TW': '現金損益兩平 —— 幣價低於此值即關機'
    },
    'kpi.payNo': {
      en: 'Current mining economics do not support payback.',
      'zh-CN': '当前挖矿经济性不支持回本。',
      'zh-TW': '當前挖礦經濟性不支持回本。'
    },
    'kpi.paySub2': {
      en: 'Cash-flow payback on the machine only',
      'zh-CN': '仅按矿机现金流回本',
      'zh-TW': '僅按礦機現金流回本'
    },

    /* ---------------- cost-pressure tags ---------------- */
    'tag.aboveBE': { en: 'Above Break-even', 'zh-CN': '已破盈亏线', 'zh-TW': '已破損益兩平線' },
    'tag.highPressure': { en: 'High Cost Pressure', 'zh-CN': '成本压力高', 'zh-TW': '成本壓力高' },
    'tag.normal': { en: 'Normal', 'zh-CN': '正常', 'zh-TW': '正常' },
    'tag.lowPressure': { en: 'Low Cost Pressure', 'zh-CN': '成本压力低', 'zh-TW': '成本壓力低' },

    /* ---------------- economics panel ---------------- */
    'econ.title': { en: 'Mining Economics', 'zh-CN': '挖矿经济性', 'zh-TW': '挖礦經濟性' },
    'econ.hint': { en: 'per unit, per day', 'zh-CN': '单机 · 每日', 'zh-TW': '單機 · 每日' },
    'econ.mix': { en: 'Daily cost mix', 'zh-CN': '每日成本构成', 'zh-TW': '每日成本組成' },
    'econ.unit': { en: 'Unit detail', 'zh-CN': '单机明细', 'zh-TW': '單機明細' },
    'econ.btcPerDay': { en: 'Miner BTC / Day', 'zh-CN': '单机每日产出', 'zh-TW': '單機每日產出' },
    'econ.stack': { en: 'BTC per TH / day', 'zh-CN': '每 TH 日产出', 'zh-TW': '每 TH 日產出' },
    'econ.elec': { en: 'Daily Electricity', 'zh-CN': '每日电费', 'zh-TW': '每日電費' },
    'econ.machine': { en: 'Machine Depreciation / Day', 'zh-CN': '每日矿机折旧', 'zh-TW': '每日礦機折舊' },
    'econ.total': { en: 'Daily Total Cost (all-in)', 'zh-CN': '每日总成本（全成本）', 'zh-TW': '每日總成本（全成本）' },
    'econ.cashFlow': { en: 'Daily Operating Cash Flow', 'zh-CN': '每日经营现金流', 'zh-TW': '每日營運現金流' },
    'econ.revenue': { en: 'Daily Revenue', 'zh-CN': '每日收入', 'zh-TW': '每日收入' },
    'econ.profit': { en: 'Daily Net Profit', 'zh-CN': '每日净利润', 'zh-TW': '每日淨利潤' },
    'econ.margin': { en: 'Profit Margin', 'zh-CN': '利润率', 'zh-TW': '利潤率' },
    'econ.costRatio': { en: 'Cost Ratio', 'zh-CN': '成本比', 'zh-TW': '成本比' },
    'econ.shutdown': { en: 'Shutdown BTC Price', 'zh-CN': '关机币价', 'zh-TW': '關機幣價' },
    'econ.btcPerTh': { en: 'BTC / TH / day', 'zh-CN': '每 TH 日产出', 'zh-TW': '每 TH 日產出' },
    'econ.powerCost': { en: 'Power cost / BTC', 'zh-CN': '每 BTC 电费', 'zh-TW': '每 BTC 電費' },
    'econ.breakElec': { en: 'Break-even Electricity', 'zh-CN': '盈亏平衡电价', 'zh-TW': '損益兩平電價' },
    'econ.btcPerMonth': { en: 'Miner BTC / Month', 'zh-CN': '单机每月产出', 'zh-TW': '單機每月產出' },
    'econ.machineShort': { en: 'Machine', 'zh-CN': '矿机', 'zh-TW': '礦機' },
    'econ.capexShort': { en: 'capex', 'zh-CN': 'capex', 'zh-TW': 'capex' },
    'econ.basisNote': {
      en: 'Net profit is all-in: electricity plus depreciation of the machine. The shutdown price compares revenue against electricity only — once bought, the machine is sunk and cannot influence an on/off call.',
      'zh-CN': '净利润为全成本口径：电费 + 矿机折旧。关机币价只比较收入与电费 —— 矿机一旦购入即为沉没成本，不影响开关机决策。',
      'zh-TW': '淨利潤為全成本口徑：電費 + 礦機折舊。關機幣價只比較收入與電費 —— 礦機一旦購入即為沉沒成本，不影響開關機決策。'
    },
    'econ.capexNote': {
      en: 'Machine cost is spread as straight-line depreciation over the modelled horizon, not charged as a lump in month 1.',
      'zh-CN': '矿机成本按直线折旧在模拟期内分摊，而非在第 1 个月一次性计入。',
      'zh-TW': '礦機成本按直線折舊在模擬期內分攤，而非在第 1 個月一次性計入。'
    },

    /* ---------------- payback panel ---------------- */
    'pay.title': { en: 'Required BTC Price for Payback', 'zh-CN': '回本所需币价', 'zh-TW': '回本所需幣價' },
    'pay.hint': { en: 'electricity-only break-even', 'zh-CN': '仅计电费的盈亏平衡', 'zh-TW': '僅計電費的損益兩平' },
    'pay.m18': { en: '18 Months', 'zh-CN': '18 个月', 'zh-TW': '18 個月' },
    'pay.m24': { en: '24 Months', 'zh-CN': '24 个月', 'zh-TW': '24 個月' },
    'pay.m48': { en: '48 Months', 'zh-CN': '48 个月', 'zh-TW': '48 個月' },
    'pay.target18': { en: '18M target days', 'zh-CN': '18 个月目标天数', 'zh-TW': '18 個月目標天數' },
    'pay.target24': { en: '24M target days', 'zh-CN': '24 个月目标天数', 'zh-TW': '24 個月目標天數' },
    'pay.target48': { en: '48M target days', 'zh-CN': '48 个月目标天数', 'zh-TW': '48 個月目標天數' },
    'pay.above': { en: '% above spot', 'zh-CN': '% 高于现价', 'zh-TW': '% 高於現價' },
    'pay.below': { en: '% below spot', 'zh-CN': '% 低于现价', 'zh-TW': '% 低於現價' },
    'pay.notDefined': { en: 'not defined', 'zh-CN': '无法计算', 'zh-TW': '無法計算' },
    'pay.note': {
      en: 'Repaying the machine itself out of cash flow, electricity covered. BTC above this level clears the capex inside the window; BTC below it does not.',
      'zh-CN': '用现金流回本矿机本身，电费已覆盖。币价高于此线，可在窗口期内收回 capex；低于此线则不能。',
      'zh-TW': '用現金流回本礦機本身，電費已涵蓋。幣價高於此線，可在視窗期內收回 capex；低於此線則不能。'
    },
    'pay.drawer': { en: 'How is this calculated?', 'zh-CN': '这是怎么算出来的？', 'zh-TW': '這是怎麼算出來的？' },

    /* ---------------- charts ---------------- */
    'ch1.title': { en: 'Shutdown Price', 'zh-CN': '关机币价', 'zh-TW': '關機幣價' },
    /* The horizon token is filled with the service life in YEARS — that is the
       unit the model takes as input, and `relabelDom` has exactly one number to
       give. It used to read "{n} months", which a 4-year machine rendered as
       "4 months, hashrate-adjusted": a horizon off by a factor of twelve. */
    'ch1.hint': { en: '{n}-year horizon, hashrate-adjusted', 'zh-CN': '{n} 年周期 · 按算力调整', 'zh-TW': '{n} 年週期 · 按算力調整' },
    'ch2.title': { en: 'Mining Cost / BTC', 'zh-CN': '每 BTC 挖矿成本', 'zh-TW': '每 BTC 挖礦成本' },
    'ch2.hint': { en: 'cumulative cost ÷ cumulative BTC', 'zh-CN': '累计成本 ÷ 累计产出', 'zh-TW': '累計成本 ÷ 累計產出' },
    'ch3.title': { en: 'Network Hashrate Growth', 'zh-CN': '全网算力增长', 'zh-TW': '全網算力成長' },
    'ch3.hint': { en: 'compound projection', 'zh-CN': '复利增长预测', 'zh-TW': '複利成長預測' },
    /* Chart 4 draws cumulative stacked bars (see chartBreakdown: every band is
       an accumulator), and its own tooltip already says 累计 / 累计电费 / 累计成本.
       The title names the same thing the marks do, so it says "cumulative" too —
       a panel titled "Cost Breakdown" reads as a per-year split, which is the
       one thing this chart does NOT show. */
    'ch4.title': { en: 'Cumulative Cost Breakdown', 'zh-CN': '成本构成累计', 'zh-TW': '成本構成累計' },
    'ch4.hint': { en: 'straight-line capex accrual', 'zh-CN': '矿机投入按直线折旧分摊', 'zh-TW': '礦機投入按直線折舊分攤' },
    'ch6.title': { en: 'Net Profit per BTC', 'zh-CN': '每 BTC 净利润', 'zh-TW': '每 BTC 淨利潤' },
    'ch7.title': { en: 'Cost / BTC vs Electricity Price', 'zh-CN': '成本 / 币价 对电价敏感度', 'zh-TW': '成本 / 幣價 對電價敏感度' },

    /* chart legends / axes */
    'cg.btcPrice': { en: 'BTC price', 'zh-CN': 'BTC 币价', 'zh-TW': 'BTC 幣價' },
    'cg.shutdown': { en: 'Shutdown price', 'zh-CN': '关机币价', 'zh-TW': '關機幣價' },
    'cg.halving': { en: 'Halving', 'zh-CN': '减半', 'zh-TW': '減半' },
    /* In-chart all-caps annotation. Kept apart from `cg.halving` (the legend
       entry, which is title case) so the chart's small-caps annotation style
       survives in English. */
    'cg.halvingMark': { en: 'HALVING', 'zh-CN': '减半', 'zh-TW': '減半' },
    'cg.margin': { en: 'Miner margin', 'zh-CN': '矿工毛利', 'zh-TW': '礦工毛利' },
    'cg.cost': { en: 'Cost / BTC', 'zh-CN': '每 BTC 成本', 'zh-TW': '每 BTC 成本' },
    'cg.hashrate': { en: 'Network hashrate', 'zh-CN': '全网算力', 'zh-TW': '全網算力' },
    'cg.capex': { en: 'Machine capex (sunk)', 'zh-CN': '矿机capex（沉没）', 'zh-TW': '礦機capex（沉沒）' },
    'cg.electricity': { en: 'Accumulated electricity', 'zh-CN': '累计电费', 'zh-TW': '累計電費' },
    'cg.electricity2': { en: 'Electricity', 'zh-CN': '电费', 'zh-TW': '電費' },
    'cg.btcProd': { en: 'BTC produced', 'zh-CN': '产出的 BTC', 'zh-TW': '產出的 BTC' },
    'cg.totalCost': { en: 'Total cost', 'zh-CN': '总成本', 'zh-TW': '總成本' },
    'cg.currentCost': { en: 'Current BTC price', 'zh-CN': '当前币价', 'zh-TW': '當前幣價' },
    'cg.now': { en: 'Now', 'zh-CN': '现在', 'zh-TW': '現在' },
    'cg.cumulative': { en: 'cumulative', 'zh-CN': '累计', 'zh-TW': '累計' },
    'cg.capexShort2': { en: 'Capex', 'zh-CN': '矿机投入', 'zh-TW': '礦機投入' },
    'cg.cumElec': { en: 'Cum. electricity', 'zh-CN': '累计电费', 'zh-TW': '累計電費' },
    'cg.cumCost': { en: 'Cum. cost', 'zh-CN': '累计成本', 'zh-TW': '累計成本' },
    'cg.netPerBtc': { en: 'Net per BTC', 'zh-CN': '每 BTC 净利润', 'zh-TW': '每 BTC 淨利潤' },
    'cg.realised': { en: 'realised', 'zh-CN': '实际成本', 'zh-TW': '實際成本' },
    'cg.daily': { en: 'daily', 'zh-CN': '每日', 'zh-TW': '每日' },
    'cg.months': { en: 'Months from today', 'zh-CN': '距今月数', 'zh-TW': '距今月數' },
    'cg.hashGrowthAxis': { en: 'Annual network hashrate growth', 'zh-CN': '全网算力年增长率', 'zh-TW': '全網算力年成長率' },
    'cg.elecAxis': {
      en: 'Electricity price (USDT / kWh) — below the dotted line the operation is profitable',
      'zh-CN': '电价（USDT / 度）—— 低于虚线即盈利',
      'zh-TW': '電價（USDT / 度）—— 低於虛線即獲利'
    },
    'cg.parity': { en: '100% — parity with spot', 'zh-CN': '100% — 与现货持平', 'zh-TW': '100% — 與現貨持平' },
    'cg.vsToday': { en: 'vs today', 'zh-CN': '较今日', 'zh-TW': '較今日' },
    'cg.hashrateShort': { en: 'hashrate', 'zh-CN': '算力', 'zh-TW': '算力' },
    'cg.btcGrowth': { en: 'BTC growth', 'zh-CN': '币价增长', 'zh-TW': '幣價成長' },
    /* Year tick on the hashrate axis. The month ticks stay "M6" — a compact
       fixed-width tick the engine's own row labels also use ("M01"…"M48") —
       while the year tick has no such counterpart, so it follows the locale. */
    'cg.yearTick': { en: 'Y', 'zh-CN': '年', 'zh-TW': '年' },
    'cg.ehUnit': { en: 'EH/s', 'zh-CN': 'EH/s', 'zh-TW': 'EH/s' },
    'cg.btcAccum': { en: 'BTC held', 'zh-CN': '持有的 BTC', 'zh-TW': '持有的 BTC' },
    'cg.spotLine': { en: 'Spot BTC price', 'zh-CN': 'BTC 现货价', 'zh-TW': 'BTC 現貨價' },
    'cg.barElec': { en: 'Electricity', 'zh-CN': '电费', 'zh-TW': '電費' },
    'cg.barCapex': { en: 'Machine capex', 'zh-CN': '矿机 capex', 'zh-TW': '礦機 capex' },

    /* ---------------- numbered nouns ---------------- */
    /* The projection panel that named these labels has been removed. Two
       patterns outlived it: the cost-breakdown axis still prints "Year 3" and
       the chart tooltips still head with "Month 7". They keep the `proj.`
       prefix because every remaining reference is in this file and in the
       chart that reads it through `I18N.yearLabel` / `I18N.monthLabel`, so a
       rename would be a wider diff for no reader-visible gain.
       A numbered noun is built from one pattern instead of "Year " + n, because
       the word order differs — English leads with the word, Chinese wraps the
       number. `I18N.yearLabel()` does the substitution, so the axis and the
       tooltip can never disagree. */
    'proj.yearN': { en: 'Year {n}', 'zh-CN': '第 {n} 年', 'zh-TW': '第 {n} 年' },
    'proj.month': { en: 'Month', 'zh-CN': '月份', 'zh-TW': '月份' },
    'proj.monthN': { en: 'Month {n}', 'zh-CN': '第 {n} 月', 'zh-TW': '第 {n} 月' },

    /* ---------------- monthly cost detail ---------------- */
    'mdet.title': { en: 'Monthly Cost Detail', 'zh-CN': '月度成本明细', 'zh-TW': '月度成本明細' },
    'mdet.hint': {
      en: 'one billing period per line, from the rack date',
      'zh-CN': '自上架日起，一个计费期一行',
      'zh-TW': '自上架日起，一個計費期一列'
    },
    'mdet.period': { en: 'Period no.', 'zh-CN': '期数', 'zh-TW': '期數' },
    'mdet.time': { en: 'Dates', 'zh-CN': '时间', 'zh-TW': '時間' },
    'mdet.impliedHash': { en: 'Implied network hashrate', 'zh-CN': '隐含全网算力', 'zh-TW': '隱含全網算力' },
    'mdet.subsidy': { en: 'Block subsidy', 'zh-CN': '区块奖励', 'zh-TW': '區塊獎勵' },
    'mdet.perTh': { en: 'BTC / TH / day', 'zh-CN': '每 T 日产出', 'zh-TW': '每 T 日產出' },
    'mdet.shutdown': { en: 'Shutdown price', 'zh-CN': '关机币价', 'zh-TW': '關機幣價' },
    'mdet.totalCost': { en: 'All-in monthly cost', 'zh-CN': '挖矿综合成本', 'zh-TW': '挖礦綜合成本' },
    'mdet.holdCost': { en: 'All-in cost basis', 'zh-CN': '综合持仓成本', 'zh-TW': '綜合持倉成本' },
    'mdet.holdCostHint': {
      en: 'All-in cost ÷ BTC produced',
      'zh-CN': '挖矿综合成本 ÷ 月产量',
      'zh-TW': '挖礦綜合成本 ÷ 月產量'
    },
    'mdet.btc': { en: 'BTC produced', 'zh-CN': '月产量', 'zh-TW': '月產量' },
    'mdet.elec': { en: 'Electricity', 'zh-CN': '月电费', 'zh-TW': '月電費' },
    'mdet.total': { en: 'Total', 'zh-CN': '合计', 'zh-TW': '合計' },
    'mdet.days': { en: 'days', 'zh-CN': '天', 'zh-TW': '天' },
    'mdet.nPeriods': { en: 'periods', 'zh-CN': '期', 'zh-TW': '期' },
    'mdet.pre': { en: 'pre-halving', 'zh-CN': '减半前', 'zh-TW': '減半前' },
    'mdet.post': { en: 'post-halving', 'zh-CN': '减半后', 'zh-TW': '減半後' },
    'mdet.payback': { en: 'Machine payback', 'zh-CN': '矿机回本', 'zh-TW': '礦機回本' },
    'mdet.note': {
      en: 'Period 1 starts on the rack date; each line is one real calendar month (28–31 days), so February is shorter than January. A month splits into two periods only when the halving day falls inside it — on the day the block height implies, never a hardcoded date, and no split when it lands on the first or last day. All-in cost = electricity + straight-line depreciation. All-in cost basis = all-in cost ÷ BTC produced in that period.',
      'zh-CN': '第 1 期自上架日起算；每期是一个真实自然月（28–31 天），所以 2 月比 1 月短。只有当减半那天落在该月内部时才拆成两期 —— 减半日期由区块高度推出，从不写死；落在月初或月末则不拆。综合成本 = 电费 + 直线折旧。综合持仓成本 = 当期综合成本 ÷ 当期产量。',
      'zh-TW': '第 1 期自上架日起算；每期是一個真實自然月（28–31 天），所以 2 月比 1 月短。只有當減半那天落在該月內部時才拆成兩期 —— 減半日期由區塊高度推出，從不寫死；落在月初或月末則不拆。綜合成本 = 電費 + 直線折舊。綜合持倉成本 = 當期綜合成本 ÷ 當期產量。'
    },

    /* ---------------- vs spot ---------------- */
    'vs.title': { en: 'Mining vs Buy & Hold', 'zh-CN': '挖矿 vs 直接买币', 'zh-TW': '挖礦 vs 直接買幣' },
    'vs.hint': { en: 'same capital, two routes', 'zh-CN': '同等资金 · 两条路径', 'zh-TW': '同等資金 · 兩條路徑' },
    'vs.miningNote': {
      en: 'Total BTC produced by the machine over its modelled life.',
      'zh-CN': '矿机在模型寿命期内产出的 BTC 总量。',
      'zh-TW': '礦機在模型壽命期內產出的 BTC 總量。'
    },
    /* The spot leg is CAPITAL-MATCHED (see engine `computeVsSpot`): it spends
       the machine plus the horizon's electricity, so this note has to name both
       halves. Captioning it "the machine's purchase price" while the arithmetic
       funds the electricity as well is the drift that made this copy wrong —
       the number moved and the caption stayed behind. The horizon token is the
       service life in YEARS, filled by `relabelDom`. */
    'vs.spotNote': {
      en: "Machine purchase cost plus {n} years of electricity, converted to BTC at today's spot price.",
      'zh-CN': '矿机购置成本 + {n} 年电费成本，按今日现货价折算成的 BTC。',
      'zh-TW': '礦機購置成本 + {n} 年電費成本，按今日現貨價折算成的 BTC。'
    },
    'vs.mining': { en: 'BTC from mining', 'zh-CN': '挖矿产出的 BTC', 'zh-TW': '挖礦產出的 BTC' },
    'vs.spot': { en: 'BTC from spot purchase', 'zh-CN': '现货买入的 BTC', 'zh-TW': '現貨買入的 BTC' },
    'vs.ratio': { en: 'Mining / Spot', 'zh-CN': '挖矿 / 现货', 'zh-TW': '挖礦 / 現貨' },
    'vs.perMining': { en: 'BTC per $1M spent (mining)', 'zh-CN': '每百万美元产出 BTC（挖矿）', 'zh-TW': '每百萬美元產出 BTC（挖礦）' },
    'vs.perSpot': { en: 'BTC per $1M spent (spot)', 'zh-CN': '每百万美元产出 BTC（现货）', 'zh-TW': '每百萬美元產出 BTC（現貨）' },
    'vs.exitPrice': { en: 'BTC exit price', 'zh-CN': 'BTC 离场价', 'zh-TW': 'BTC 離場價' },
    'vs.miningRoi': { en: 'Mining ROI', 'zh-CN': '挖矿 ROI', 'zh-TW': '挖礦 ROI' },
    'vs.spotRoi': { en: 'Spot ROI', 'zh-CN': '现货 ROI', 'zh-TW': '現貨 ROI' },
    'vs.recoverExit': { en: 'Exit price to recover mining cost', 'zh-CN': '收回挖矿成本的离场价', 'zh-TW': '收回挖礦成本的離場價' },
    'vs.spotBasis': { en: "Spot cost basis (today's price)", 'zh-CN': '现货成本基准（今日价格）', 'zh-TW': '現貨成本基準（今日價格）' },
    'vs.netProfit': { en: 'Net profit over the horizon', 'zh-CN': '全周期净利润', 'zh-TW': '全週期淨利潤' },
    'vs.parity': { en: '100% — parity', 'zh-CN': '100% — 持平', 'zh-TW': '100% — 持平' },

    /* ---------------- sensitivity ---------------- */
    'sens.title': { en: 'Sensitivity Analysis', 'zh-CN': '敏感度分析', 'zh-TW': '敏感度分析' },
    'sens.hint': { en: 'net profit per BTC produced', 'zh-CN': '每 BTC 净利润', 'zh-TW': '每 BTC 淨利潤' },
    'sens.grid': { en: 'BTC growth × Hashrate growth', 'zh-CN': '币价增长 × 算力增长', 'zh-TW': '幣價成長 × 算力成長' },
    'sens.corner': {
      en: 'BTC growth ↓ / Hashrate growth →',
      'zh-CN': '币价增长 ↓ / 算力增长 →',
      'zh-TW': '幣價成長 ↓ / 算力成長 →'
    },
    'sens.heatLabel': {
      en: 'Net profit per BTC produced — the only headline metric driven by both axes',
      'zh-CN': '每 BTC 净利润 —— 唯一同时受两个轴驱动的核心指标',
      'zh-TW': '每 BTC 淨利潤 —— 唯一同時受兩個軸驅動的核心指標'
    },
    'sens.scaleBoth': {
      en: 'Red = losing, green = profitable. Shade deepens toward the worst loss and the best gain.',
      'zh-CN': '红色 = 亏损，绿色 = 盈利。颜色越深代表亏损越大或盈利越高。',
      'zh-TW': '紅色 = 虧損，綠色 = 獲利。顏色越深代表虧損越大或獲利越高。'
    },
    'sens.scaleNeg': {
      en: 'Every cell loses money in this configuration. Shade runs light → dark from the smallest loss to the largest',
      'zh-CN': '此配置下每个格子都在亏损。颜色由浅到深，表示从最小亏损到最大亏损',
      'zh-TW': '此配置下每個格子都在虧損。顏色由淺到深，表示從最小虧損到最大虧損'
    },
    'sens.scalePos': {
      en: 'Every cell is profitable in this configuration. Shade runs light → dark from the smallest gain to the largest',
      'zh-CN': '此配置下每个格子都盈利。颜色由浅到深，表示从最小盈利到最大盈利',
      'zh-TW': '此配置下每個格子都獲利。顏色由淺到深，表示從最小獲利到最大獲利'
    },
    'sens.scaleNone': {
      en: 'No finite net-profit values in this configuration.',
      'zh-CN': '此配置下没有有效的净利润数值。',
      'zh-TW': '此配置下沒有有效的淨利潤數值。'
    },
    'sens.scaleNegPrefix': {
      en: 'Every cell loses money in this configuration. Shade runs light → dark from the smallest loss to the largest (',
      'zh-CN': '此配置下每个格子都亏损。颜色由浅到深，表示从最小亏损到最大亏损（',
      'zh-TW': '此配置下每個格子都虧損。顏色由淺到深，表示從最小虧損到最大虧損（'
    },
    'sens.scalePosPrefix': {
      en: 'Every cell is profitable in this configuration. Shade runs light → dark from the smallest gain to the largest (',
      'zh-CN': '此配置下每个格子都盈利。颜色由浅到深，表示从最小盈利到最大盈利（',
      'zh-TW': '此配置下每個格子都獲利。顏色由淺到深，表示從最小獲利到最大獲利（'
    },
    'sens.note': {
      en: 'Headline cost/BTC depends only on hashrate growth, and ROI depends only on the fixed exit price — so this table uses <b>net profit per BTC produced</b>, the one metric both axes move. Negative cells mean the cumulative cash flow does not repay the machine.',
      'zh-CN': '核心指标「每 BTC 成本」只受算力增长影响，而 ROI 只受固定离场价影响 —— 因此本表采用<b>每 BTC 净利润</b>，这是唯一同时受两个轴影响的指标。负值格表示全周期现金流无法收回矿机成本。',
      'zh-TW': '核心指標「每 BTC 成本」只受算力成長影響，而 ROI 只受固定離場價影響 —— 因此本表採用<b>每 BTC 淨利潤</b>，這是唯一同時受兩個軸影響的指標。負值格表示全週期現金流無法收回礦機成本。'
    },
    'sens.elec': { en: 'Electricity sensitivity', 'zh-CN': '电价敏感度', 'zh-TW': '電價敏感度' },
    'sens.powerPrice': { en: 'Power price', 'zh-CN': '电价', 'zh-TW': '電價' },
    'sens.costPerBtc': { en: 'Cost / BTC', 'zh-CN': '每 BTC 成本', 'zh-TW': '每 BTC 成本' },
    'sens.shutdown': { en: 'Shutdown', 'zh-CN': '关机币价', 'zh-TW': '關機幣價' },
    'sens.roi': { en: 'Mining ROI', 'zh-CN': '挖矿 ROI', 'zh-TW': '挖礦 ROI' },
    'sens.dailyPl': { en: 'Daily P/L', 'zh-CN': '每日盈亏', 'zh-TW': '每日損益' },
    'sens.perKwh': { en: '/ kWh', 'zh-CN': '/ 度', 'zh-TW': '/ 度' },

    /* ---------------- assumptions ---------------- */
    'asm.title': { en: 'Model Assumptions', 'zh-CN': '模型假设', 'zh-TW': '模型假設' },
    'asm.hint': { en: 'read before acting on any number above', 'zh-CN': '做任何决策前请先阅读', 'zh-TW': '做任何決策前請先閱讀' },
    'asm.1': {
      en: 'BTC production is estimated from miner hashrate relative to network hashrate, with 144 blocks per day assumed.',
      'zh-CN': '比特币产量按单机算力占全网算力的比例估算，假设每天出块 144 个。',
      'zh-TW': '比特幣產量按單機算力佔全網算力的比例估算，假設每天出塊 144 個。'
    },
    'asm.2': {
      en: 'Network hashrate is projected with compound monthly growth derived from the annual rate.',
      'zh-CN': '全网算力按年化增长率折算成月复利增长推算。',
      'zh-TW': '全網算力按年化成長率折算成月複利成長推算。'
    },
    'asm.3': {
      en: 'Block subsidy halves every 210,000 blocks; the next halving is inferred from the current block height.',
      'zh-CN': '区块奖励每 210,000 个块减半一次；下次减半由当前区块高度推算得出。',
      'zh-TW': '區塊獎勵每 210,000 個區塊減半一次；下次減半由當前區塊高度推算得出。'
    },
    'asm.4': {
      en: 'Electricity cost = power ÷ 1000 × 24 × price × uptime. Uptime reduces consumption as well as production.',
      'zh-CN': '电费 = 功耗 ÷ 1000 × 24 × 电价 × 在线率。在线率同时影响耗电和产出。',
      'zh-TW': '電費 = 功耗 ÷ 1000 × 24 × 電價 × 線上率。線上率同時影響耗電和產出。'
    },
    'asm.5': {
      en: 'Machine cost is booked once as upfront capex. The production cost divides that capex plus all electricity by total BTC produced.',
      'zh-CN': '矿机成本作为一次性 capex 计入。生产成本 =（矿机 capex + 全部电费）÷ 累计产出的 BTC。',
      'zh-TW': '礦機成本作為一次性 capex 計入。生產成本 =（礦機 capex + 全部電費）÷ 累計產出的 BTC。'
    },
    'asm.6': {
      en: 'Pool fees reduce effective BTC production.',
      'zh-CN': '矿池费会减少实际到手的 BTC 产量。',
      'zh-TW': '礦池費會減少實際到手的 BTC 產量。'
    },
    'asm.7': {
      en: 'The model excludes taxes, financing, transport, maintenance, and unexpected downtime unless entered as inputs.',
      'zh-CN': '模型不包含税费、融资成本、运输、维护和意外停机，除非你手动作为参数输入。',
      'zh-TW': '模型不包含稅費、融資成本、運輸、維護和意外停機，除非你手動作為參數輸入。'
    },
    'asm.8': {
      en: 'Results are estimates based on user-selected assumptions and are not investment advice.',
      'zh-CN': '结果基于用户设定的假设，仅为估算，不构成投资建议。',
      'zh-TW': '結果基於使用者設定的假設，僅為估算，不構成投資建議。'
    },
    'asm.2prefix': {
      en: 'Network hashrate is projected with compound monthly growth derived from the annual rate:',
      'zh-CN': '全网算力按年增长率推导出的月复利增长进行预测：',
      'zh-TW': '全網算力按年成長率推導出的月複利成長進行預測：'
    },
    'asm.3prefix': {
      en: 'Block subsidy halves every 210,000 blocks; the next halving is inferred from the current block height',
      'zh-CN': '区块奖励每 210,000 个区块减半；下次减半由当前区块高度推导',
      'zh-TW': '區塊獎勵每 210,000 個區塊減半；下次減半由當前區塊高度推導'
    },
    'asm.3suffix': { en: 'estimated', 'zh-CN': '预计', 'zh-TW': '預計' },
    'asm.6prefix': {
      en: 'Pool fees reduce effective BTC production by',
      'zh-CN': '矿池费使实际 BTC 产量减少',
      'zh-TW': '礦池費使實際 BTC 產量減少'
    },
    'asm.formulas': { en: 'Formulas used in this model', 'zh-CN': '本模型使用的公式', 'zh-TW': '本模型使用的公式' },

    /* ---------------- data source panel ---------------- */
    'data.title': { en: 'Model Data', 'zh-CN': '模型数据', 'zh-TW': '模型資料' },
    'data.hint': { en: 'sources and freshness', 'zh-CN': '数据来源与更新时间', 'zh-TW': '資料來源與更新時間' },
    'data.btcPrice': { en: 'BTC Price', 'zh-CN': 'BTC 价格', 'zh-TW': 'BTC 價格' },
    'data.hashrate': { en: 'Network Hashrate', 'zh-CN': '全网算力', 'zh-TW': '全網算力' },
    'data.difficulty': { en: 'Difficulty', 'zh-CN': '挖矿难度', 'zh-TW': '挖礦難度' },
    'data.blockHeight': { en: 'Block Height', 'zh-CN': '区块高度', 'zh-TW': '區塊高度' },
    'data.subsidy': { en: 'Block Subsidy', 'zh-CN': '区块奖励', 'zh-TW': '區塊獎勵' },
    'data.snapshot': { en: 'Snapshot taken', 'zh-CN': '快照时间', 'zh-TW': '快照時間' },
    'data.halvingSched': { en: 'halving schedule', 'zh-CN': '减半时间表', 'zh-TW': '減半時間表' },
    'data.share': { en: 'Share this model', 'zh-CN': '分享此模型', 'zh-TW': '分享此模型' },
    'share.title': { en: 'Share this model', 'zh-CN': '分享此模型', 'zh-TW': '分享此模型' },
    'share.hint': { en: 'parameters encoded in the URL', 'zh-CN': '参数已编码进链接', 'zh-TW': '參數已編碼進連結' },
    'share.aria': { en: 'Shareable model URL', 'zh-CN': '可分享的模型链接', 'zh-TW': '可分享的模型連結' },
    'data.shareNote': {
      en: 'Anyone opening the link restores every parameter. Live values (BTC price, network hashrate) follow their own <b>Live / Manual</b> switch, so a shared link always starts tracking the market again unless overridden.',
      'zh-CN': '任何人打开该链接都会还原全部参数。实时数据（BTC 币价、全网算力）各自跟随 <b>实时 / 手动</b> 开关，因此分享出去的链接默认会重新跟踪市场，除非接收者手动覆盖。',
      'zh-TW': '任何人打開該連結都會還原全部參數。即時資料（BTC 幣價、全網算力）各自跟隨 <b>即時 / 手動</b> 開關，因此分享出去的連結預設會重新追蹤市場，除非接收者手動覆蓋。'
    },

    /* ---------------- live / manual ---------------- */
    'live.live': { en: 'Live', 'zh-CN': '实时', 'zh-TW': '即時' },
    'live.manual': { en: 'Manual', 'zh-CN': '手动', 'zh-TW': '手動' },
    'live.override': { en: 'Manual override', 'zh-CN': '手动覆盖', 'zh-TW': '手動覆蓋' },
    'live.ago': { en: 'Live', 'zh-CN': '实时', 'zh-TW': '即時' },

    /* ---------------- toasts ---------------- */
    'toast.copied': { en: 'Link copied', 'zh-CN': '链接已复制', 'zh-TW': '連結已複製' },
    'toast.reset': { en: 'Reset to live defaults', 'zh-CN': '已重置为实时默认值', 'zh-TW': '已重設為即時預設值' },
    'toast.lang': { en: 'Language switched', 'zh-CN': '语言已切换', 'zh-TW': '語言已切換' },

    /* ---------------- status / errors ---------------- */
    'status.live': { en: 'Live', 'zh-CN': '实时', 'zh-TW': '即時' },
    'status.snapshot': { en: 'Snapshot', 'zh-CN': '快照', 'zh-TW': '快照' },
    'status.offline': { en: 'Offline — manual entry available', 'zh-CN': '离线 —— 可手动输入', 'zh-TW': '離線 —— 可手動輸入' },
    'na.payback': { en: 'No Payback', 'zh-CN': '无法回本', 'zh-TW': '無法回本' },
    'na.value': { en: 'N/A', 'zh-CN': '不适用', 'zh-TW': '不適用' },
    'na.noBtc': {
      en: 'Mining produces no BTC under the current inputs, so the comparison is not defined.',
      'zh-CN': '当前参数下挖矿不产出任何 BTC，因此无法比较。',
      'zh-TW': '當前參數下挖礦不產出任何 BTC，因此無法比較。'
    },
    'unit.days': { en: 'days', 'zh-CN': '天', 'zh-TW': '天' },
    'unit.months': { en: 'months', 'zh-CN': '个月', 'zh-TW': '個月' },
    'unit.blocks': { en: 'blocks', 'zh-CN': '个区块', 'zh-TW': '個區塊' },
    'unit.yr': { en: 'yr', 'zh-CN': '年', 'zh-TW': '年' },
    'unit.dShort': { en: 'd', 'zh-CN': '天', 'zh-TW': '天' },
    'unit.secAgo': { en: 'sec ago', 'zh-CN': '秒前', 'zh-TW': '秒前' },
    'unit.minAgo': { en: 'min ago', 'zh-CN': '分钟前', 'zh-TW': '分鐘前' },
    'unit.hAgo': { en: 'h ago', 'zh-CN': '小时前', 'zh-TW': '小時前' },
    'unit.dAgo': { en: 'd ago', 'zh-CN': '天前', 'zh-TW': '天前' },
    'time.unknown': { en: 'unknown', 'zh-CN': '未知', 'zh-TW': '未知' },
    'time.snapshot': { en: '(snapshot)', 'zh-CN': '（快照）', 'zh-TW': '（快照）' },
    'time.est': { en: '(est.)', 'zh-CN': '（估算）', 'zh-TW': '（估算）' },
    'unit.btc': { en: 'BTC', 'zh-CN': 'BTC', 'zh-TW': 'BTC' },
    'unit.perDay': { en: '/ day', 'zh-CN': '/ 天', 'zh-TW': '/ 天' },
    'unit.btcPerBlock': { en: 'BTC/blk', 'zh-CN': 'BTC/区块', 'zh-TW': 'BTC/區塊' },
    'unit.block': { en: 'Block', 'zh-CN': '区块', 'zh-TW': '區塊' },
    'unit.perKwh': { en: '$ / kWh', 'zh-CN': '$ / 度', 'zh-TW': '$ / 度' },
    'unit.perKwhShort': { en: '/ kWh', 'zh-CN': '/ 度', 'zh-TW': '/ 度' },

    /* ---------------- miner cooling type ---------------- */
    'cool.air-cooled': { en: 'air-cooled', 'zh-CN': '风冷', 'zh-TW': '風冷' },
    'cool.hydro': { en: 'hydro', 'zh-CN': '水冷', 'zh-TW': '水冷' },
    'cool.manual': { en: 'manual', 'zh-CN': '手动', 'zh-TW': '手動' },

    /* ---------------- footer ---------------- */
    'footer.note': {
      en: 'Estimates only. Not investment advice.',
      'zh-CN': '仅为估算，不构成投资建议。',
      'zh-TW': '僅為估算，不構成投資建議。'
    },
    'footer.author': { en: 'Author', 'zh-CN': '作者', 'zh-TW': '作者' },
    'share.note': {
      en: 'Anyone opening the link restores every parameter. Live values (BTC price, network hashrate) follow their own Live / Manual switch, so a shared link always starts tracking the market again unless overridden.',
      'zh-CN': '任何人打开链接都会还原全部参数。实时值（BTC 币价、全网算力）各自跟随其「实时／手动」开关，因此除非被覆盖，分享链接始终从跟随行情开始。',
      'zh-TW': '任何人打開連結都會還原全部參數。即時值（BTC 幣價、全網算力）各自跟隨其「即時／手動」開關，因此除非被覆蓋，分享連結始終從跟隨行情開始。'
    },

    /* ---------------- formulas (methodology drawer) ---------------- */
    'fx.how': { en: 'How is this calculated?', 'zh-CN': '这是怎么算出来的？', 'zh-TW': '這是怎麼算出來的？' },
    'fx.eff': {
      en: 'Efficiency = Power ÷ Hashrate',
      'zh-CN': '能效比 = 功耗 ÷ 算力',
      'zh-TW': '能效比 = 功耗 ÷ 算力'
    },
    'fx.effNote': {
      en: "Also known as the machine's specific consumption. Lower J/TH means the same electricity buys more hashrate.",
      'zh-CN': '也叫矿机的单位功耗。J/TH 越低，同样电费能买到更多算力。',
      'zh-TW': '也叫礦機的單位功耗。J/TH 越低，同樣電費能買到更多算力。'
    },
    'fx.net': {
      en: 'Network hashrate is the denominator of every BTC production figure.',
      'zh-CN': '全网算力是每一个 BTC 产量数字的分母。',
      'zh-TW': '全網算力是每一個 BTC 產量數字的分母。'
    },
    'fx.sub': {
      en: 'Subsidy(era) = 50 ÷ 2^era, era = floor(height ÷ 210,000)',
      'zh-CN': '奖励(周期) = 50 ÷ 2^周期, 周期 = floor(高度 ÷ 210,000)',
      'zh-TW': '獎勵(週期) = 50 ÷ 2^週期, 週期 = floor(高度 ÷ 210,000)'
    },
    'fx.halv': {
      en: 'Next halving = (floor(height ÷ 210,000) + 1) × 210,000',
      'zh-CN': '下次减半 = (floor(高度 ÷ 210,000) + 1) × 210,000',
      'zh-TW': '下次減半 = (floor(高度 ÷ 210,000) + 1) × 210,000'
    },
    'fx.btcPerTh': {
      en: 'BTC/TH/day = subsidy × 144 ÷ (networkHashrate × 1e6)',
      'zh-CN': '每 TH 日产出 = 区块奖励 × 144 ÷ (全网算力 × 1e6)',
      'zh-TW': '每 TH 日產出 = 區塊獎勵 × 144 ÷ (全網算力 × 1e6)'
    },
    'fx.btcPerTh.d': { en: 'Theoretical output per TH of hashrate per day', 'zh-CN': '每 TH 算力每日的理论产出', 'zh-TW': '每 TH 算力每日的理論產出' },
    'fx.minerBtc': {
      en: 'Miner BTC/day = BTC/TH/day × hashrate × uptime × (1 − poolFee)',
      'zh-CN': '单机日产出 = 每 TH 日产出 × 单机算力 × 在线率 × (1 − 矿池费)',
      'zh-TW': '單機日產出 = 每 TH 日產出 × 單機算力 × 線上率 × (1 − 礦池費)'
    },
    'fx.minerBtc.d': { en: 'Net credited production', 'zh-CN': '实际到手的产量', 'zh-TW': '實際到手的產量' },
    'fx.elec': {
      en: 'Daily electricity = power ÷ 1000 × 24 × price × uptime',
      'zh-CN': '每日电费 = 功耗 ÷ 1000 × 24 × 电价 × 在线率',
      'zh-TW': '每日電費 = 功耗 ÷ 1000 × 24 × 電價 × 線上率'
    },
    'fx.elec.d': { en: 'Power cost per unit per day', 'zh-CN': '单机每日电费', 'zh-TW': '單機每日電費' },
    'fx.elecNote': {
      en: 'Uptime scales consumption down as well as production, so a partially online machine saves power but also earns less.',
      'zh-CN': '在线率同时压低耗电与产量：机器部分在线时既省电、也少赚。',
      'zh-TW': '線上率同時壓低耗電與產量：機器部分線上時既省電、也少賺。'
    },
    'fx.spotLive': {
      en: 'Live price is read from the baked market snapshot. Switch to Manual to model any scenario — the whole dashboard, the shutdown curve and all charts respond immediately.',
      'zh-CN': '实时价格读取自内置行情快照。切到「手动」即可模拟任意情景——整个看板、关机曲线与所有图表都会立即响应。',
      'zh-TW': '即時價格讀取自內建行情快照。切到「手動」即可模擬任意情境——整個看板、關機曲線與所有圖表都會立即響應。'
    },
    'fx.spotFeed': {
      en: 'BTC Price → Feed into: revenue, cost ratio, mining ROI, spot ROI, payback prices',
      'zh-CN': 'BTC 币价 → 输入到：收入、成本比、挖矿 ROI、现货 ROI、回本币价',
      'zh-TW': 'BTC 幣價 → 輸入到：收入、成本比、挖礦 ROI、現貨 ROI、回本幣價'
    },
    'fx.netNote': {
      en: 'The live value is the mempool.space network estimate. A 4% spread against difficulty-derived figures is normal — this is a snapshot, not a real-time feed.',
      'zh-CN': '实时值取自 mempool.space 的全网估算。与按难度推算的结果相差 4% 以内属正常范围——这是快照，不是实时数据流。',
      'zh-TW': '即時值取自 mempool.space 的全網估算。與按難度推算的結果相差 4% 以內屬正常範圍——這是快照，不是即時資料流。'
    },
    'fx.subNote': {
      en: 'Detected automatically from block height. Not hard-coded to a calendar date.',
      'zh-CN': '由区块高度自动推算，不硬编码为固定日历日期。',
      'zh-TW': '由區塊高度自動推算，不硬編碼為固定日曆日期。'
    },
    'fx.height': { en: 'Current height', 'zh-CN': '当前高度', 'zh-TW': '當前高度' },
    'fx.blocks': { en: 'Blocks remaining', 'zh-CN': '剩余区块', 'zh-TW': '剩餘區塊' },
    'fx.estDate': { en: 'Estimated date', 'zh-CN': '预估日期', 'zh-TW': '預估日期' },
    'fx.power': { en: 'Power', 'zh-CN': '功耗', 'zh-TW': '功耗' },
    'fx.price': { en: 'Price', 'zh-CN': '电价', 'zh-TW': '電價' },
    'fx.uptime': { en: 'Uptime', 'zh-CN': '在线率', 'zh-TW': '線上率' },
    'fx.dailyCost': { en: 'Daily cost', 'zh-CN': '每日成本', 'zh-TW': '每日成本' },
    'fx.result': { en: 'Result', 'zh-CN': '结果', 'zh-TW': '結果' },
    'fx.machine': {
      en: 'Daily machine cost = machine price ÷ (life years × 365)',
      'zh-CN': '每日折旧 = 矿机价格 ÷ (使用年限 × 365)',
      'zh-TW': '每日折舊 = 礦機價格 ÷ (使用年限 × 365)'
    },
    'fx.machine.d': { en: 'Straight-line amortisation', 'zh-CN': '直线折旧法', 'zh-TW': '直線折舊法' },
    'fx.total': {
      en: 'Daily total cost = machine cost + electricity',
      'zh-CN': '每日总成本 = 折旧 + 电费',
      'zh-TW': '每日總成本 = 折舊 + 電費'
    },
    'fx.total.d': { en: 'All-in daily cost', 'zh-CN': '每日综合成本', 'zh-TW': '每日綜合成本' },
    'fx.revenue': {
      en: 'Daily revenue = miner BTC/day × BTC price',
      'zh-CN': '每日收入 = 单机日产出 × BTC 币价',
      'zh-TW': '每日收入 = 單機日產出 × BTC 幣價'
    },
    'fx.revenue.d': { en: 'Gross daily income', 'zh-CN': '每日毛收入', 'zh-TW': '每日毛收入' },
    'fx.profit': {
      en: 'Daily net profit = revenue − total cost',
      'zh-CN': '每日净利润 = 收入 − 总成本',
      'zh-TW': '每日淨利潤 = 收入 − 總成本'
    },
    'fx.profit.d': { en: 'Bottom line per unit per day', 'zh-CN': '单机每日最终盈亏', 'zh-TW': '單機每日最終損益' },
    'fx.shutdown': {
      en: 'Shutdown price = daily total cost ÷ miner BTC/day',
      'zh-CN': '关机币价 = 每日总成本 ÷ 单机日产出',
      'zh-TW': '關機幣價 = 每日總成本 ÷ 單機日產出'
    },
    'fx.shutdown.d': { en: 'Cash break-even BTC price', 'zh-CN': '现金盈亏平衡币价', 'zh-TW': '現金損益兩平幣價' },
    'fx.ratio': {
      en: 'Cost ratio = daily total cost ÷ daily revenue',
      'zh-CN': '成本比 = 每日总成本 ÷ 每日收入',
      'zh-TW': '成本比 = 每日總成本 ÷ 每日收入'
    },
    'fx.ratio.d': { en: 'Cost pressure gauge', 'zh-CN': '成本压力指标', 'zh-TW': '成本壓力指標' },
    'fx.payback': {
      en: 'Static payback = machine price ÷ daily net profit',
      'zh-CN': '静态回本 = 矿机价格 ÷ 每日净利润',
      'zh-TW': '靜態回本 = 礦機價格 ÷ 每日淨利潤'
    },
    'fx.payback.d': { en: 'Cash-flow payback period', 'zh-CN': '现金流回本周期', 'zh-TW': '現金流回本週期' },
    'fx.paybackTarget': {
      en: 'Required BTC price = (machine price ÷ target days + daily electricity) ÷ miner BTC/day',
      'zh-CN': '所需币价 = (矿机价格 ÷ 目标天数 + 每日电费) ÷ 单机日产出',
      'zh-TW': '所需幣價 =（礦機價格 ÷ 目標天數 + 每日電費）÷ 單機日產出'
    },
    'fx.paybackTarget.d': {
      en: 'Price needed for electricity-only payback within the target window',
      'zh-CN': '在目标周期内仅靠电费回本所需的币价',
      'zh-TW': '在目標週期內僅靠電費回本所需的幣價'
    },
    'fx.prodCost': {
      en: 'Production cost = (capex + total electricity) ÷ total BTC produced',
      'zh-CN': '生产成本 =（矿机 capex + 全部电费）÷ 累计产出的 BTC',
      'zh-TW': '生產成本 =（礦機 capex + 全部電費）÷ 累計產出的 BTC'
    },
    'fx.prodCost.d': {
      en: 'Actual realised cost per BTC over the full projection',
      'zh-CN': '整个预测期内每枚 BTC 的真实成本',
      'zh-TW': '整個預測期內每枚 BTC 的真實成本'
    },
    /* Same capital on both sides of the division: the spot leg funds the capex
       AND the horizon's electricity, so the formula names the matched outlay
       rather than just the machine price. A reference sheet that disagrees with
       the panel it documents is worse than no reference sheet. */
    'fx.miningSpot': {
      en: 'Mining/Spot = Σ mining BTC × BTC price ÷ (capex + horizon electricity)',
      'zh-CN': '挖矿/现货 = Σ 挖矿产出 BTC × 币价 ÷（矿机 capex + 全周期电费）',
      'zh-TW': '挖礦/現貨 = Σ 挖礦產出 BTC × 幣價 ÷（礦機 capex + 全週期電費）'
    },
    'fx.miningSpot.d': {
      en: 'Accumulation comparison on matched capital (capex + horizon electricity)',
      'zh-CN': '同等资金下的累计持币对比（矿机 capex + 全周期电费）',
      'zh-TW': '同等資金下的累計持幣對比（礦機 capex + 全週期電費）'
    }
  };

  /* ----------------------------------------------------------------------
   * Language state
   * -------------------------------------------------------------------- */
  var current = DEFAULT_LANG;

  function normalize(code) {
    if (!code) return null;
    var c = String(code).toLowerCase();
    if (c === 'zh' || c === 'zh-cn' || c === 'zh-hans' || c === 'zh-sg') return 'zh-CN';
    if (c === 'zh-tw' || c === 'zh-hk' || c === 'zh-mo' || c === 'zh-hant') return 'zh-TW';
    if (c.indexOf('en') === 0) return 'en';
    return null;
  }

  function detect() {
    var saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) { }
    if (saved && SUPPORTED.indexOf(saved) >= 0) return saved;

    /* first visit — follow the browser, preferring an exact region match */
    var list = [];
    try {
      if (navigator.languages && navigator.languages.length) list = navigator.languages.slice();
      else if (navigator.language) list = [navigator.language];
    } catch (e) { }
    for (var i = 0; i < list.length; i++) {
      var n = normalize(list[i]);
      if (n) return n;
    }
    return DEFAULT_LANG;
  }

  function persist(lang) {
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) { }
  }

  /** Look up a key in the active locale, falling back to English then the key. */
  function t(key, lang) {
    var entry = STRINGS[key];
    if (!entry) return key;
    var L = lang || current;
    var v = entry[L];
    if (v === undefined || v === null || v === '') v = entry[DEFAULT_LANG];
    return v === undefined || v === null ? key : v;
  }

  /** True when the key exists — used by the missing-translation audit. */
  function has(key) { return Object.prototype.hasOwnProperty.call(STRINGS, key); }

  /** Substitute the number into a "{n}" pattern. Kept private: callers go
   *  through `yearLabel` / `monthLabel` so the pattern key is never guessed. */
  function numbered(key, n) {
    return t(key).replace('{n}', String(n));
  }

  /** "Year 1" / "第 1 年" — the word order differs, so the number is a token in
   *  the pattern rather than a concatenation. The cost-breakdown axis and the
   *  chart tooltips both come through here, so no two surfaces can disagree.
   *  `charts.js` delegates to these rather than re-substituting the pattern. */
  function yearLabel(n) { return numbered('proj.yearN', n); }

  /** "Month 3" / "第 3 月" — the chart tooltip heading. The detail table's own
   *  date column is a real calendar span; this is prose, so it follows the
   *  locale. */
  function monthLabel(n) { return numbered('proj.monthN', n); }

  /** Fill the "{n}" token in any pattern. Used for copy that carries the
   *  horizon: a 3-year machine must not still be reading "48 months,
   *  hashrate-adjusted". `relabelDom` applies it to static labels and the
   *  JS-built strings call it directly, so both routes agree. */
  function fill(text, n) {
    return String(text === undefined || text === null ? '' : text).replace('{n}', String(n));
  }

  function localeMeta(lang) {
    var L = lang || current;
    for (var i = 0; i < LOCALES.length; i++) if (LOCALES[i].key === L) return LOCALES[i];
    return LOCALES[0];
  }

  /** Every key in the table — lets the audit walk the whole corpus. */
  function keys() { return Object.keys(STRINGS); }

  root.I18N = {
    t: t, has: has, keys: keys,
    yearLabel: yearLabel, monthLabel: monthLabel, fill: fill,
    detect: detect, persist: persist,
    normalize: normalize,
    localeMeta: localeMeta,
    SUPPORTED: SUPPORTED,
    LOCALES: LOCALES,
    DEFAULT_LANG: DEFAULT_LANG,
    STORE_KEY: STORE_KEY,
    get current() { return current; },
    /* Refuse anything we cannot render. A corrupted share link or a stale
       localStorage value must not be able to install a locale with no strings,
       which would silently blank the UI. */
    set current(v) {
      if (SUPPORTED.indexOf(v) >= 0) current = v;
      return current;
    }
  };
}(window));
