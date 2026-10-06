# Bitcoin Mining Cost Model · 比特币挖矿成本模型

纯静态的挖矿成本测算工具。输入矿机参数、电价、全网算力，输出每 BTC 全成本、关机价、静态回本、多年算力增长仿真，以及「挖矿 vs 现货买入持有」对比。

无需构建，无需后端，无第三方 SDK。

## 在线地址

**<https://libai663106-maker.github.io/bitcoin-mining-cost-model/>**

GitHub Pages 自动部署：`main` 分支推送后即刻生效，数据源是 `main` 分支根目录。

## 本地运行

仓库根目录就是站点根目录，直接打开 `index.html` 即可。需要 HTTP 环境（比如要验证相对路径）时：

```bash
python -m http.server 8000
# 然后访问 http://localhost:8000
```

### 自检

零依赖 Node 测试（Node 18+）：

```bash
node scripts/test_engine.js     # 计算引擎
node scripts/test_i18n.js       # 多语言文案
node scripts/test_indicators.js # 面板指标
node scripts/verify.js          # 全量
```

## 目录结构

```
index.html            单页应用（含内联首帧主题脚本）
styles/tokens.css     设计变量 / 主题
styles/app.css        版式
scripts/engine.js     计算引擎（唯一数值真相来源）
scripts/charts.js     SVG 图表（自绘，无图表库）
scripts/app.js        状态、绑定、渲染
scripts/i18n.js       en / zh-CN / zh-TW
data/market.json      行情快照（CI 每日刷新）
.github/workflows/    定时刷新快照 + 提交
```

`qa/` 是截图与浏览器 profile 的产物，已在 `.gitignore` 中排除，不进仓库。

## 行情数据

页面本身不调用第三方 API（CORS 限制 + 无法放密钥），改为读取仓库内的 `data/market.json` 快照。
每天 UTC 03:17 由 GitHub Actions 调用 `scripts/refresh_market.mjs` 拉取 mempool.space 并写回；数据有变化才提交。

手动触发：`Actions → Refresh market snapshot → Run workflow`。

## 部署

GitHub Pages，`Deploy from a branch` → 分支 `main`，目录 `/ (root)`。
根目录的 `.nojekyll` 保证静态资源不被 Jekyll 过滤。

## License

MIT © [@miner_huang](https://x.com/miner_huang)
