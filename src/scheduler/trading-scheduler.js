/**
 * Trading Scheduler Module
 * 毎営業日 15:05 に実行
 */

import cron from 'node-cron';
import logger from '../utils/logger.js';
import TradingEngine from '../engine/trading-engine.js';
import StockScanner from '../scanner/stock-scanner.js';
import WatchlistManager from '../scanner/watchlist-manager.js';
import DBInit from '../database/db-init.js';

class TradingScheduler {
  constructor() {
    this.engine = new TradingEngine();
    this.isRunning = false;
  }

  /**
   * スケジューラーを開始
   */
  start() {
    logger.info('Starting trading scheduler...');

    // ── 毎営業日（月-金）15:05 に売買実行 ──────────────────
    const tradingSchedule = '5 15 * * 1-5';
    const tradingTask = cron.schedule(tradingSchedule, async () => {
      await this.executeTrading();
    });

    // ── 毎月1日・15日 9:00 にウォッチリストスキャン ──────────
    // cron: 0 9 1,15 * * = 毎月1日と15日の午前9時
    const scanSchedule = '0 9 1,15 * *';
    const scanTask = cron.schedule(scanSchedule, async () => {
      await this.executeWatchlistScan();
    });

    logger.info('✓ Trading scheduler started');
    logger.info(`  Daily trading:    ${tradingSchedule} (weekday 15:05 JST)`);
    logger.info(`  Watchlist scan:   ${scanSchedule} (1st & 15th of month, 09:00 JST)`);
    logger.info('  (Manual scan: scheduler.executeWatchlistScan())');

    return { tradingTask, scanTask };
  }

  /**
   * 取引を実行
   */
  async executeTrading() {
    if (this.isRunning) {
      logger.warn('Trading already in progress, skipping this cycle');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('\n╔════════════════════════════════════════╗');
      logger.info('║  Daily Trading Execution Started      ║');
      logger.info('╚════════════════════════════════════════╝\n');

      const result = await this.engine.runDailyTrading();

      logger.info('\n╔════════════════════════════════════════╗');
      logger.info('║  Daily Trading Completed Successfully ║');
      logger.info('╚════════════════════════════════════════╝\n');

      return result;
    } catch (error) {
      logger.error('✗ Trading execution error:', error);

      logger.error('\n╔════════════════════════════════════════╗');
      logger.error('║  Trading Execution Failed             ║');
      logger.error('╚════════════════════════════════════════╝\n');

      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * ウォッチリストスキャンを実行（半月ごと自動 / 手動）
   */
  async executeWatchlistScan() {
    if (this.isRunning) {
      logger.warn('Trading in progress, watchlist scan deferred');
      return;
    }

    logger.info('\n╔════════════════════════════════════════╗');
    logger.info('║  Watchlist Scan Execution Started     ║');
    logger.info('╚════════════════════════════════════════╝\n');

    try {
      await DBInit.initialize();
      const scanner = new StockScanner();
      const watchlistManager = new WatchlistManager();

      const candidates = await scanner.scanUniverse();
      const selected = await watchlistManager.updateWatchlist(candidates);

      logger.info(`\n✓ Watchlist updated: ${selected.map(s => s.symbol).join(', ')}`);
      logger.info('\n╔════════════════════════════════════════╗');
      logger.info('║  Watchlist Scan Completed ✅          ║');
      logger.info('╚════════════════════════════════════════╝\n');

      return selected;
    } catch (error) {
      logger.error(`Watchlist scan failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * スケジューラーを停止
   */
  stop() {
    logger.info('Stopping trading scheduler...');
    // node-cron では task.stop() で停止
    logger.info('✓ Trading scheduler stopped');
  }

  /**
   * 手動実行（テスト用）
   */
  async manualExecute() {
    logger.warn('⚠ Manual execution triggered');
    return await this.executeTrading();
  }

  /**
   * 複数回のテスト実行
   */
  async testMultipleTimes(times = 3) {
    logger.info(`Running ${times} test executions...`);

    for (let i = 0; i < times; i++) {
      logger.info(`\n[Test Run ${i + 1}/${times}]`);
      try {
        await this.executeTrading();
        // テスト間に遅延を追加
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        logger.error(`Test run ${i + 1} failed: ${error.message}`);
      }
    }

    logger.info(`\n✓ Test runs completed (${times}x)`);
  }
}

export default TradingScheduler;
