/**
 * JPX Universe Fetcher
 * 東京証券取引所 公式上場銘柄一覧を取得・パースして全銘柄リストを返す
 *
 * 取得戦略（優先順位）:
 *   1. キャッシュ（7日以内）
 *   2. JPX公式ページから最新ダウンロードURLを自動発見してExcel取得
 *   3. Stooq から日本株CSVリストを取得（バックアップ）
 *   4. null を返す → 呼び出し元がスタティックリストへフォールバック
 *
 * 手動ダウンロードも可:
 *   https://www.jpx.co.jp/markets/statistics-equities/misc/01.html
 *   からExcelをダウンロードして database/data_j.xlsx に置くと自動で読み込む
 */

import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// xlsx は optional dependency
let XLSX = null;
try {
  XLSX = await import('xlsx');
} catch {
  // xlsx 未インストール時はフォールバック（npm install xlsxで有効化）
}

const JPX_PAGE_URL = 'https://www.jpx.co.jp/markets/statistics-equities/misc/01.html';
const CACHE_FILE   = path.resolve(__dirname, '../../database/jpx_universe_cache.json');
const MANUAL_FILE  = path.resolve(__dirname, '../../database/data_j.xlsx');
const CACHE_TTL_DAYS = 7;

// デフォルトHTTPヘッダー（JPXはReferer必須）
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
};

/**
 * 東証 17業種区分 → 本システムセクター名 マッピング
 */
const SECTOR_MAP = {
  '食品':               '食品',
  'エネルギー資源':     'エネルギー',
  '建設・資材':         '建設',
  '素材・化学':         '化学',
  '医薬品・バイオ':     '医薬品',
  '自動車・輸送機':     '自動車',
  '鉄鋼・非鉄':        '鉄鋼',
  '機械':               '機械',
  '電機・精密':         '電機',
  'IT・サービス・その他': 'IT・通信',
  '金融（除く銀行）':   '証券・保険',
  '銀行':               '銀行',
  '不動産':             '不動産',
  '小売':               '小売',
  '輸送・物流':         '物流',
  '電力・ガス':         'エネルギー',
  '通信':               'IT・通信',
};

const TARGET_MARKETS = ['プライム', 'スタンダード', 'グロース'];

class JpxUniverseFetcher {
  /**
   * 全銘柄リストを返す（キャッシュ優先）
   * @returns {Promise<Array<{symbol, name, sector, market}> | null>}
   */
  async fetchUniverse() {
    // 1. キャッシュ確認
    const cached = await this.loadCache();
    if (cached) {
      logger.info(`[JpxFetcher] キャッシュから ${cached.length} 銘柄をロード`);
      return cached;
    }

    if (!XLSX) {
      logger.warn('[JpxFetcher] xlsx未インストール。npm install xlsx を実行してください。');
      return null;
    }

    // 2. 手動配置ファイルを確認
    const manual = await this.loadManualFile();
    if (manual) {
      await this.saveCache(manual);
      return manual;
    }

    // 3. JPXページから最新ダウンロードURLを発見して取得
    try {
      const downloadUrl = await this.discoverDownloadUrl();
      if (downloadUrl) {
        const universe = await this.downloadAndParse(downloadUrl);
        if (universe && universe.length > 100) {
          await this.saveCache(universe);
          logger.info(`[JpxFetcher] JPX取得成功: ${universe.length} 銘柄`);
          return universe;
        }
      }
    } catch (err) {
      logger.warn(`[JpxFetcher] JPX取得失敗: ${err.message}`);
    }

    // 4. Stooq CSV バックアップ
    try {
      const stooq = await this.fetchFromStooq();
      if (stooq && stooq.length > 100) {
        await this.saveCache(stooq);
        logger.info(`[JpxFetcher] Stooq取得成功: ${stooq.length} 銘柄`);
        return stooq;
      }
    } catch (err) {
      logger.warn(`[JpxFetcher] Stooq取得失敗: ${err.message}`);
    }

    logger.warn('[JpxFetcher] 全ソース取得失敗 → スタティックフォールバックへ');
    return null;
  }

  /**
   * JPXページをパースして最新ダウンロードURLを発見
   */
  async discoverDownloadUrl() {
    logger.info('[JpxFetcher] JPXページからダウンロードURL検索中...');
    const res = await axios.get(JPX_PAGE_URL, {
      headers: DEFAULT_HEADERS,
      timeout: 15000,
    });
    const html = res.data;

    // href="...data_j..." パターンを探す
    const patterns = [
      /href="([^"]*data_j[^"]*\.xls[x]?)"/gi,
      /href="([^"]*tvdivq[^"]*\.xls[x]?)"/gi,
      /href="([^"]*listing[^"]*\.xls[x]?)"/gi,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(html);
      if (match) {
        const url = match[1].startsWith('http') ? match[1]
          : `https://www.jpx.co.jp${match[1]}`;
        logger.info(`[JpxFetcher] ダウンロードURL発見: ${url}`);
        return url;
      }
    }
    return null;
  }

