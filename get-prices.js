/**
 * Get Prices Helper Script
 *
 * 用途: ダッシュボード（Streamlit）と バックエンド（trading-engine）の
 *       価格取得を完全に同一ソースに統一するため、Node.js 側で価格を
 *       取得し JSON で stdout に返す軽量スクリプト。
 *
 * 使い方:
 *   node get-prices.js 7203 6758 9984
 *   → stdout: {"7203":{"price":2150,"source":"yahoo","name":"トヨタ自動車"}, ...}
 *
 * 価格取得の優先順位:
 *   1. Yahoo Finance v8 chart API を crumb 不要モードで直接フェッチ（ブラウザUA）
 *   2. yahoo-finance2 ライブラリ（crumb 自動処理）
 *   3. Stooq CSV（前日終値、認証不要）
 *
 * 各段階でリトライ＋ジッタを挟んで 429（Rate Limit）耐性を高めている。
 */

// ─────────────────────────────────────────────────────────────
//  stdout 汚染対策（yahoo-finance2 のサーベイ通知などを stderr へ）
// ─────────────────────────────────────────────────────────────
import https from 'https';

const _origStdoutWrite = process.stdout.write.bind(process.stdout);
const NOISE_PATTERNS = [
  'yahoo-finance-api-feedback',
  'survey',
  'suppressNotices',
  'gadicc/node-yahoo-finance2',
];

process.stdout.write = function (chunk, ...rest) {
  if (typeof chunk === 'string' && NOISE_PATTERNS.some(p => chunk.includes(p))) {
    return process.stderr.write(chunk, ...rest);
  }
  if (Buffer.isBuffer(chunk)) {
    const s = chunk.toString('utf8');
    if (NOISE_PATTERNS.some(p => s.includes(p))) {
      return process.stderr.write(chunk, ...rest);
    }
  }
  return _origStdoutWrite(chunk, ...rest);
};

console.log  = (...a) => process.stderr.write(a.join(' ') + '\n');
console.info = (...a) => process.stderr.write(a.join(' ') + '\n');

const { default: YahooFinanceClass } = await import('yahoo-finance2');

const yf = new YahooFinanceClass({
  logger: {
    info:  () => {},
    warn:  () => {},
    error: () => {},
    debug: () => {},
  },
});
try {
  if (typeof yf.suppressNotices === 'function') {
    yf.suppressNotices(['yahooSurvey', 'ripHistorical']);
  }
} catch (_) { /* noop */ }

