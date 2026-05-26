/**
 * Data Fetcher Module
 * yahoo-finance2 で現在価格を取得、Yahoo Finance v8 API でチャートデータを取得。
 * 失敗時はシンボルハッシュベースのモックにフォールバック。
 */

// yahoo-finance2の通知がstdoutに混入するのを防ぐため
// console.log/info を stderr にリダイレクト（JSON出力の汚染対策）
const _origConsoleLog  = console.log;
const _origConsoleInfo = console.info;
console.log  = (...args) => process.stderr.write(args.join(' ') + '\n');
console.info = (...args) => process.stderr.write(args.join(' ') + '\n');

import YahooFinanceClass from 'yahoo-finance2';
import https from 'https';
import logger from '../utils/logger.js';
import { DataFetchError } from '../utils/errors.js';

// HTTPS ヘルパー — ブラウザUA偽装で 429 回避
const _UA_POOL = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
];
const _pickUA = () => _UA_POOL[Math.floor(Math.random() * _UA_POOL.length)];

function _httpsGetText(url, timeoutMs = 8000, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      timeout: timeoutMs,
      headers: { 'User-Agent': _pickUA(), ...extraHeaders },
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

function _httpsGetJSON(url, timeoutMs = 8000) {
  return _httpsGetText(url, timeoutMs, {
    Accept: 'application/json,text/plain,*/*',
    Referer: 'https://finance.yahoo.com/',
  }).then(JSON.parse);
}

// yahoo-finance2 v2.x はクラスをエクスポートするため new でインスタンス化が必要
// loggerをstderrに向けてstdoutをJSONのみにする
const yahooFinance = new YahooFinanceClass({
  logger: {
    info:  (...a) => process.stderr.write('[yf2] ' + a.join(' ') + '\n'),
    warn:  (...a) => process.stderr.write('[yf2] ' + a.join(' ') + '\n'),
    error: (...a) => process.stderr.write('[yf2] ' + a.join(' ') + '\n'),
    debug: (..._a) => {},
  },
});


class DataFetcher {

  // ─────────────────────────────────────────────────────────────
  //  メインメソッド
  // ─────────────────────────────────────────────────────────────

  /**
   * 株式データを取得（現在価格 + 過去70日の日足）
   * 実データ取得を試み、失敗した場合はモックにフォールバック
   */
  async getStockData(symbol) {
    const yahooSymbol = this.normalizeSymbol(symbol);

    try {
      return await this._fetchRealData(symbol, yahooSymbol);
    } catch (error) {
      logger.warn(`⚠️ [DataFetcher] リアルデータ取得失敗 ${yahooSymbol}: ${error.message} — モックデータにフォールバック（取引スキップ対象）`);
      return this._mockData(symbol);
    }
  }

  /**
   * リアルタイム引用を取得
   */
  async getQuote(symbol) {
    const yahooSymbol = this.normalizeSymbol(symbol);

    try {
      const quote = await yahooFinance.quote(yahooSymbol);
      const price = quote.regularMarketPrice
        ?? quote.postMarketPrice
        ?? quote.preMarketPrice
        ?? null;
      if (!price) throw new Error('No price in quote response');

      return {
        symbol,
        price,
        change:        quote.regularMarketChange        ?? 0,
        changePercent: quote.regularMarketChangePercent ?? 0,
        bid:           quote.bid   ?? price - 1,
        ask:           quote.ask   ?? price + 1,
        volume:        quote.regularMarketVolume ?? 0,
        marketCap:     quote.marketCap ?? null,
        name:          quote.shortName ?? quote.longName ?? symbol,
      };
    } catch (error) {
      logger.debug(`Quote fetch failed for ${yahooSymbol}: ${error.message} — using mock`);
      return this._mockQuote(symbol);
    }
  }

  /**
   * 複数銘柄のデータを並行取得
   */
  async getMultipleStockData(symbols) {
    const results = await Promise.all(
      symbols.map(symbol =>
        this.getStockData(symbol).catch(err => ({
          error: true, symbol, message: err.message,
        }))
      )
    );
    const failed = results.filter(r => r.error);
    if (failed.length > 0) {
      logger.warn(`Failed to fetch: ${failed.map(d => d.symbol).join(', ')}`);
    }
    return results.filter(r => !r.error);
  }

  // ─────────────────────────────────────────────────────────────
  //  内部メソッド
  // ─────────────────────────────────────────────────────────────

  /**
   * 実データ取得メイン
   * ① quote() で現在価格
   * ② Yahoo Finance v8 chart API でOHLCV履歴データ
   * ③ chart失敗 → quote情報から疑似履歴を生成（currentPriceは実データ）
   * ④ 両方失敗 → 例外スロー → 呼び元がmockにフォールバック
   */
  async _fetchRealData(symbol, yahooSymbol) {
    const end   = new Date();
    const start = new Date(end.getTime() - 75 * 24 * 60 * 60 * 1000); // 75日

    let currentPrice = null;
    let quoteData = null;
    let priceSource = null;

    // ── ① yahoo-finance2 quote API（最優先 — regularMarketPrice が最も正確） ──
    try {
      quoteData = await yahooFinance.quote(yahooSymbol);
      const p = quoteData.regularMarketPrice
        ?? quoteData.postMarketPrice
        ?? quoteData.preMarketPrice
        ?? null;
      if (p && p > 0) {
        currentPrice = p;
        const state = quoteData.marketState ?? '不明';
        const stateLabel = state === 'REGULAR' ? '取引中' : state === 'CLOSED' ? '終値' : state === 'POST' ? '時間外' : state;
        priceSource = `quote API [${stateLabel}]`;
        logger.info(`  💹 ${symbol} 株価取得: ¥${currentPrice.toFixed(0)} （${priceSource}）`);
      }
    } catch (e) {
      logger.debug(`  [yf2-quote] ${yahooSymbol} failed: ${e.message}`);
    }

    // ── ② チャート直接フェッチ（価格が取れなかった場合のフォールバック） ──
    if (!currentPrice) {
      try {
        const direct = await this._fetchYahooDirect(yahooSymbol);
        if (direct?.price) {
          currentPrice = direct.price;
          if (!quoteData) quoteData = direct.meta;
          const state = direct.meta?.marketState ?? '不明';
          const stateLabel = state === 'REGULAR' ? '取引中' : state === 'CLOSED' ? '終値' : state;
          priceSource = `チャートAPI [${stateLabel}]`;
          logger.info(`  💹 ${symbol} 株価取得: ¥${currentPrice.toFixed(0)} （${priceSource}）`);
        }
      } catch (e) {
        logger.debug(`  [yahoo-direct] ${yahooSymbol} failed: ${e.message}`);
      }
    }

    // ── ③ チャート履歴データ（OHLCV — 現在価格とは独立して取得） ──
    let historical = null;
    try {
      historical = await this._fetchChartDirect(yahooSymbol, start, end);
      logger.debug(`  [chart] ${symbol}: ${historical.length}日分取得`);
    } catch (e) {
      logger.debug(`  [chart] ${yahooSymbol} failed: ${e.message}`);
    }

    // ── ④ Yahoo 全失敗 → Stooq CSV にフォールバック ──────────────
    if (!currentPrice && !historical) {
      const stooq = await this._fetchStooq(symbol).catch(e => {
        logger.debug(`  [stooq] ${symbol} failed: ${e.message}`);
        return null;
      });
      if (stooq) {
        currentPrice = stooq.price;
        priceSource = 'Stooq（終値）';
        logger.info(`  💹 ${symbol} 株価取得: ¥${currentPrice.toFixed(0)} （${priceSource}）`);
      }
    }

    // ── ⑤ それでも価格が取れない → 例外（呼び元がmock処理） ──────
    if (!currentPrice && !historical) {
      throw new DataFetchError(`All sources failed for ${symbol}`, symbol);
    }

    // ── ⑥ chart失敗 → quoteデータで疑似履歴生成（価格は実値） ────
    if (!historical) {
      historical = this._buildHistoricalFromQuote(currentPrice, quoteData, 75);
      logger.debug(`  [synth] ${symbol}: quote から疑似履歴 ${historical.length}日生成`);
    }

    // ── ⑦ quote失敗 → chartの最終終値で代替 ──────────────────────
    if (!currentPrice) {
      const last = historical[historical.length - 1];
      currentPrice = last?.close ?? null;
      if (!currentPrice) throw new DataFetchError(`No price data for ${symbol}`, symbol);
      logger.info(`  💹 ${symbol} 株価取得: ¥${currentPrice.toFixed(0)} （チャート終値フォールバック）`);
    }

    // 最低データ数チェック
    if (historical.length < 10) {
      throw new DataFetchError(`Too few data points (${historical.length}) for ${symbol}`, symbol);
    }

    logger.debug(`  [Real] ${symbol}: ¥${currentPrice.toFixed(0)} (history: ${historical.length}日)`);

    return {
      symbol,
      currentPrice,
      lastUpdate: new Date(),
      historical,
      isRealData: true,
    };
  }

  /**
   * Yahoo Finance v8 chart API を直接叩いて日足OHLCVを取得
   * yahoo-finance2インスタンスの内部_fetchを利用してcrumb/cookieを自動処理
   */
  async _fetchChartDirect(yahooSymbol, start, end) {
    const p1 = Math.floor(start.getTime() / 1000);
    const p2 = Math.floor(end.getTime() / 1000);

    // yahoo-finance2の内部_fetchを使ってcrumb/cookieを自動ハンドリング
    // needsCrumb=trueで内部のcookieJarを通じてcrumbを取得・付与する
    const urlBase = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}`;
    const params  = {
      period1:       p1,
      period2:       p2,
      interval:      '1d',
      includePrePost: false,
      events:        'div,splits',
    };

    let data;
    try {
      // yahoo-finance2内部フェッチ（crumb自動処理）
      data = await yahooFinance._fetch.call(yahooFinance, urlBase, params, {}, 'json', true);
    } catch (fetchErr) {
      // needsCrumb=false で再試行（古いendpointは不要な場合あり）
      data = await yahooFinance._fetch.call(yahooFinance, urlBase, params, {}, 'json', false);
    }

    const result = data?.chart?.result?.[0];
    if (!result?.timestamp?.length) {
      throw new DataFetchError(`No chart data in response for ${yahooSymbol}`, yahooSymbol);
    }

    const timestamps = result.timestamp;
    const quotes     = result.indicators?.quote?.[0] ?? {};
    const adjCloses  = result.indicators?.adjclose?.[0]?.adjclose ?? [];

    const rows = timestamps.map((ts, i) => {
      const close = quotes.close?.[i] ?? null;
      if (close == null) return null;
      return {
        date:     this.formatDate(new Date(ts * 1000)),
        open:     quotes.open?.[i]   ?? close,
        high:     quotes.high?.[i]   ?? close,
        low:      quotes.low?.[i]    ?? close,
        close,
        volume:   quotes.volume?.[i] ?? 0,
        adjClose: adjCloses[i]       ?? close,
      };
    }).filter(Boolean);

    if (rows.length < 5) {
      throw new DataFetchError(`Too few chart rows (${rows.length}) for ${yahooSymbol}`, yahooSymbol);
    }

    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Yahoo v8 chart API を crumb 不要で直接フェッチ
   * 大引け後しばらくは intraday 1分足の最終値 = 大引け値が返る
   * @returns {{ price, meta } | null}
   */
  async _fetchYahooDirect(yahooSymbol) {
    // 当日の intraday を最優先（範囲: 直近5日, インターバル: 1m）
    const candidates = [
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m&includePrePost=false`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=1m&includePrePost=false`,
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5d&interval=5m`,
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1mo&interval=1d`,
    ];
    for (let i = 0; i < candidates.length; i++) {
      try {
        if (i > 0) await new Promise(r => setTimeout(r, 250 + Math.random() * 300));
        const data = await _httpsGetJSON(candidates[i], 6000);
        const r = data?.chart?.result?.[0];
        if (!r) continue;
        const meta = r.meta || {};
        const closes = r?.indicators?.quote?.[0]?.close ?? [];
        const lastClose = [...closes].reverse().find(v => v != null);
        const price = meta.regularMarketPrice ?? lastClose;
        if (price && price > 0) return { price, meta };
      } catch (e) {
        // 次の候補へ
      }
    }
    return null;
  }

  /**
   * Stooq CSV から現在価格を取得（Yahoo の最終フォールバック）
   * 認証不要・JSON parseエラー不発
   * URL例: https://stooq.com/q/l/?s=7203.jp&f=sd2t2ohlcv&h&e=csv
   */
  async _fetchStooq(symbol) {
    const stooqSym = /^\d{4}$/.test(symbol) ? `${symbol}.jp` : symbol.toLowerCase();
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSym)}&f=sd2t2ohlcv&h&e=csv`;
    const csv = await _httpsGetText(url);
    const lines = csv.trim().split('\n');
    if (lines.length < 2) throw new Error('Stooq CSV empty');
    const header = lines[0].toLowerCase().split(',');
    const row    = lines[1].split(',');
    const idxOf  = n => header.indexOf(n);
    const close  = parseFloat(row[idxOf('close')]);
    if (!close || isNaN(close)) throw new Error('Stooq close invalid');
    return {
      price: close,
      date: row[idxOf('date')] || null,
      source: 'stooq',
    };
  }

  /**
   * quote()の集計フィールドから疑似履歴データを生成
   * （chart取得失敗時のフォールバック）
   * 現在価格・52週高安・50日平均などを使って滑らかなデータを作成
   */
  _buildHistoricalFromQuote(currentPrice, quoteData, days) {
    const fiftyDayAvg    = quoteData?.fiftyDayAverage    ?? currentPrice;
    const twoHundredAvg  = quoteData?.twoHundredDayAverage ?? currentPrice;
    const weekHigh52     = quoteData?.fiftyTwoWeekHigh   ?? currentPrice * 1.3;
    const weekLow52      = quoteData?.fiftyTwoWeekLow    ?? currentPrice * 0.7;
    const baseVolume     = quoteData?.averageDailyVolume10Day ?? quoteData?.regularMarketVolume ?? 1_000_000;

    // 200日平均 → 50日平均 → 現在価格 へのトレンドを模倣
    const data  = [];
    const now   = new Date();
    const range = weekHigh52 - weekLow52;

    for (let i = days; i > 0; i--) {
      // iが大きい（古い）ほど200日平均に近く、0（現在）に近づくほど現在価格
      const t     = (days - i) / days;                  // 0→1 (古い→新しい)
      const trend = twoHundredAvg + t * (currentPrice - twoHundredAvg);
      const noise = (Math.random() - 0.5) * range * 0.03;
      const close = Math.max(weekLow52, Math.min(weekHigh52, trend + noise));
      const hl    = close * 0.01;
      const open  = close * (1 + (Math.random() - 0.5) * 0.008);
      const date  = new Date(now);
      date.setDate(date.getDate() - i);

      data.push({
        date:     this.formatDate(date),
        open,
        high:     Math.max(open, close) + Math.random() * hl,
        low:      Math.min(open, close) - Math.random() * hl,
        close,
        volume:   Math.floor(baseVolume * (0.7 + Math.random() * 0.6)),
        adjClose: close,
      });
    }

    return data;
  }

  /**
   * モックデータを生成（実データが完全に取れない場合のフォールバック）
   * シンボルハッシュで価格を決定し、銘柄ごとに一貫した価格帯を使用
   */
  _mockData(symbol) {
    const hash      = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const mockPrice = 200 + (hash % 7800);

    logger.debug(`  [Mock] ${symbol}: ¥${mockPrice.toFixed(0)}`);

    const result = this.generateMockHistoricalData(mockPrice, 60);
    result.sort((a, b) => new Date(a.date) - new Date(b.date));
    const currentPrice = result[result.length - 1].close;

    return {
      symbol,
      currentPrice,
      lastUpdate: new Date(result[result.length - 1].date),
      historical: result.map(item => ({
        date:     this.formatDate(item.date),
        open:     item.open,
        high:     item.high,
        low:      item.low,
        close:    item.close,
        volume:   item.volume ?? 0,
        adjClose: item.adjClose,
      })),
      isRealData: false,
    };
  }

  _mockQuote(symbol) {
    const hash      = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const basePrice = 200 + (hash % 7800);
    const change    = (Math.random() - 0.5) * basePrice * 0.02;
    return {
      symbol,
      price:         basePrice,
      change,
      changePercent: (change / basePrice) * 100,
      bid:           basePrice - 1,
      ask:           basePrice + 1,
      volume:        Math.floor(Math.random() * 5_000_000) + 500_000,
      marketCap:     null,
      name:          symbol,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  ユーティリティ
  // ─────────────────────────────────────────────────────────────

  /**
   * デモ用のモック履歴データを生成（トレンドあり）
   * 60% 上昇トレンド / 20% 下降トレンド / 20% レンジ
   */
  generateMockHistoricalData(basePrice, days) {
    const data = [];
    const now  = new Date();

    const rand = Math.random();
    let dailyDrift, volumeTrend;
    if (rand < 0.60) {
      dailyDrift  = 0.0015 + Math.random() * 0.002;
      volumeTrend = 1.2;
    } else if (rand < 0.80) {
      dailyDrift  = -(0.0015 + Math.random() * 0.002);
      volumeTrend = 0.9;
    } else {
      dailyDrift  = (Math.random() - 0.5) * 0.001;
      volumeTrend = 1.0;
    }

    const trendStartDay = Math.floor(Math.random() * 20);
    const baseVolume    = Math.floor(Math.random() * 3_000_000) + 1_500_000;

    for (let i = days; i > 0; i--) {
      const date       = new Date(now);
      date.setDate(date.getDate() - i);

      const activeDrift      = i <= trendStartDay + 30 ? dailyDrift : 0;
      const volatility       = 0.012 + Math.random() * 0.008;
      const noise            = (Math.random() - 0.5) * 2 * volatility;
      const close            = Math.max(100, basePrice * (1 + activeDrift + noise));
      const open             = close * (1 + (Math.random() - 0.5) * volatility * 0.5);
      const high             = Math.max(open, close) * (1 + Math.random() * 0.008);
      const low              = Math.min(open, close) * (1 - Math.random() * 0.008);
      const volumeMultiplier = i <= trendStartDay + 20 ? volumeTrend : 1.0;
      const volume           = Math.floor(baseVolume * volumeMultiplier * (0.7 + Math.random() * 0.6));

      data.push({ date, open, high, low, close, volume, adjClose: close });
      basePrice = close;
    }

    return data;
  }

  /**
   * 株式シンボルを正規化（日本株 → 末尾 .T を付与）
   */
  normalizeSymbol(symbol) {
    if (symbol.includes('.')) return symbol;
    if (/^\d{4}$/.test(symbol))  return `${symbol}.T`;
    return symbol;
  }

  formatDate(date) {
    const d     = new Date(date);
    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day   = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

export default DataFetcher;
