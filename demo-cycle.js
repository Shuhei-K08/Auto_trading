/**
 * Demo Cycle Script
 * デモモードで取引サイクルを「停止されるまで」繰り返し実行
 *
 * 使い方:
 *   node demo-cycle.js          # 停止するまで無限に実行
 *   node demo-cycle.js --report # 現在の成績レポートのみ表示
 *
 * 各サイクルで以下を実行:
 *   1. オープンポジションのSL/TP・Claude判断によるクローズ
 *   2. 新規BUY候補のスキャン・発注
 *   3. P&L計算・資本反映
 *   4. サマリー表示 → 次のサイクルへ
 *
 * 停止方法: UI の「⏹ 停止」ボタン、またはターミナルで Ctrl+C
 *
 * ⚠️ TRADING_MODE=demo が必須（live/live_mini では実行不可）
 */

import dotenv from 'dotenv';
dotenv.config();

import logger from './src/utils/logger.js';
import DBInit from './src/database/db-init.js';
import TradingEngine from './src/engine/trading-engine.js';
import TradeRepository from './src/database/trade-repository.js';
import CapitalManager from './src/engine/capital-manager.js';
import config from './src/config.js';

// ─────────────────────────────────────────────────────────────
//  CLI 引数解析
// ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const REPORT_ONLY = args.includes('--report');
const CYCLE_DELAY_MS = 3000; // サイクル間の待機（ms）

// ─────────────────────────────────────────────────────────────
//  安全チェック
// ─────────────────────────────────────────────────────────────
if (config.trading.mode !== 'demo') {
  console.error('❌ demo-cycle.js は TRADING_MODE=demo でのみ実行できます。');
  console.error(`   現在のモード: ${config.trading.mode}`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
//  ユーティリティ
// ─────────────────────────────────────────────────────────────
const divider = (char = '─', len = 60) => char.repeat(len);
const yen     = n => `¥${Math.round(n).toLocaleString('ja-JP')}`;
const pnlStr  = n => (n >= 0 ? `+${yen(n)}` : `-${yen(Math.abs(n))}`);

// ─────────────────────────────────────────────────────────────
//  成績レポート表示
// ─────────────────────────────────────────────────────────────
async function showReport(repository, capitalManager, initialCapital, cycleCount) {
  await capitalManager.initializePortfolio();
  const portfolio   = capitalManager.getPortfolio();
  const finalCapital = portfolio.currentCapital;
  const totalPnl    = finalCapital - initialCapital;
  const totalPnlPct = (totalPnl / initialCapital) * 100;

  console.log(`\n${divider('═')}`);
  console.log('  📊 デモトレード レポート');
  console.log(divider('═'));
  console.log(`  実行サイクル: ${cycleCount} 回`);
  console.log(`  初期資金:     ${yen(initialCapital)}`);
  console.log(`  現在資金:     ${yen(finalCapital)}`);
  console.log(`  総損益:       ${pnlStr(totalPnl)} (${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%)`);

  try {
    const trades     = await repository.getRecentTrades(200);
    const buyTrades  = trades.filter(t => t.decision === 'BUY');
    const sellTrades = trades.filter(t => t.decision === 'SELL');
    const wins       = sellTrades.filter(t => (t.pnl ?? 0) > 0).length;
    const losses     = sellTrades.filter(t => (t.pnl ?? 0) <= 0).length;
    const winRate    = sellTrades.length > 0
      ? ((wins / sellTrades.length) * 100).toFixed(1) : 'N/A';

    console.log(`  取引回数:     BUY ${buyTrades.length}回 / SELL ${sellTrades.length}回`);
    console.log(`  勝率:         ${winRate}% (${wins}勝 ${losses}敗)`);

    if (totalPnl > 0) {
      console.log(`\n  ✅ デモで利益達成！楽天証券 API 接続の準備が整いました。`);
    } else {
      console.log(`\n  📉 現在損失中。設定を見直してみましょう。`);
    }
  } catch (e) {
    console.log(`  (履歴取得エラー: ${e.message})`);
  }

  console.log(`${divider('═')}\n`);
}

// ─────────────────────────────────────────────────────────────
//  メイン処理
// ─────────────────────────────────────────────────────────────
async function main() {
  await DBInit.initialize();

  const engine         = new TradingEngine();
  const repository     = new TradeRepository();
  const capitalManager = new CapitalManager();
  await capitalManager.initializePortfolio();

  const initialCapital = capitalManager.getTotalCapital();

  // レポートのみモード
  if (REPORT_ONLY) {
    const trades = await repository.getRecentTrades(1000);
    await showReport(repository, capitalManager, initialCapital, trades.length);
    return;
  }

  // ─── 起動メッセージ ──────────────────────────────────────
  console.log(divider('═'));
  console.log('  🤖 Claude AI Stock Auto Trading System v3.0');
  console.log('  📋 Demo Mode — 停止ボタンを押すまで動き続けます');
  console.log(divider('═'));
  console.log(`  初期資金: ${yen(initialCapital)}`);
  console.log(`  監視銘柄: ${config.stocks.watched.join(', ')}`);
  console.log(`  モード:   ${config.trading.mode.toUpperCase()}`);
  console.log(divider('─'));
  console.log('  ⚠️  これはデモ（模擬取引）です。実際の資金は使用しません。');
  console.log('  ⏹  停止: UIの停止ボタン または Ctrl+C');
  console.log(divider('─'));

  let cycleCount  = 0;
  let totalRealized = 0;
  let isShuttingDown = false;

  // Ctrl+C / 停止シグナルを受けたらレポートを出して終了
  const shutdown = async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n\n  ⏹ 停止シグナルを受信しました`);
    await showReport(repository, capitalManager, initialCapital, cycleCount);
    process.exit(0);
  };

  process.on('SIGINT',  shutdown);
  process.on('SIGTERM', shutdown);

  // ─── 無限サイクルループ ──────────────────────────────────
  while (!isShuttingDown) {
    cycleCount++;

    console.log(`\n${divider('─')}`);
    console.log(`  📅 サイクル ${cycleCount}`);
    console.log(divider('─'));

    try {
      const result = await engine.runDailyTrading();
      totalRealized += result.realizedPnl ?? 0;

      console.log(`\n  サイクル ${cycleCount} 完了:`);
      console.log(`    クローズ: ${result.closedCount} ポジション | 確定損益: ${pnlStr(result.realizedPnl)}`);
      console.log(`    新規BUY:  ${result.buys} 件`);
      console.log(`    資金:     ${yen(result.capitalStart)} → ${yen(result.capitalEnd)}`);
      console.log(`    累計損益: ${pnlStr(totalRealized)}`);

    } catch (error) {
      console.error(`\n  ✗ サイクル ${cycleCount} エラー: ${error.message}`);
      // エラーが出ても止まらず次のサイクルへ
    }

    if (!isShuttingDown) {
      console.log(`\n  次のサイクルまで ${CYCLE_DELAY_MS / 1000}秒待機...`);
      await new Promise(r => setTimeout(r, CYCLE_DELAY_MS));
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
