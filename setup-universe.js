/**
 * setup-universe.js
 * JPX から日本株ユニバースを一括取得してキャッシュに保存するスクリプト
 *
 * 使い方:
 *   node setup-universe.js
 *
 * 取得できない場合の手動方法:
 *   1. https://www.jpx.co.jp/markets/statistics-equities/misc/01.html を開く
 *   2. 「上場銘柄一覧」Excel をダウンロード
 *   3. database/data_j.xlsx という名前で保存
 *   4. node setup-universe.js を再実行
 */

import DBInit from './src/database/db-init.js';
import { getDynamicUniverse, refreshUniverse } from './src/scanner/stock-universe.js';
import logger from './src/utils/logger.js';

logger.info('='.repeat(60));
logger.info('株式ユニバース セットアップ');
logger.info('='.repeat(60));

// DB 初期化
await DBInit.initialize();

// キャッシュ強制リフレッシュ
logger.info('\nJPXから最新データを取得中...');
const universe = await refreshUniverse();

logger.info('\n' + '='.repeat(60));
logger.info(`✅ ユニバース取得完了: ${universe.length} 銘柄`);

// セクター別統計
const sectors = {};
for (const s of universe) {
  sectors[s.sector] = (sectors[s.sector] ?? 0) + 1;
}

logger.info('\n【セクター別銘柄数】');
Object.entries(sectors)
  .sort((a, b) => b[1] - a[1])
  .forEach(([sector, count]) => {
    const bar = '█'.repeat(Math.min(20, Math.floor(count / 10)));
    logger.info(`  ${sector.padEnd(14)} ${String(count).padStart(4)}件 ${bar}`);
  });

// 市場別統計（JPX取得時のみ）
const markets = {};
for (const s of universe) {
  if (s.market) markets[s.market] = (markets[s.market] ?? 0) + 1;
}
if (Object.keys(markets).length > 1) {
  logger.info('\n【市場別銘柄数】');
  Object.entries(markets)
    .sort((a, b) => b[1] - a[1])
    .forEach(([market, count]) => {
      logger.info(`  ${market.padEnd(20)} ${count}件`);
    });
}

// ランダムサンプル表示
logger.info('\n【ランダムサンプル（10銘柄）】');
const sample = [...universe].sort(() => Math.random() - 0.5).slice(0, 10);
sample.forEach(s => logger.info(`  ${s.symbol} ${s.name.padEnd(24)} [${s.sector}]`));

logger.info('\n' + '='.repeat(60));
logger.info('キャッシュは 7 日間有効です。');
logger.info('次回の scan-watchlist.js 実行時に自動で使用されます。');
logger.info('='.repeat(60));

process.exit(0);
