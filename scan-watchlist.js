/**
 * Watchlist Auto-Scan Script
 * 手動実行: node scan-watchlist.js
 * 自動実行: 毎月1日・15日に trading-scheduler から呼び出される
 *
 * 処理フロー:
 *   1. JPX公式データ（~3800銘柄）またはスタティックリスト（313銘柄）から200銘柄をランダムスキャン
 *   2. 上位20候補を抽出（セクター分散考慮）
 *   3. Claude AIが最終8銘柄を選定（理由付き）
 *   4. DB watchlist テーブルに保存
 *   5. 次回 runDailyTrading() から自動で使用される
 */

import dotenv from 'dotenv';
dotenv.config();

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import DBInit from './src/database/db-init.js';
import StockScanner from './src/scanner/stock-scanner.js';
import WatchlistManager from './src/scanner/watchlist-manager.js';
import CapitalManager from './src/engine/capital-manager.js';
import config from './src/config.js';
import logger from './src/utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH  = path.resolve(__dirname, '.env');

/**
 * .env の特定キーを上書き保存（他のキーは保持）
 */
function updateEnvKey(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

async function runWatchlistScan() {
  const startTime = Date.now();

  logger.warn('⚠ Watchlist scan triggered');
  logger.info(`
╔════════════════════════════════════════╗
║  Watchlist Auto-Scan Started          ║
╚════════════════════════════════════════╝
`);

  try {
    // DB 初期化（watchlist テーブルが未作成の場合に備えて）
    await DBInit.initialize();

    const scanner = new StockScanner();
    const watchlistManager = new WatchlistManager();

    // 利用可能現金を取得（DB → config フォールバック）
    let availableCash = config.trading.portfolioValue || 1_000_000;
    try {
      const capitalManager = new CapitalManager();
      await capitalManager.initializePortfolio();
      const cash = capitalManager.getAvailableCash();
      if (cash > 0) availableCash = cash;
    } catch (_) { /* DB未初期化等は無視、configの値を使う */ }

    logger.info(`\n💴 利用可能現金: ¥${availableCash.toLocaleString('ja-JP')}`);
    logger.info(`   1単元上限: ¥${(availableCash * 0.30).toLocaleString('ja-JP')} (30%) = ¥${(availableCash * 0.30 / 100).toFixed(0)}/株まで\n`);

    // Step 1: ユニバースサイズ確認
    const universeStats = await scanner.getUniverseStats();
    logger.info(`\nユニバース: ${universeStats.total} 銘柄（今回のスキャン: ${universeStats.sampleSizePerRun} 銘柄ランダム選出）`);

    // Step 2: ユニバーススキャン
    logger.info('\nStep 1: Scanning stock universe...');
    const candidates = await scanner.scanUniverse({ availableCash });

    if (candidates.length === 0) {
      logger.error('No candidates found. Aborting.');
      process.exit(1);
    }

    // Step 3: Claude による最終選定 & DB保存
    logger.info(`\nStep 2: Claude AI selecting final watchlist from ${candidates.length} candidates...`);
    const selected = await watchlistManager.updateWatchlist(candidates);

    // Step 3: 結果サマリー表示
    const duration = Date.now() - startTime;
    logger.info(`
${'='.repeat(50)}
Watchlist Scan Completed

Selected Stocks (${selected.length} symbols):
${selected.map((s, i) =>
  `  ${i + 1}. ${s.symbol} (${s.name}) [${s.sector}]
     Score: ${s.technicalScore}/100 | Signal: ${s.signal} | ADX: ${s.adx?.toFixed(1)}
     理由: ${s.selectionReason}
     予想: ${s.expectedBehavior}
     ${s.riskNote ? `⚠️ ${s.riskNote}` : ''}`.trim()
).join('\n\n')}

次回更新: ${selected[0]?.next_update_date ?? 'N/A'}
Duration: ${duration}ms
${'='.repeat(50)}
`);

    logger.info(`
╔════════════════════════════════════════╗
║  Watchlist Scan Completed ✅          ║
╚════════════════════════════════════════╝
`);

    // ── .env の WATCHED_STOCKS をスキャン結果で上書き ──────────
    // DBが消えてもフォールバック値がスキャン済み銘柄になる
    const symbolsCsv = selected.map(s => s.symbol).join(',');
    try {
      updateEnvKey('WATCHED_STOCKS', symbolsCsv);
      logger.info(`✓ .env WATCHED_STOCKS を更新: ${symbolsCsv}`);
    } catch (e) {
      logger.warn(`  .env 更新失敗（無視）: ${e.message}`);
    }

    console.log('\n✅ Watchlist Scan Completed Successfully!');
    console.log(`   選定銘柄: ${symbolsCsv}`);
    console.log(`   次回更新: ${selected[0]?.next_update_date ?? 'N/A'}`);
    console.log('   .env WATCHED_STOCKS も自動更新しました。');
    console.log('\nStreamlit ダッシュボードの「監視銘柄管理」タブで詳細を確認できます。');

  } catch (error) {
    logger.error(`Fatal error in watchlist scan: ${error.message}`);
    logger.error(error.stack);
    console.error('\n❌ Watchlist Scan Failed:', error.message);
    process.exit(1);
  }
}

runWatchlistScan();
