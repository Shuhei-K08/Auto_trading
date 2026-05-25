/**
 * Stock Scanner
 * 大型ユニバース（JPX ~3800銘柄 or スタティック ~350銘柄）から
 * ランダムサンプリング → テクニカルスコア評価 → 軍資金比率フィルタ → 上位候補を絞り込む
 *
 * 【軍資金比率フィルタ】
 *   利用可能な現金（availableCash）に対して、最低 1 単元（100株）を
 *   購入できる銘柄のみを候補に残す。
 *   例: availableCash=1,000,000円 → 1単元が300,000円以内（=株価3,000円以下）の銘柄のみ
 *
 * 【株価帯スコア】
 *   軍資金に対して "ちょうどよい" 株価帯（資金の3〜15%で1単元買える）の銘柄に
 *   ボーナスを付与し、極端に高い・低い銘柄を自然に下位に落とす。
 */

import logger from '../utils/logger.js';
import DataFetcher from '../api/data-fetcher.js';
import TechnicalAnalyzerV2 from '../analyzer/technical-analyzer-v2.js';
import { getDynamicUniverse } from './stock-universe.js';
import config from '../config.js';

// スキャン設定
const SCAN_CONFIG = {
  sampleSize: 200,           // 毎回ランダムに選ぶ銘柄数（ユニバース全体から）
  topCandidatesCount: 20,    // Claudeに渡す上位候補数
  finalWatchlistSize: 8,     // 最終ウォッチリストの銘柄数
  maxPerSector: 2,           // セクターあたり最大銘柄数（分散のため）
  minTechnicalScore: 35,     // 最低テクニカルスコア（緩めに設定）
  batchSize: 15,             // 並行取得バッチサイズ
  batchDelayMs: 100,         // バッチ間ウェイト（ms）

  // ── 軍資金比率フィルタ ────────────────────────────────────
  // availableCash の何%以内で 1 単元（100株）を購入できるか（上限）
  // 0.30 = 30% → 資金100万なら最大30万円/単元（株価3,000円以下）の銘柄
  maxSingleLotRatio: 0.30,

  // 株価帯スコアボーナスの "理想帯"（資金の何%で1単元買えるか）
  idealLotRatioMin: 0.03,    // 3% 以上で1単元（流動性確保）
  idealLotRatioMax: 0.15,    // 15% 以内で1単元（集中投資にならない）
};

class StockScanner {
  constructor() {
    this.dataFetcher = new DataFetcher();
    this.analyzer = new TechnicalAnalyzerV2();
    this._universe = null;
  }

  /**
   * ユニバースを初回ロード（JPX優先）
   */
  async loadUniverse() {
    if (!this._universe) {
      this._universe = await getDynamicUniverse();
    }
    return this._universe;
  }

  /**
   * ユニバースから sampleSize 銘柄をランダムサンプリング
   * セクター分布が偏らないよう各セクターから均等に抽出
   */
  sampleUniverse(universe, sampleSize) {
    const bySector = {};
    for (const stock of universe) {
      const s = stock.sector ?? 'その他';
      if (!bySector[s]) bySector[s] = [];
      bySector[s].push(stock);
    }

    const sectors = Object.keys(bySector);
    const perSector = Math.max(3, Math.floor(sampleSize / sectors.length));
    const sampled = [];

    for (const sector of sectors) {
      const stocks = bySector[sector];
      const shuffled = [...stocks].sort(() => Math.random() - 0.5);
      sampled.push(...shuffled.slice(0, perSector));
    }

    if (sampled.length < sampleSize) {
      const remaining = universe
        .filter(s => !sampled.includes(s))
        .sort(() => Math.random() - 0.5);
      sampled.push(...remaining.slice(0, sampleSize - sampled.length));
    }

    return sampled.sort(() => Math.random() - 0.5).slice(0, sampleSize);
  }

  /**
   * 軍資金に対する株価帯フィルタ & スコアリング
   *
   * @param {number} price      現在株価
   * @param {number} available  利用可能現金
   * @returns {{ pass: boolean, lotRatio: number, priceScore: number, reason: string }}
   */
  checkCapitalRatio(price, available) {
    const LOT = 100; // 1単元株数（日本株標準）
    const lotCost = price * LOT;

    // available が 0 / NaN / undefined の場合は常に通過（ガード）
    if (!available || available <= 0 || !isFinite(available)) {
      return { pass: true, lotRatio: 0, priceScore: 0, reason: '資金不明のため通過' };
    }

    const lotRatio = lotCost / available; // 1単元に資金の何%かかるか

    // フィルタ: maxSingleLotRatio を超えたら除外
    if (lotRatio > SCAN_CONFIG.maxSingleLotRatio) {
      return {
        pass: false,
        lotRatio,
        priceScore: 0,
        reason: `1単元¥${lotCost.toLocaleString('ja-JP')} = 資金の${(lotRatio * 100).toFixed(1)}%（上限${SCAN_CONFIG.maxSingleLotRatio * 100}%超）`,
      };
    }

    // 理想帯にあればスコアボーナス (+15〜0)
    let priceScore = 0;
    if (lotRatio >= SCAN_CONFIG.idealLotRatioMin && lotRatio <= SCAN_CONFIG.idealLotRatioMax) {
      // 理想帯内: 中心(9%)に近いほど高スコア
      const center = (SCAN_CONFIG.idealLotRatioMin + SCAN_CONFIG.idealLotRatioMax) / 2;
      const spread = (SCAN_CONFIG.idealLotRatioMax - SCAN_CONFIG.idealLotRatioMin) / 2;
      priceScore = Math.round(15 * (1 - Math.abs(lotRatio - center) / spread));
    } else if (lotRatio < SCAN_CONFIG.idealLotRatioMin) {
      // 株価が安すぎ（デイトレ向き過ぎる）→ 小さいペナルティ
      priceScore = -5;
    }

    return {
      pass: true,
      lotRatio,
      priceScore,
      reason: `1単元¥${lotCost.toLocaleString('ja-JP')} = 資金の${(lotRatio * 100).toFixed(1)}%（理想帯スコア:${priceScore > 0 ? '+' : ''}${priceScore}）`,
    };
  }

