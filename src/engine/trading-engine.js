/**
 * Trading Engine Module
 * メイン取引エンジン - 全処理の統合
 *
 * 【主要フロー】
 *  1. オープンポジションのSL/TP/Claude判断による自動クローズ
 *  2. 新規BUY候補のスキャン・発注
 *  3. 日次P&L計算・資本への反映
 */

import logger from '../utils/logger.js';
import DataFetcher from '../api/data-fetcher.js';
import TechnicalAnalyzerV2 from '../analyzer/technical-analyzer-v2.js';
import AnthropicClientV2 from '../api/anthropic-client-v2.js';
import CapitalManager from './capital-manager.js';
import PositionSizerV2 from './position-sizer-v2.js';
import MultiPositionManager from './multi-position-manager.js';
import RiskManager from './risk-manager.js';
import Executor from './executor.js';
import TradeRepository from '../database/trade-repository.js';
import NeonRepository from '../database/neon-repository.js';
import WatchlistManager from '../scanner/watchlist-manager.js';
import config from '../config.js';

/** DATABASE_URL の有無で使用 DB を切り替え */
function createRepository() {
  return process.env.DATABASE_URL ? new NeonRepository() : new TradeRepository();
}

class TradingEngine {
  constructor() {
    this.dataFetcher = new DataFetcher();
    this.analyzer = new TechnicalAnalyzerV2();
    this.anthropic = new AnthropicClientV2();
    this.capitalManager = new CapitalManager();
    this.positionSizer = new PositionSizerV2(this.capitalManager);
    this.multiPositionManager = new MultiPositionManager();
    this.riskManager = new RiskManager(this.capitalManager);
    this.executor = new Executor();
    this.repository = createRepository();
    this.watchlistManager = new WatchlistManager();
  }

  // ─────────────────────────────────────────────────────────────
  //  PHASE 1: オープンポジションのクローズ判断
  // ─────────────────────────────────────────────────────────────