  /**
   * ExcelファイルをダウンロードしてパースURLを指定
   */
  async downloadAndParse(url) {
    logger.info(`[JpxFetcher] ダウンロード中: ${url}`);
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        ...DEFAULT_HEADERS,
        'Referer': JPX_PAGE_URL,
        'Accept': 'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*',
      },
    });
    return this.parseExcelBuffer(Buffer.from(res.data));
  }

  /**
   * 手動配置ファイル（database/data_j.xlsx）を読み込む
   */
  async loadManualFile() {
    try {
      await fs.access(MANUAL_FILE);
      logger.info(`[JpxFetcher] 手動配置ファイルを読み込み: ${MANUAL_FILE}`);
      const buf = await fs.readFile(MANUAL_FILE);
      return this.parseExcelBuffer(buf);
    } catch {
      return null;
    }
  }

  /**
   * Excel バッファをパースして銘柄リストに変換
   */
  parseExcelBuffer(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    logger.info(`[JpxFetcher] ${rows.length} 行をパース中...`);

    const universe = [];
    for (const row of rows) {
      const rawCode = row['コード'] ?? row['code'] ?? row['Code'] ?? '';
      const code = String(rawCode).replace(/\D/g, '').padStart(4, '0').slice(-4);
      if (!/^\d{4}$/.test(code)) continue;

      const market = String(row['市場・商品区分'] ?? row['市場区分'] ?? '');
      if (!TARGET_MARKETS.some(m => market.includes(m))) continue;

      const name    = String(row['銘柄名'] ?? row['名称'] ?? code).trim();
      const sector17 = String(row['17業種区分'] ?? row['業種'] ?? '');
      const sector  = SECTOR_MAP[sector17] ?? 'その他';

      universe.push({ symbol: code, name, sector, market });
    }
    return universe;
  }

  /**
   * Stooq から日本株リストを CSV で取得（バックアップソース）
   * https://stooq.com → 日本株 TSE 全銘柄
   */
  async fetchFromStooq() {
    // Stooq の東証全銘柄リスト (TSE)
    const url = 'https://stooq.com/db/l/?b=4&t=d&e=txt';
    logger.info(`[JpxFetcher] Stooqから取得中: ${url}`);
    const res = await axios.get(url, {
      headers: { 'User-Agent': DEFAULT_HEADERS['User-Agent'] },
      timeout: 20000,
    });
    const lines = res.data.split('\n').filter(l => l.trim());

    // フォーマット: SYMBOL,NAME,... のCSV（ヘッダー行あり）
    const universe = [];
    for (const line of lines.slice(1)) {
      const parts = line.split(',');
      const rawSym = (parts[0] ?? '').trim();
      // 日本株: 4桁数字.JP の形式
      const match = rawSym.match(/^(\d{4})\.JP$/i);
      if (!match) continue;
      const code = match[1];
      const name = (parts[1] ?? code).trim();
      universe.push({ symbol: code, name, sector: 'その他', market: '東証' });
    }
    return universe;
  }

  /**
   * キャッシュ読み込み
   */
  async loadCache() {
    try {
      const stat = await fs.stat(CACHE_FILE);
      const ageDays = (Date.now() - stat.mtime.getTime()) / 86400000;
      if (ageDays > CACHE_TTL_DAYS) {
        logger.info('[JpxFetcher] キャッシュ期限切れ（7日超）');
        return null;
      }
      return JSON.parse(await fs.readFile(CACHE_FILE, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * キャッシュ保存
   */
  async saveCache(universe) {
    try {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE, JSON.stringify(universe, null, 2), 'utf-8');
      logger.info(`[JpxFetcher] ${universe.length} 銘柄をキャッシュ保存`);
    } catch (err) {
      logger.warn(`[JpxFetcher] キャッシュ保存失敗: ${err.message}`);
    }
  }

  /**
   * キャッシュ強制削除（手動更新用）
   */
  async clearCache() {
    try {
      await fs.unlink(CACHE_FILE);
      logger.info('[JpxFetcher] キャッシュ削除完了');
    } catch { /* ignore */ }
  }
}

export default JpxUniverseFetcher;
