/**
 * Claude AI Stock Auto Trading System v3.0
 * メインエントリーポイント
 */

import dotenv from 'dotenv';
import config from './config.js';
import logger from './utils/logger.js';
import TradingScheduler from './scheduler/trading-scheduler.js';
import DBInit from './database/db-init.js';

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
    await DBInit.initialize();
    logger.info('✓ Database initialized\n');

    // スケジューラー開始
    logger.info('Starting trading scheduler...');
    const scheduler = new TradingScheduler();
    const task = scheduler.start();
    logger.info('✓ Trading scheduler started\n');

    // テスト実行オプション
    if (process.argv.includes('--test')) {
      logger.info('Test mode enabled. Running one test execution...\n');
      await scheduler.manualExecute();
    }

    // 永続実行
    logger.info('System ready. Press Ctrl+C to exit.\n');
    logger.info('═══════════════════════════════════════════════════════\n');

    // Graceful shutdown
    process.on('SIGINT', () => {
      logger.info('\n\nShutting down gracefully...');
      task.stop();
      logger.info('✓ Scheduler stopped');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('\n\nTerminating...');
      task.stop();
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