  /**
   * 保有ポジションを評価し、SL/TP 到達 or Claude 判断で売却する
   * @returns {{ closedCount: number, realizedPnl: number }}
   */
  async checkAndClosePositions() {
    const openPositions = await this.repository.getOpenPositions();
    if (openPositions.length === 0) {
      logger.info('[Phase1] オープンポジションなし');
      return { closedCount: 0, realizedPnl: 0 };
    }

    logger.info(`\n[Phase1] オープンポジション確認: ${openPositions.length} 件`);

    let closedCount = 0;
    let realizedPnl = 0;

    for (const position of openPositions) {
      try {
        const stockData = await this.dataFetcher.getStockData(position.symbol);
        const currentPrice = stockData.currentPrice;

        // ── モックデータ保護: SL/TP判定には必ずリアルデータが必要 ──
        if (stockData.isRealData === false) {
          logger.warn(`  ⊘ Skip position check ${position.symbol}: リアルデータ取得失敗（モック価格でのSL/TP判定をスキップ）`);
          continue;
        }

        const entryPrice = position.entry_price ?? position.entryPrice;
        const quantity = position.quantity;
        const stopLoss = position.stop_loss_price ?? position.stopLossPrice;
        const takeProfit = position.take_profit_price ?? position.takeProfitPrice;

        const unrealizedPnl = (currentPrice - entryPrice) * quantity;
        const unrealizedPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;

        logger.info(
          `  ${position.symbol}: 取得¥${entryPrice} → 現在¥${currentPrice}` +
          ` | 損益¥${unrealizedPnl.toFixed(0)} (${unrealizedPnlPct.toFixed(2)}%)` +
          ` | SL¥${stopLoss} TP¥${takeProfit}`
        );

        let shouldClose = false;
        let closeReason = '';

        // ── SL 到達チェック ──
        if (currentPrice <= stopLoss) {
          shouldClose = true;
          closeReason = `ストップロス到達 (SL¥${stopLoss})`;
        }

        // ── TP 到達チェック ──
        if (currentPrice >= takeProfit) {
          shouldClose = true;
          closeReason = `利確到達 (TP¥${takeProfit})`;
        }

        // ── Claude AI による判断（SL/TP 未到達でも分析）──
        if (!shouldClose) {
          const advanced = this.analyzer.analyzeAdvanced(stockData);
          const analysis = await this.anthropic.analyzeStockAdvanced(
            position.symbol,
            stockData,
            advanced
          );
          logger.info(
            `  Claude判断: ${analysis.decision} (${(analysis.confidence * 100).toFixed(1)}%)`
          );
          if (analysis.decision === 'SELL' && analysis.confidence >= config.tradingRules.confidenceThreshold) {
            shouldClose = true;
            closeReason = `Claude SELL判断 (信頼度${(analysis.confidence * 100).toFixed(1)}%)`;
          }
        }

        if (!shouldClose) {
          // ホールド継続でも現在価格をDBに保存（ダッシュボード表示用）
          try {
            await this.repository.updateCurrentPrice(
              position.id ?? position.symbol,
              currentPrice,
              entryPrice,
              quantity
            );
          } catch (e) {
            logger.debug(`  Price update skipped: ${e.message}`);
          }
          logger.info(`  → ホールド継続 ¥${currentPrice} (損益¥${unrealizedPnl.toFixed(0)})`);
          continue;
        }

        // ── クローズ注文実行 ──
        logger.info(`  → クローズ: ${closeReason}`);
        const orderResult = await this.executor.execute(
          position.symbol,
          'SELL',
          {
            quantity,
            currentPrice,
            confidence: 0.9,
            reasoning: `Close position: ${closeReason}`,
          }
        );

        const executedPrice = orderResult.price;
        const pnl = (executedPrice - entryPrice) * quantity;
        const pnlPercent = ((executedPrice - entryPrice) / entryPrice) * 100;
        const pnlAfterTax = pnl > 0
          ? pnl * (1 - config.constants.TAX_RATE)
          : pnl; // 損失には税金かからない

        // アドバイザーモードは推奨出力のみ — DB クローズ・資金操作をスキップ
        if (orderResult.mode === 'advisor') {
          logger.info(`  ℹ️ [Advisor] 売り推奨のみ出力（ポジションはそのまま）`);
          continue;
        }

        // ポジションをクローズ状態に更新
        await this.repository.closePosition(position.id, {
          exitPrice:          executedPrice,
          exitReason:         closeReason,
          realizedPnl:        pnl,
          realizedPnlPercent: pnlPercent,
        });

        // 資本を更新（売却金額を現金に戻し、投資額から取得コスト分を解除し、PnLを反映）
        const proceeds     = executedPrice * quantity;
        const originalCost = entryPrice    * quantity;
        await this.capitalManager.recordSell(proceeds, originalCost);

        realizedPnl += pnlAfterTax;
        closedCount++;

        logger.info(
          `  ✓ クローズ完了: ${position.symbol} ¥${executedPrice} | 損益¥${pnl.toFixed(0)} (税後¥${pnlAfterTax.toFixed(0)})`
        );
      } catch (error) {
        logger.error(`  ✗ ポジションクローズ失敗 ${position.symbol}: ${error.message}`);
      }
    }

    if (realizedPnl !== 0) {
      logger.info(`[Phase1] 確定損益: ¥${realizedPnl.toFixed(0)}`);
    }

    return { closedCount, realizedPnl };
  }

  // ─────────────────────────────────────────────────────────────
  //  PHASE 2: 新規エントリー
  // ─────────────────────────────────────────────────────────────

