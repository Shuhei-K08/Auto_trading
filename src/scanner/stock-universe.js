/**
 * Stock Universe
 * 動的 JPX 取得 + スタティックフォールバックの統合エントリポイント
 *
 * 優先順位:
 *   1. JPX公式 Excel (東証全上場株 ~3800銘柄) → jpx-fetcher.js
 *   2. スタティック大型リスト (~350銘柄)        → stock-universe-large.js
 *   3. 旧スタティックリスト (~90銘柄)           → 互換性維持用エクスポート
 */

import JpxUniverseFetcher from './jpx-fetcher.js';
import STOCK_UNIVERSE_LARGE_DEDUPED from './stock-universe-large.js';
import logger from '../utils/logger.js';

// ── 旧インターフェース互換 ──────────────────────────────────────────────────
// 既存コードが import { STOCK_UNIVERSE } from './stock-universe.js' を使っている場合も動く
export const STOCK_UNIVERSE = STOCK_UNIVERSE_LARGE_DEDUPED;
export const UNIVERSE_SIZE  = STOCK_UNIVERSE_LARGE_DEDUPED.length;

export function getSectors() {
  return [...new Set(STOCK_UNIVERSE_LARGE_DEDUPED.map(s => s.sector))];
}

export function getStocksBySector(sector) {
  return STOCK_UNIVERSE_LARGE_DEDUPED.filter(s => s.sector === sector);
}

export function getStockInfo(symbol) {
  return STOCK_UNIVERSE_LARGE_DEDUPED.find(s => s.symbol === symbol)
    || { symbol, name: symbol, sector: '不明' };
}

// ── 動的ユニバース取得（JPX優先） ───────────────────────────────────────────
let _cachedDynamicUniverse = null;

/**
 * JPX公式データ or スタティックリストを返す
 * StockScanner から呼ぶことで毎回取得するのではなく起動時に1回だけロード
 * @returns {Promise<Array<{symbol, name, sector, market?}>>}
 */
export async function getDynamicUniverse() {
  if (_cachedDynamicUniverse) return _cachedDynamicUniverse;

  try {
    const fetcher = new JpxUniverseFetcher();
    const jpxUniverse = await fetcher.fetchUniverse();

    if (jpxUniverse && jpxUniverse.length > 100) {
      _cachedDynamicUniverse = jpxUniverse;
      logger.info(`[Universe] JPXユニバース使用: ${jpxUniverse.length} 銘柄`);
      return _cachedDynamicUniverse;
    }
  } catch (err) {
    logger.warn(`[Universe] JPX取得失敗: ${err.message} → スタティックフォールバック`);
  }

  _cachedDynamicUniverse = STOCK_UNIVERSE_LARGE_DEDUPED;
  logger.info(`[Universe] スタティックフォールバック: ${_cachedDynamicUniverse.length} 銘柄`);
  return _cachedDynamicUniverse;
}

/**
 * JPXキャッシュを強制リフレッシュ
 */
export async function refreshUniverse() {
  _cachedDynamicUniverse = null;
  const fetcher = new JpxUniverseFetcher();
  await fetcher.clearCache();
  return getDynamicUniverse();
}

export default STOCK_UNIVERSE_LARGE_DEDUPED;
