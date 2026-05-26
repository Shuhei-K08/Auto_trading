/**
 * Claude AI Stock Auto Trading System v3.0
 * メインエントリーポイント
 */

import dotenv from 'dotenv';
import config from './config.js';
import logger from './utils/logger.js';
import TradingScheduler from './scheduler/trading-scheduler.js';
import DBInit from './database/db-init.js';
import NeonRepository from './database/neon-repository.js';

// 環境変数を読み込む
dotenv.config();

/**
 * メイン処理
 */
async function main() {
  try {
    // ウェルカムメッセージ
    logger.info('╔═══════════════════════════════════════════════════════╗');
    logger.info('║                                                       ║');
    logger.info('║   Claude AI Stock Auto Trading System v3.0           ║');
    logger.info('║   日本株スイングトレード自動売買システム              ║');
    logger.info('║                                                       ║');
    logger.info('╚═══════════════════════════════════════════════════════╝\n');

    // システム情報を表示
    logger.info('System Configuration:');
    logger.info(`  Mode: ${config.trading.mode}`);
    logger.info(
      `  Portfolio: ¥${config.trading.portfolioValue.toLocaleString('ja-JP')}`
    );
    logger.info(`  Max Positions: ${config.risk.maxPositions}`);
    logger.info(`  Max Risk per Trade: ${config.risk.maxRiskPerTrade * 100}%`);
    logger.info(
      `  Confidence Threshold: ${config.tradingRules.confidenceThreshold * 100}%`
    );
    logger.info(`  Watched Stocks: ${config.stocks.watched.join(', ')}`);
    logger.info(`\n  UI: http://localhost:8501`);
    logger.info(`  Logs: ${config.paths.logs}\n`);

    // API キー確認
    if (!config.anthropic.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set in .env');
    }

    logger.info('Initializing system...\n');

    // データベース初期化
    logger.info('Initializing database...');
    if (process.env.DATABASE_URL) {
      // Neon DB（クラウド）: テーブル自動作成
      const neon = new NeonRepository();
      await neon.initializeTables();
      await neon.close();
    } else {
      // SQLite（ローカル）
      await DBInit.initialize();
    }
    logger.info('✓ Database initialized\n');

    const scheduler = new TradingScheduler();

    // ── 一回実行モード（GitHub Actions / CI 向け）──────────────
    // node src/index.js --run-trading : 売買分析を1回実行して終了
    // node src/index.js --run-scan    : 銘柄選定を1回実行して終了
    if (process.argv.includes('--run-trading') || process.argv.includes('--test')) {
      // 15:30 JST（UTC 6:30）前の手動実行は前日終値になる旨を警告
      const nowHourJST = (new Date().getUTCHours() + 9) % 24;
      const nowMinJST  = new Date().getUTCMinutes();
      if (nowHourJST < 15 || (nowHourJST === 15 && nowMinJST < 30)) {
        logger.warn('⚠️  現在は取引時間中または引け前です。株価は前日終値または遅延データになる場合があります。');
        logger.warn('⚠️  正確な当日終値を使うには 15:30 JST 以降に実行してください。\n');
      }
      logger.info('One-shot mode: Running trading once...\n');
      await scheduler.executeTrading();
      logger.info('✓ Trading execution complete. Exiting.');
      process.exit(0);
    }

    if (process.argv.includes('--run-scan')) {
      logger.info('One-shot mode: Running watchlist scan once...\n');
      await scheduler.executeWatchlistScan();
      logger.info('✓ Watchlist scan complete. Exiting.');
      process.exit(0);
    }

    // ── 通常モード: スケジューラー常駐実行（ローカル開発用）──
    logger.info('Starting trading scheduler...');
    const task = scheduler.start();
    logger.info('✓ Trading scheduler started\n');

    // 永続実行
    logger.info('System ready. Press Ctrl+C to exit.\n');
    logger.info('═══════════════════════════════════════════════════════\n');

    // Graceful shutdown
    process.on('SIGINT', () => {
      logger.info('\n\nShutting down gracefully...');
      task.tradingTask?.stop();
      task.scanTask?.stop();
      logger.info('✓ Scheduler stopped');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('\n\nTerminating...');
      task.tradingTask?.stop();
      task.scanTask?.stop();
      logger.info('✓ Scheduler stopped');
      process.exit(0);
    });
  } catch (error) {
    logger.error('\n✗ Fatal Error:');
    logger.error(error.message);
    logger.error('\n' + error.stack);

    logger.error('\n╔═══════════════════════════════════════════════════════╗');
    logger.error('║             System Startup Failed                   ║');
    logger.error('╚═══════════════════════════════════════════════════════╝\n');

    process.exit(1);
  }
}

// アプリケーション起動
main();