  /**
   * ウォッチリスト銘柄を分析して新規注文を出す
   * @returns {{ buyCount, sellCount, executedOrders }}
   */
  async runNewEntries(watchedStocks) {
    logger.info(`\n[Phase2] 新規エントリー分析: ${watchedStocks.join(', ')}`);

    // ウォッチリストのシグナルを取得（スキャン済みBUY銘柄の判定に使う）
    let wlMap = {};
    try {
      const activeWl = await this.watchlistManager.getActiveWatchlist();
      wlMap = Object.fromEntries(activeWl.map(w => [w.symbol, w]));
    } catch (e) {
      logger.warn(`[Phase2] ウォッチリスト取得失敗: ${e.message}`);
    }

    let totalAnalyzed = 0;
    let buySignals = 0;
    let sellSignals = 0;
    let executedOrders = 0;

    for (const symbol of watchedStocks) {
      try {
        totalAnalyzed++;
        logger.info(`\n▶ Analyzing ${symbol}...`);

        // データ取得
        const stockData = await this.dataFetcher.getStockData(symbol);
        const currentPrice = stockData.currentPrice;

        // ── モックデータ保護: リアルデータが取れなかった銘柄はスキップ ──
        if (stockData.isRealData === false) {
          logger.warn(`  ⊘ Skip ${symbol}: リアルデータ取得失敗（モック価格¥${currentPrice.toFixed(0)}で取引不可）`);
          continue;
        }

        logger.info(`  ✓ Current price: ¥${currentPrice.toFixed(0)}`);

        // 資金チェック（毎回最新の availableCash を取得 — 同一サイクル内の連続買いで枯渇判定）
        const availableCash = this.capitalManager.getAvailableCash();
        const minCost = currentPrice * 100;
        if (minCost > availableCash) {
          logger.info(`  ⊘ Skip: 資金不足 (1単元¥${minCost.toLocaleString('ja-JP')} > 利用可能¥${availableCash.toLocaleString('ja-JP')})`);
          continue;
        }

        // テクニカル分析
        const advancedTechnical = this.analyzer.analyzeAdvanced(stockData);
        const indicators = advancedTechnical?.basic ?? this.analyzer.analyze(stockData);

        logger.info(
          `  ✓ MA5:${(indicators.ma5 ?? 0).toFixed(0)} MA20:${(indicators.ma20 ?? 0).toFixed(0)} MA60:${(indicators.ma60 ?? 0).toFixed(0)} RSI:${(indicators.rsi ?? 0).toFixed(1)} Trend:${indicators.trend}`
        );
        if (advancedTechnical) {
          const adv = advancedTechnical.advanced;
          logger.info(
            `  ✓ ADX:${(adv.adx?.adx ?? 0).toFixed(1)} Score:${advancedTechnical.technicalScore} Convergence:${(advancedTechnical.convergence.convergenceRate * 100).toFixed(0)}%`
          );
        }

        // ────────────────────────────────────────────────────────
        //  シグナル判定
        //  スキャンでBUY選定済みの銘柄 → テクニカル確認のみで即BUY
        //  （Claudeに二重分析させるとHOLDになりがちで機会損失）
        //  スキャンでHOLD/未登録の銘柄 → Claudeに分析依頼
        // ────────────────────────────────────────────────────────
        const wlEntry = wlMap[symbol];
        let analysis;

        if (wlEntry?.signal === 'BUY') {
          // スキャン選定BUY銘柄: テクニカルが崩れていなければそのまま実行
          const rsi      = indicators.rsi ?? 50;
          const trend    = indicators.trend ?? '';
          const ma5      = indicators.ma5  ?? 0;
          const ma20     = indicators.ma20 ?? 0;
          const techOk   =
            rsi < 78 &&                          // 過買いでない
            trend !== 'DOWNTREND' &&             // 下降トレンドでない
            (ma5 === 0 || ma5 >= ma20 * 0.97);  // MA5がMA20を大きく下回っていない

          if (techOk) {
            const conf = Math.max(Number(wlEntry.confidence) || 0, 0.68);
            analysis = {
              decision:   'BUY',
              confidence: conf,
              reasoning:  `Watchlist BUY (scan score:${wlEntry.technical_score}) + tech OK`,
            };
            logger.info(`  ✓ ウォッチリストBUY + テクニカルOK → BUY確定 (信頼度${(conf * 100).toFixed(0)}%)`);
          } else {
            logger.info(`  ⊘ ウォッチリストBUYだがテクニカル悪化 (RSI:${rsi.toFixed(0)} Trend:${trend}) → SKIP`);
            continue;
          }
        } else {
          // 非BUY銘柄 or ウォッチリスト外 → Claudeに分析依頼
          analysis = await this.anthropic.analyzeStockAdvanced(
            symbol, stockData, advancedTechnical
          );
          logger.info(
            `  ✓ Claude: ${analysis.decision} (${(analysis.confidence * 100).toFixed(1)}%)`
          );
          if (analysis.decision === 'HOLD') {
            logger.info(`  ⊘ HOLD – 何もしない`);
            continue;
          }
          if (analysis.decision === 'SELL') {
            logger.info(`  ⊘ SELL – 新規エントリーなし`);
            continue;
          }
        }
        // ここに来るのは BUY のみ

        // リスク管理チェック
        const currentPositions = await this.repository.getOpenPositions();
        if (!(await this.riskManager.canTrade(analysis, currentPositions))) {
          logger.info(`  ⊘ リスク管理NG`);
          continue;
        }

        // ポジションサイズ計算
        const recentTrades = await this.repository.getRecentTrades(5);
        const positionSize = await this.positionSizer.calculateOptimizedSize(
          symbol, currentPrice, analysis.confidence, advancedTechnical, recentTrades
        );

        if (positionSize.quantity === 0) {
          logger.info(`  ⊘ ポジションサイズ = 0`);
          continue;
        }

        logger.info(
          `  ✓ Position: ${positionSize.quantity}株 ¥${positionSize.positionValue?.toFixed(0)} RR:${positionSize.riskRewardRatio}`
        );

        // currentPrice を positionSize に注入（executor で使用）
        positionSize.currentPrice = currentPrice;
        positionSize.confidence   = analysis.confidence;
        positionSize.reasoning    = JSON.stringify(analysis).slice(0, 500);

        // 注文実行
        const orderResult = await this.executor.execute(
          symbol, analysis.decision, positionSize
        );
        logger.info(`  ✓ Order: ${orderResult.orderId} @ ¥${orderResult.price}`);

        // アドバイザーモードは推奨出力のみ — 資金操作・ポジション保存をスキップ
        if (orderResult.mode === 'advisor') {
          executedOrders++;
          if (analysis.decision === 'BUY') buySignals++;
          if (analysis.decision === 'SELL') sellSignals++;
          logger.info(`  ℹ️ [Advisor] 推奨のみ出力（ポジション未登録）`);
          continue;
        }

        // 買い約定 → 資金を減らす
        if (analysis.decision === 'BUY') {
          const cost = orderResult.price * positionSize.quantity;
          await this.capitalManager.recordBuy(cost);
        }

        // ポジション保存
        const saved = await this.repository.savePosition({
          symbol,
          quantity: positionSize.quantity,
          entryPrice: orderResult.price,
          stopLossPrice:   positionSize.stopLoss  || this.riskManager.calculateStopLoss(currentPrice),
          takeProfitPrice: positionSize.takeProfit || this.riskManager.calculateTakeProfit(currentPrice),
          technicalScore:  analysis.technicalScore,
          confidence:      analysis.confidence,
          signal:          analysis.decision,
        });

        // 約定直後は current_price = entry_price で初期化
        // → ダッシュボードで「約定直後はPnL=0」と表示される。
        //    次の価格更新サイクルで実際の市場価格に置き換わる。
        try {
          if (saved?.id) {
            await this.repository.updateCurrentPrice(
              saved.id,
              orderResult.price,
              orderResult.price,
              positionSize.quantity
            );
          }
        } catch (e) {
          logger.debug(`  current_price 初期化スキップ: ${e.message}`);
        }

        executedOrders++;
        if (analysis.decision === 'BUY') buySignals++;
        if (analysis.decision === 'SELL') sellSignals++;

        logger.info(`  ✓ ポジション保存完了`);
      } catch (error) {
        logger.error(`✗ Error analyzing ${symbol}: ${error.message}`);
      }
    }

    return { totalAnalyzed, buySignals, sellSignals, executedOrders };
  }