  /**
   * ユニバースをスキャンして上位候補を返す
   *
   * @param {object} options
   * @param {number} [options.sampleSize]      ランダムサンプル数
   * @param {boolean} [options.fullScan=false] true にすると全銘柄スキャン（遅い）
   * @param {number} [options.availableCash]   利用可能現金（省略時は config から読む）
   * @returns {Array} スコア付きの上位候補リスト
   */
  async scanUniverse(options = {}) {
    const universe = await this.loadUniverse();
    const sampleSize = options.fullScan ? universe.length
      : (options.sampleSize ?? SCAN_CONFIG.sampleSize);

    // 軍資金フィルタ用の利用可能現金
    const availableCash = options.availableCash
      ?? config.trading.portfolioValue
      ?? 1_000_000;

    // ── 0xxx コードを除外 ──────────────────────────────────────────
    // 2022年以降の新規IPO割当コード。Yahoo Finance / Stooq が未対応または
    // 上場直後で履歴データが不足しており、全件データ取得失敗になるため除外。
    const scannable = universe.filter(s => !/^0\d{3}$/.test(s.symbol));

    const sample = this.sampleUniverse(scannable, sampleSize);

    logger.info(`\n${'='.repeat(55)}`);
    logger.info('Stock Universe Scan Started');
    logger.info(`Full universe:  ${universe.length} 銘柄 (0xxx除外後: ${scannable.length} 銘柄)`);
    logger.info(`This scan:      ${sample.length} 銘柄をランダムサンプリング`);
    logger.info(`Available cash: ¥${availableCash.toLocaleString('ja-JP')}`);
    logger.info(`Lot price cap:  ¥${(availableCash * SCAN_CONFIG.maxSingleLotRatio).toLocaleString('ja-JP')} (${SCAN_CONFIG.maxSingleLotRatio * 100}%)`);
    logger.info(`Target:         上位 ${SCAN_CONFIG.topCandidatesCount} 候補`);
    logger.info(`${'='.repeat(55)}\n`);

    const results = [];
    const errors = [];
    let filteredByCapital = 0;

    // バッチ処理で並行スキャン
    for (let i = 0; i < sample.length; i += SCAN_CONFIG.batchSize) {
      const batch = sample.slice(i, i + SCAN_CONFIG.batchSize);
      const batchNum = Math.floor(i / SCAN_CONFIG.batchSize) + 1;
      const totalBatches = Math.ceil(sample.length / SCAN_CONFIG.batchSize);

      logger.info(`  Batch ${batchNum}/${totalBatches}: ${batch.map(s => s.symbol).join(', ')}`);

      const batchPromises = batch.map(stock =>
        this.scanSingleStock(stock, availableCash)
      );
      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        if (result.error) {
          errors.push(result);
        } else if (result.filteredByCapital) {
          filteredByCapital++;
        } else {
          results.push(result);
        }
      }

      if (i + SCAN_CONFIG.batchSize < sample.length) {
        await new Promise(r => setTimeout(r, SCAN_CONFIG.batchDelayMs));
      }
    }

    logger.info(`\nScan complete: ${results.length} 通過 / ${filteredByCapital} 資金外フィルタ / ${errors.length} エラー`);

    // スコアで降順ソート
    const sorted = results
      .filter(r => r.technicalScore >= SCAN_CONFIG.minTechnicalScore)
      .sort((a, b) => b.compositeScore - a.compositeScore);

    // セクター分散を考慮した上位候補を選定
    const topCandidates = this.applyDiversification(sorted, SCAN_CONFIG.topCandidatesCount);

    logger.info(`\nTop ${topCandidates.length} candidates (資金比率フィルタ済み):`);
    topCandidates.forEach((c, i) => {
      logger.info(
        `  ${i + 1}. ${c.symbol} (${c.name}) | ¥${c.currentPrice?.toLocaleString('ja-JP')} ` +
        `| Score:${c.compositeScore} | ${c.sector} | ${c.signal} ` +
        `| 1単元${(c.lotRatio * 100).toFixed(1)}%`
      );
    });

