/**
 * Watchlist Manager
 * スキャン上位候補をClaudeが精査して最終ウォッチリストを決定・DB保存
 */

import Anthropic from '@anthropic-ai/sdk';
import TradeRepository from '../database/trade-repository.js';
import NeonRepository from '../database/neon-repository.js';
import logger from '../utils/logger.js';
import config from '../config.js';

const WATCHLIST_SIZE = 8;  // 最終ウォッチリスト件数

/** DATABASE_URL の有無で使用 DB を切り替え */
function createRepository() {
  return process.env.DATABASE_URL ? new NeonRepository() : new TradeRepository();
}

class WatchlistManager {
  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
    this.repository = createRepository();
  }

  // ───────────────────────────────────────────
  // 公開メソッド
  // ───────────────────────────────────────────

  /**
   * スキャン結果をもとに最終ウォッチリストを更新
   * @param {Array} candidates StockScanner.scanUniverse() の結果
   * @returns {Array} 選定された銘柄リスト
   */
  async updateWatchlist(candidates) {
    logger.info('\n[WatchlistManager] Claude による最終選定を開始...');

    // 1. Claude に候補を送って最終選定してもらう
    const selected = await this.selectWithClaude(candidates);

    // 2. DB に保存
    await this.saveWatchlist(selected);

    // 3. 次回更新日を計算して記録
    const nextUpdate = this.calcNextUpdateDate();
    logger.info(`[WatchlistManager] 次回更新予定: ${nextUpdate}`);

    return selected;
  }

  /**
   * 現在のアクティブなウォッチリストをDBから取得
   * @returns {Array} {symbol, name, sector, ...}
   */
  async getActiveWatchlist() {
    const rows = await this.repository.query(
      `SELECT * FROM watchlist WHERE is_active = 1 ORDER BY rank ASC`
    );
    return rows ?? [];
  }

  /**
   * ウォッチリストが更新が必要かチェック（半月ごと）
   * @returns {boolean}
   */
  async needsUpdate() {
    try {
      const row = await this.repository.queryOne(
        `SELECT MAX(created_at) as last_update FROM watchlist WHERE is_active = 1`
      );
      if (!row?.last_update) return true;

      const lastUpdate = new Date(row.last_update);
      const now = new Date();
      const daysDiff = (now - lastUpdate) / (1000 * 60 * 60 * 24);

      // 14日（2週間）以上経過で更新
      return daysDiff >= 14;
    } catch {
      return true;
    }
  }

  // ───────────────────────────────────────────
  // 内部メソッド
  // ───────────────────────────────────────────

  /**
   * Claude に候補リストを送り最終選定を依頼
   */
  async selectWithClaude(candidates) {
    const prompt = this.buildSelectionPrompt(candidates);

    try {
      const message = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = message.content[0].text;
      logger.debug('[WatchlistManager] Claude response:\n' + text);

      return this.parseSelectionResponse(text, candidates);
    } catch (error) {
      logger.error(`[WatchlistManager] Claude API error: ${error.message}`);
      // フォールバック：上位N件をそのまま使う
      logger.warn('[WatchlistManager] フォールバック：上位候補をそのまま使用');
      return this.fallbackSelection(candidates);
    }
  }

  /**
   * 銘柄選定プロンプトを構築
   */
  buildSelectionPrompt(candidates) {
    const candidateList = candidates.map((c, i) => `
${i + 1}. 銘柄コード: ${c.symbol}（${c.name}）
   セクター: ${c.sector}
   現在価格: ¥${c.currentPrice?.toFixed(0) ?? 'N/A'}
   テクニカルスコア: ${c.technicalScore}/100（複合スコア: ${c.compositeScore}/100）
   トレンド: ${c.trend ?? 'N/A'} | ADX: ${c.adx?.toFixed(1) ?? 'N/A'}（${c.adxStrength}）
   RSI: ${c.rsi?.toFixed(1) ?? 'N/A'} | シグナル: ${c.signal}
   指標一致率: ${((c.convergenceRate ?? 0) * 100).toFixed(0)}%（強気${c.bullishSignals ?? 0}/弱気${c.bearishSignals ?? 0}）
   一目均衡表: ${c.details?.ichimokuSignal ?? 'N/A'} | BB位置: ${c.details?.bollingerPosition ?? 'N/A'}
   ダイバージェンス: ${(c.divergences ?? []).length > 0 ? c.divergences.join('; ') : 'なし'}
`).join('');

    return `
あなたは日本株スイングトレードの専門家です。
以下のテクニカルスクリーニング上位候補から、今後2週間のスイングトレードに最適な ${WATCHLIST_SIZE} 銘柄を選んでください。

【選定基準】
1. テクニカルスコアが高く、複数指標が一致している銘柄を優先
2. セクターの分散（同一セクターから多くなりすぎない）
3. ADXが高く、トレンドが明確な銘柄
4. ダイバージェンスが少ない銘柄
5. スイングトレード向きの値動き（ボラティリティが適度）

【候補銘柄リスト（スコア順上位）】
${candidateList}

【出力形式】
以下のJSON形式のみで返してください（他の説明は不要）:
{
  "selected": [
    {
      "symbol": "7203",
      "rank": 1,
      "reason": "選定理由（1〜2文）",
      "expectedBehavior": "今後2週間の予想（上昇/レンジ/要注意）",
      "riskNote": "注意点があれば記載（なければ空文字）"
    }
  ],
  "overallMarketView": "現在の相場環境についての全体観（2〜3文）",
  "sectorAllocation": {
    "セクター名": 銘柄数
  }
}
`.trim();
  }

  /**
   * Claude のレスポンスをパース
   */
  parseSelectionResponse(text, candidates) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const result = JSON.parse(jsonMatch[0]);
      const selectedSymbols = result.selected ?? [];

      // Claude が選んだシンボルに候補データをマージ
      const enriched = selectedSymbols.map((item, i) => {
        const candidate = candidates.find(c => c.symbol === item.symbol);
        if (!candidate) {
          logger.warn(`[WatchlistManager] Symbol ${item.symbol} not in candidates, skipping`);
          return null;
        }
        return {
          ...candidate,
          rank: item.rank ?? (i + 1),
          selectionReason: item.reason ?? '',
          expectedBehavior: item.expectedBehavior ?? '',
          riskNote: item.riskNote ?? '',
          overallMarketView: result.overallMarketView ?? '',
        };
      }).filter(Boolean);

      // WATCHLIST_SIZE に満たない場合はフォールバックで補完
      if (enriched.length < WATCHLIST_SIZE) {
        const existing = new Set(enriched.map(e => e.symbol));
        for (const c of candidates) {
          if (enriched.length >= WATCHLIST_SIZE) break;
          if (!existing.has(c.symbol)) {
            enriched.push({
              ...c,
              rank: enriched.length + 1,
              selectionReason: 'テクニカルスコア上位のため補完選定',
              expectedBehavior: '要観察',
              riskNote: '',
              overallMarketView: '',
            });
            existing.add(c.symbol);
          }
        }
      }

      return enriched.slice(0, WATCHLIST_SIZE);
    } catch (e) {
      logger.error(`[WatchlistManager] Parse error: ${e.message}`);
      return this.fallbackSelection(candidates);
    }
  }

  /**
   * フォールバック：上位N件をそのまま使う
   */
  fallbackSelection(candidates) {
    return candidates.slice(0, WATCHLIST_SIZE).map((c, i) => ({
      ...c,
      rank: i + 1,
      selectionReason: 'テクニカルスコア上位（自動選定）',
      expectedBehavior: '要観察',
      riskNote: '',
      overallMarketView: '',
    }));
  }

  /**
   * ウォッチリストをDBに保存
   */
  async saveWatchlist(selected) {
    const today = new Date().toISOString().split('T')[0];
    const nextUpdate = this.calcNextUpdateDate();

    // 旧ウォッチリストを非アクティブ化
    await this.repository.execute(`UPDATE watchlist SET is_active = 0`);

    // 新規レコードを順次挿入
    const insertSql = `
      INSERT INTO watchlist (
        symbol, name, sector, rank, current_price,
        technical_score, composite_score, signal, confidence,
        adx, trend, convergence_rate,
        selection_reason, expected_behavior, risk_note, overall_market_view,
        selection_date, next_update_date, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `;

    for (const s of selected) {
      await this.repository.execute(insertSql, [
        s.symbol, s.name ?? s.symbol, s.sector ?? '不明',
        s.rank, s.currentPrice ?? 0,
        s.technicalScore ?? 0, s.compositeScore ?? 0,
        s.signal ?? 'HOLD', s.confidence ?? 0.5,
        s.adx ?? 0, s.trend ?? 'NEUTRAL',
        s.convergenceRate ?? 0,
        s.selectionReason ?? '', s.expectedBehavior ?? '',
        s.riskNote ?? '', s.overallMarketView ?? '',
        today, nextUpdate,
      ]);
    }

    logger.info(`[WatchlistManager] ${selected.length}銘柄をウォッチリストに保存（選定日: ${today}、次回: ${nextUpdate}）`);
  }

  /**
   * 次回更新日を計算（半月ごと: 1日と15日）
   */
  calcNextUpdateDate() {
    const now = new Date();
    const day = now.getDate();
    const year = now.getFullYear();
    const month = now.getMonth();

    let nextDate;
    if (day < 15) {
      nextDate = new Date(year, month, 15);
    } else {
      // 翌月1日
      nextDate = new Date(year, month + 1, 1);
    }

    return nextDate.toISOString().split('T')[0];
  }

}

export default WatchlistManager;
