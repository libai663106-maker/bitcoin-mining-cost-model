#!/usr/bin/env node
/* ==========================================================================
 * Rebuild data/market.json from the public mempool.space endpoints.
 *
 * This replaces the build-time "bake" step. It runs either locally
 * (`node scripts/refresh_market.mjs`) or inside GitHub Actions, and needs
 * nothing but Node 18+ — the global fetch does the HTTP work.
 *
 * On any network or parse failure it exits non-zero WITHOUT touching
 * data/market.json, so a flaky API day can never publish a corrupt snapshot.
 * ========================================================================== */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://mempool.space/api';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'market.json');
const INDEX = join(ROOT, 'index.html');

const BLOCKS_PER_HALVING = 210000;
const BLOCKS_PER_DAY = 144;

async function getJSON(path, label) {
  process.stdout.write(`→ ${label}\n`);
  const res = await fetch(API + path, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return res.json();
}

async function getText(path, label) {
  process.stdout.write(`→ ${label}\n`);
  const res = await fetch(API + path, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  return (await res.text()).trim();
}

/* Raw figures arrive in H/s; the model speaks EH/s. */
const toEH = (h) => Number((h / 1e18).toFixed(2));

function main(prices, hashrate, heightText) {
  const btcPrice = prices.USD;
  const height = Number(heightText);

  if (!Number.isFinite(btcPrice)) throw new Error('prices.USD missing');
  if (!Number.isFinite(height) || height <= 0) throw new Error('bad block height');
  if (!hashrate.currentHashrate) throw new Error('currentHashrate missing');

  const tail = hashrate.hashrates.slice(-7).map((r) => r.avgHashrate);
  const mean7d = tail.reduce((a, b) => a + b, 0) / tail.length;

  /* Subsidy is derived from height, never from a calendar date. */
  const era = Math.floor(height / BLOCKS_PER_HALVING);
  const subsidy = 50 / 2 ** era;
  const nextHalving = (era + 1) * BLOCKS_PER_HALVING;
  const remaining = nextHalving - height;
  const daysLeft = Math.round(remaining / BLOCKS_PER_DAY);

  const halvingEst = new Date(Date.now() + daysLeft * 86400000).toISOString().slice(0, 10);

  const snapshot = {
    _comment:
      'Bitcoin Mining Cost Model — live snapshot refreshed in CI. See .github/workflows/refresh-market.yml',
    asof_utc: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    btc_price_usd: btcPrice,
    network_hashrate_ehs: toEH(hashrate.currentHashrate),
    network_hashrate_7d_ehs: toEH(mean7d),
    difficulty: hashrate.currentDifficulty,
    block_height: height,
    block_subsidy_btc: subsidy,
    next_halving_height: nextHalving,
    blocks_per_halving: BLOCKS_PER_HALVING,
    blocks_remaining_to_halving: remaining,
    next_halving_est_date: halvingEst,
    blocks_per_day: BLOCKS_PER_DAY,
    hashrate_90d_change_pct: null,
    hashrate_1y_change_pct: null,
    sources: {
      btc_price_usd: 'mempool.space/api/v1/prices (USD)',
      network_hashrate_ehs: 'mempool.space/api/v1/mining/hashrate/3y (currentHashrate)',
      network_hashrate_7d_ehs: 'same endpoint, 7-day trailing mean',
      difficulty: 'mempool.space/api/v1/mining/hashrate/3y (currentDifficulty)',
      block_height: 'mempool.space/api/blocks/tip/height',
      block_subsidy_btc: 'derived: 50 / 2^floor(height / 210000)',
    },
  };

  console.log(
    `  BTC $${btcPrice} · ${snapshot.network_hashrate_ehs} EH/s · height ${height} · ` +
      `era ${era} · subsidy ${subsidy}`
  );
  console.log(`  halving ${nextHalving} in ${daysLeft}d (~${halvingEst})`);

  return snapshot;
}

/* ----- run ----- */
try {
  const [prices, hashrate, heightText] = await Promise.all([
    getJSON('/v1/prices', 'BTC price'),
    getJSON('/v1/mining/hashrate/3y', 'network hashrate + difficulty'),
    getText('/blocks/tip/height', 'block height'),
  ]);

  const snapshot = main(prices, hashrate, heightText);

  /* Write to a temp file and rename: the swap is atomic, so a reader never
     sees a half-written snapshot. */
  const tmp = OUT + '.tmp';
  await writeFile(tmp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  JSON.parse(await readFile(tmp, 'utf8')); // parse gate — never publish bad JSON
  await rename(tmp, OUT);
  console.log(`✓ data/market.json updated`);

  /* The inline fallback keeps file:// previews working, so it must not drift
     away from the served snapshot. Same numbers, relabelled sources. */
  const html = await readFile(INDEX, 'utf8');
  const RE = /window\.__MARKET_FALLBACK__ = \{[\s\S]*?\n\};/;
  if (!RE.test(html)) {
    throw new Error('inline __MARKET_FALLBACK__ block not found in index.html');
  }
  const fallback = structuredClone(snapshot);
  for (const key of Object.keys(fallback.sources)) {
    fallback.sources[key] = 'baked snapshot (offline fallback)';
  }
  await writeFile(
    INDEX,
    html.replace(RE, 'window.__MARKET_FALLBACK__ = ' + JSON.stringify(fallback, null, 2) + ';'),
    'utf8'
  );
  console.log(`✓ index.html fallback synced`);
} catch (err) {
  console.error(`✗ refresh failed: ${err.message}`);
  console.error('  data/market.json left untouched.');
  process.exit(1);
}