    return topCandidates;
  }

  /**
   * 単一銘柄をスキャン
   * @param {object} stockInfo    { symbol, name, sector, market }
   * @param {number} availableCash  現在の利用可能現金
   */
  async scanSingleStock(stockInfo, availableCash = 1_000_000) {
    try {
      const stockData = await this.dataFetcher.getStockData(stockInfo.symbol);
      const advanced = this.analyzer.analyzeAdvanced(stockData);

      if (!advanced) {
        return { error: true, symbol: stockInfo.symbol, reason: 'Analysis failed' };
      }

      // ── 軍資金比率チェック ──
      const capitalCheck = this.checkCapitalRatio(stockData.currentPrice, availableCash);
      if (!capitalCheck.pass) {
        logger.debug(`  [Capital Filter] ${stockInfo.symbol} 除外: ${capitalCheck.reason}`);
        return { filteredByCapital: true, symbol: stockInfo.symbol };
      }

      const compositeScore = this.calculateCompositeScore(advanced, capitalCheck.priceScore);

      return {
        symbol:          stockInfo.symbol,
        name:            stockInfo.name,
        sector:          stockInfo.sector,
        market:          stockInfo.market ?? 'プライム',
        currentPrice:    stockData.currentPrice,
        lotRatio:        capitalCheck.lotRatio,
        priceScore:      capitalCheck.priceScore,
        capitalNote:     capitalCheck.reason,
        technicalScore:  advanced.technicalScore,
        compositeScore,
        signal:          advanced.signal,
        confidence:      advanced.confidence,
        trend:           advanced.basic?.trend,
        adx:             advanced.advanced?.adx?.adx ?? 0,
        adxStrength:     advanced.advanced?.adx?.trendStrength ?? 'weak',
        rsi:             advanced.basic?.rsi ?? 50,
        convergenceRate: advanced.convergence?.convergenceRate ?? 0,
        bullishSignals:  advanced.convergence?.bullishSignals ?? 0,
        bearishSignals:  advanced.convergence?.bearishSignals ?? 0,
        divergences:     advanced.convergence?.divergences ?? [],
        details: {
          ma5:               advanced.basic?.ma5,
          ma20:              advanced.basic?.ma20,
          ma60:              advanced.basic?.ma60,
          bollingerPosition: advanced.advanced?.bollinger?.position,
          ichimokuSignal:    advanced.advanced?.ichimoku?.signal,
          stochasticCross:   advanced.advanced?.stochastic?.crossover,
          atrVolatility:     advanced.advanced?.atr?.volatilityLevel,
        },
      };
    } catch (error) {
      return { error: true, symbol: stockInfo.symbol, reason: error.message };
    }
  }

  /**
   * 複合スコアを計算（テクニカルスコア + 株価帯ボーナス + 各指標）
   * @param {object} advanced    analyzeAdvanced() の結果
   * @param {number} priceScore  軍資金比率スコアボーナス
   */
  calculateCompositeScore(advanced, priceScore = 0) {
    let score = advanced.technicalScore ?? 50;

    // 株価帯ボーナス（軍資金比率フィルタから）
    score += priceScore;

    // ADX ボーナス
    const adx = advanced.advanced?.adx?.adx ?? 0;
    if (adx > 30)      score += 10;
    else if (adx > 25) score += 5;
    else if (adx < 15) score -= 5;

    // Convergence ボーナス
    const rate = advanced.convergence?.convergenceRate ?? 0.5;
    if (rate >= 0.85)      score += 8;
    else if (rate >= 0.7)  score += 4;
    else if (rate < 0.35)  score -= 8;

    // BUY/SELL シグナルボーナス
    if (advanced.signal === 'BUY')  score += 8;
    if (advanced.signal === 'SELL') score -= 3;

    // 出来高
    const volRatio = advanced.basic?.volumeRatio ?? 1;
    if (volRatio > 1.5)      score += 5;
    else if (volRatio < 0.5) score -= 5;

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * セクター分散を適用して上位 N 件を選ぶ
   */
  applyDiversification(sorted, maxCount) {
    const sectorCounts = {};
    const selected = [];

    for (const stock of sorted) {
      if (selected.length >= maxCount) break;
      const sectorCount = sectorCounts[stock.sector] ?? 0;
      if (sectorCount >= SCAN_CONFIG.maxPerSector) continue;
      sectorCounts[stock.sector] = sectorCount + 1;
      selected.push(stock);
    }

    return selected;
  }

  /**
   * ユニバース統計を取得
   */
  async getUniverseStats() {
    const universe = await this.loadUniverse();
    const sectors = {};
    for (const s of universe) {
      sectors[s.sector] = (sectors[s.sector] ?? 0) + 1;
    }
    return {
      total: universe.length,
      sectors,
      sampleSizePerRun: SCAN_CONFIG.sampleSize,
    };
  }

  getConfig() {
    return { ...SCAN_CONFIG };
  }
}

export default StockScanner;