  // ─────────────────────────────────────────────────────────────
  //  MAIN: 毎営業日 15:05 に実行
  // ─────────────────────────────────────────────────────────────

  /**
   * 毎営業日 15:05 に実行される主要メソッド
   */
  async runDailyTrading() {
    const startTime = Date.now();
    const today = new Date();

    // ウォッチリスト取得
    let watchedStocks = config.stocks.watched;
    try {
      const activeWatchlist = await this.watchlistManager.getActiveWatchlist();
      if (activeWatchlist.length > 0) {
        watchedStocks = activeWatchlist.map(w => w.symbol);
        logger.info(`[WatchlistManager] DBウォッチリスト使用: ${watchedStocks.join(', ')}`);
      } else {
        logger.info(`[WatchlistManager] config フォールバック: ${watchedStocks.join(', ')}`);
      }
    } catch (e) {
      logger.warn(`[WatchlistManager] DBアクセス失敗 → config フォールバック: ${e.message}`);
    }

    logger.info(`\n${'='.repeat(55)}`);
    logger.info('Daily Trading Analysis Started');
    logger.info(`Time:    ${today.toISOString()}`);
    logger.info(`Mode:    ${config.trading.mode}`);
    logger.info(`Stocks:  ${watchedStocks.join(', ')}`);
    logger.info(`${'='.repeat(55)}\n`);

    try {
      // ポートフォリオ初期化
      await this.capitalManager.initializePortfolio();
      const portfolio = this.capitalManager.getPortfolio();
      const capitalStart = portfolio.currentCapital;

      logger.info(`Portfolio: ¥${portfolio.currentCapital.toLocaleString('ja-JP')}`);
      logger.info(`Available: ¥${portfolio.availableCash.toLocaleString('ja-JP')}\n`);

      // ── Phase 1: 保有ポジションのクローズ判断 ──────────────
      const closeResult = await this.checkAndClosePositions();

      // ── Phase 2: 新規エントリー ────────────────────────────
      const entryResult = await this.runNewEntries(watchedStocks);

      const duration = Date.now() - startTime;
      const capitalEnd = this.capitalManager.getTotalCapital();
      const dailyPnl = capitalEnd - capitalStart + closeResult.realizedPnl;

      logger.info(`\n${'='.repeat(55)}`);
      logger.info('Daily Analysis Completed');
      logger.info(`  Closed Positions: ${closeResult.closedCount} | Realized P&L: ¥${closeResult.realizedPnl.toFixed(0)}`);
      logger.info(`  Analyzed: ${entryResult.totalAnalyzed} | BUY: ${entryResult.buySignals} | SELL: ${entryResult.sellSignals} | Executed: ${entryResult.executedOrders}`);
      logger.info(`  Capital: ¥${capitalStart.toLocaleString('ja-JP')} → ¥${capitalEnd.toLocaleString('ja-JP')}`);
      logger.info(`  Duration: ${duration}ms`);
      logger.info(`${'='.repeat(55)}\n`);

      // 日別サマリー保存
      await this.repository.saveDailySummary({
        tradesCount: entryResult.totalAnalyzed,
        buyCount:    entryResult.buySignals,
        sellCount:   entryResult.sellSignals + closeResult.closedCount,
        dailyGains:  closeResult.realizedPnl,
        winRate:     0,
        capitalStart,
        capitalEnd,
      });

      return {
        success:      true,
        closedCount:  closeResult.closedCount,
        realizedPnl:  closeResult.realizedPnl,
        analyzed:     entryResult.totalAnalyzed,
        buys:         entryResult.buySignals,
        sells:        entryResult.sellSignals,
        executed:     entryResult.executedOrders,
        capitalStart,
        capitalEnd,
        duration,
      };
    } catch (error) {
      logger.error(`Fatal error in trading engine: ${error.message}`);
      logger.error(error.stack);
      throw error;
    }
  }

  /**
   * バックテストモードで過去データで実行（将来実装）
   */
  async runBacktest(startDate, endDate) {
    logger.info(`Running backtest from ${startDate} to ${endDate}`);
    // TODO: 実装
  }
}

export default TradingEngine;