// ─────────────────────────────────────────────────────────────
//  共通ヘルパー
// ─────────────────────────────────────────────────────────────
const UA_POOL = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];
const pickUA = () => UA_POOL[Math.floor(Math.random() * UA_POOL.length)];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpsGetJSON(url, { timeoutMs = 8000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      timeout: timeoutMs,
      headers: {
        'User-Agent': pickUA(),
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Referer': 'https://finance.yahoo.com/',
        ...headers,
      },
    };
    const req = https.get(url, opts, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpsGetText(url, { timeoutMs = 8000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      timeout: timeoutMs,
      headers: { 'User-Agent': pickUA(), ...headers },
    };
    const req = https.get(url, opts, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─────────────────────────────────────────────────────────────
//  ① Yahoo v8 chart API を直接フェッチ（crumb 不要）
//     ブラウザ偽装 + リトライで 429 を回避
// ─────────────────────────────────────────────────────────────
async function getYahooChartDirect(symbol) {
  const yahooSym = /^\d{4}$/.test(symbol) ? `${symbol}.T` : symbol;

  // 期間: 直近5日（リアルタイムの当日価格 + 直近終値を取得）
  const end   = Math.floor(Date.now() / 1000);
  const start = end - 5 * 24 * 60 * 60;

  // 2つのホスト + 2つのインターバルを試す
  const candidates = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?period1=${start}&period2=${end}&interval=1m&includePrePost=true`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?period1=${start}&period2=${end}&interval=5m&includePrePost=true`,
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=1d&interval=1m&includePrePost=true`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=5d&interval=1d`,
  ];

  for (let attempt = 0; attempt < candidates.length; attempt++) {
    const url = candidates[attempt];
    try {
      // ジッタ（短いランダム待機）で 429 を避ける
      if (attempt > 0) await sleep(300 + Math.random() * 400);

      const data = await httpsGetJSON(url, { timeoutMs: 6000 });
      const r = data?.chart?.result?.[0];
      if (!r) continue;
      const meta = r.meta || {};

      // 最も新しい closes/highs (intraday なら最新の足) → meta.regularMarketPrice
      const closes = r?.indicators?.quote?.[0]?.close ?? [];
      const lastClose = [...closes].reverse().find(v => v != null);
      const price = meta.regularMarketPrice ?? lastClose;

      if (price && price > 0) {
        // 取引時間内 or 直前 → marketState で判定
        const state = meta.marketState || 'UNKNOWN';
        const tradingDay = meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10)
          : null;
        return {
          price: Math.round(price * 100) / 100,
          source: state === 'REGULAR' ? 'yahoo-live' : 'yahoo',
          name: meta.shortName || meta.longName || symbol,
          marketState: state,
          tradingDay,
          previousClose: meta.previousClose ?? null,
        };
      }
    } catch (e) {
      process.stderr.write(`[yahoo direct ${attempt}] ${yahooSym}: ${e.message}\n`);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
//  ② yahoo-finance2 ライブラリ経由（crumb 自動取得 — レート制限される場合あり）
// ─────────────────────────────────────────────────────────────
async function getYahooViaLibrary(symbol) {
  const yahooSym = /^\d{4}$/.test(symbol) ? `${symbol}.T` : symbol;

  try {
    const q = await yf.quote(yahooSym);
    const p = q?.regularMarketPrice ?? q?.postMarketPrice ?? q?.preMarketPrice;
    if (p && p > 0) {
      return {
        price: Math.round(p * 100) / 100,
        source: q.marketState === 'REGULAR' ? 'yahoo-live' : 'yahoo',
        name: q.shortName || q.longName || symbol,
        marketState: q.marketState || null,
        previousClose: q.regularMarketPreviousClose ?? null,
      };
    }
  } catch (e) {
    process.stderr.write(`[yf2 quote] ${yahooSym}: ${e.message}\n`);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
//  ③ Stooq CSV（最終フォールバック — 前日終値）
// ─────────────────────────────────────────────────────────────
async function getStooqPrice(symbol) {
  const stooqSym = /^\d{4}$/.test(symbol) ? `${symbol}.jp` : symbol.toLowerCase();
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSym)}&f=sd2t2ohlcv&h&e=csv`;

  try {
    const csv = await httpsGetText(url, { timeoutMs: 6000 });
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const header = lines[0].toLowerCase().split(',');
    const row    = lines[1].split(',');
    const idx    = name => header.indexOf(name);

    const close = parseFloat(row[idx('close')]);
    if (!close || isNaN(close)) return null;

    return {
      price: Math.round(close * 100) / 100,
      source: 'stooq',
      name: symbol,
      tradingDay: row[idx('date')] || null,
    };
  } catch (e) {
    process.stderr.write(`[stooq] ${stooqSym}: ${e.message}\n`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  メイン
// ─────────────────────────────────────────────────────────────
async function fetchOne(symbol) {
  // ① Yahoo を直接フェッチ（crumb 不要、ブラウザ偽装）
  const direct = await getYahooChartDirect(symbol);
  if (direct) return direct;

  // ② yahoo-finance2 経由（crumb 必要）
  const lib = await getYahooViaLibrary(symbol);
  if (lib) return lib;

  // ③ Stooq（前日終値）
  const stooq = await getStooqPrice(symbol);
  if (stooq) return stooq;

  return null;
}

function emitJSON(obj) {
  _origStdoutWrite(JSON.stringify(obj) + '\n');
}

async function main() {
  const symbols = process.argv.slice(2);
  if (symbols.length === 0) {
    emitJSON({});
    return;
  }

  const result = {};
  // 並行取得（最大同時3 — 429 回避のため抑え気味）
  const CONCURRENCY = 3;
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(batch.map(s => fetchOne(s).catch(() => null)));
    batch.forEach((s, k) => { result[s] = fetched[k]; });
    // バッチ間のジッタ
    if (i + CONCURRENCY < symbols.length) {
      await sleep(200 + Math.random() * 300);
    }
  }

  emitJSON(result);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  emitJSON({});
  process.exit(0);
});
