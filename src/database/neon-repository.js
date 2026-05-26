/**
 * Neon Repository Module
 * PostgreSQL（Neon）を使ったクラウド対応 DB リポジトリ
 * trade-repository.js と同一インターフェース
 */

import pg from 'pg';
import logger from '../utils/logger.js';
import { DatabaseError } from '../utils/errors.js';

const { Pool } = pg;

class NeonRepository {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new DatabaseError('DATABASE_URL 環境変数が設定されていません');
    }
    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false }, // Neon は SSL 必須
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  /** 接続テスト */
  async ping() {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  }

  /** テーブル初期化（起動時に呼ぶ） */
  async initializeTables() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS analysis_log (
          id SERIAL PRIMARY KEY,
          symbol VARCHAR(10) NOT NULL,
          decision VARCHAR(10) NOT NULL,
          price REAL NOT NULL,
          quantity INTEGER NOT NULL,
          confidence REAL NOT NULL,
          stop_loss REAL,
          take_profit REAL,
          risk_reward REAL,
          reasoning TEXT,
          close_reason TEXT,
          pnl REAL,
          pnl_percent REAL,
          timestamp TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      logger.info('✓ Neon tables initialized (analysis_log)');
    } finally {
      client.release();
    }
  }

  /** プール終了 */
  async close() {
    await this.pool.end();
  }

  // ─────────────────────────────────────────────────
  // trades
  // ─────────────────────────────────────────────────

  async saveTradeRecord(tradeData) {
    const sql = `
      INSERT INTO trades (symbol, decision, entry_price, quantity, confidence, reasoning, status, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    const values = [
      tradeData.symbol,
      tradeData.decision,
      tradeData.entryPrice,
      tradeData.quantity,
      tradeData.confidence,
      tradeData.reasoning,
      'pending',
      new Date().toISOString(),
    ];
    try {
      const res = await this.pool.query(sql, values);
      logger.info(`Trade record saved: ${tradeData.symbol} ${tradeData.decision}`);
      return { id: res.rows[0].id, ...tradeData };
    } catch (e) {
      throw new DatabaseError(`Failed to save trade: ${e.message}`);
    }
  }

  async getRecentTrades(limit = 10) {
    try {
      const res = await this.pool.query(
        'SELECT * FROM trades ORDER BY timestamp DESC LIMIT $1',
        [limit]
      );
      return res.rows;
    } catch (e) {
      throw new DatabaseError(`Failed to get trades: ${e.message}`);
    }
  }

  // ─────────────────────────────────────────────────
  // positions
  // ─────────────────────────────────────────────────

  async savePosition(positionData) {
    const sql = `
      INSERT INTO positions (symbol, quantity, entry_price, entry_date, stop_loss_price, take_profit_price, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `;
    const today = new Date().toISOString().split('T')[0];
    const values = [
      positionData.symbol,
      positionData.quantity,
      positionData.entryPrice,
      today,
      positionData.stopLossPrice,
      positionData.takeProfitPrice,
      'holding',
    ];
    try {
      const res = await this.pool.query(sql, values);
      logger.info(`Position saved: ${positionData.symbol} x${positionData.quantity}`);
      return { id: res.rows[0].id, ...positionData };
    } catch (e) {
      throw new DatabaseError(`Failed to save position: ${e.message}`);
    }
  }

  async getOpenPositions() {
    try {
      const res = await this.pool.query(
        'SELECT * FROM positions WHERE status = $1 ORDER BY entry_date DESC',
        ['holding']
      );
      return res.rows;
    } catch (e) {
      throw new DatabaseError(`Failed to get positions: ${e.message}`);
    }
  }

  async getClosedPositions(limit = 50) {
    try {
      const res = await this.pool.query(
        'SELECT * FROM positions WHERE status = $1 ORDER BY exit_date DESC, id DESC LIMIT $2',
        ['closed', limit]
      );
      return res.rows;
    } catch (e) {
      throw new DatabaseError(`Failed to get closed positions: ${e.message}`);
    }
  }

  async getAllPositions(limit = 100) {
    try {
      const res = await this.pool.query(
        'SELECT * FROM positions ORDER BY entry_date DESC, id DESC LIMIT $1',
        [limit]
      );
      return res.rows;
    } catch (e) {
      throw new DatabaseError(`Failed to get all positions: ${e.message}`);
    }
  }

  async updateCurrentPrice(positionId, currentPrice, entryPrice, quantity) {
    const unrealizedPnl = (currentPrice - entryPrice) * quantity;
    const unrealizedPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
    try {
      await this.pool.query(
        `UPDATE positions SET
           current_price = $1,
           unrealized_pnl = $2,
           unrealized_pnl_percent = $3,
           updated_at = NOW()
         WHERE id = $4`,
        [currentPrice, unrealizedPnl, unrealizedPnlPct, positionId]
      );
      return { positionId, currentPrice, unrealizedPnl };
    } catch (e) {
      throw new DatabaseError(`Failed to update price: ${e.message}`);
    }
  }

  async closePosition(positionId, exitData) {
    const today = new Date().toISOString().split('T')[0];
    try {
      await this.pool.query(
        `UPDATE positions SET
           status = 'closed',
           exit_price = $1,
           exit_date = $2,
           exit_reason = $3,
           realized_pnl = $4,
           realized_pnl_percent = $5,
           current_price = $1
         WHERE id = $6`,
        [exitData.exitPrice, today, exitData.exitReason, exitData.realizedPnl, exitData.realizedPnlPercent, positionId]
      );
      logger.info(`Position #${positionId} closed: ${exitData.exitReason} PnL=¥${exitData.realizedPnl?.toFixed(0)}`);
      return { positionId, ...exitData };
    } catch (e) {
      throw new DatabaseError(`Failed to close position: ${e.message}`);
    }
  }

  async getTradeStats() {
    try {
      const res = await this.pool.query(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) AS wins,
          SUM(CASE WHEN realized_pnl <= 0 THEN 1 ELSE 0 END) AS losses,
          SUM(realized_pnl) AS total_pnl,
          AVG(realized_pnl) AS avg_pnl,
          MAX(realized_pnl) AS best_trade,
          MIN(realized_pnl) AS worst_trade,
          AVG(realized_pnl_percent) AS avg_pnl_percent
        FROM positions
        WHERE status = 'closed'
      `);
      const r = res.rows[0] || {};
      const total = parseInt(r.total) ?? 0;
      const wins  = parseInt(r.wins)  ?? 0;
      return {
        total,
        wins,
        losses:        parseInt(r.losses) ?? 0,
        winRate:       total > 0 ? (wins / total) * 100 : 0,
        totalPnl:      parseFloat(r.total_pnl) ?? 0,
        avgPnl:        parseFloat(r.avg_pnl) ?? 0,
        bestTrade:     parseFloat(r.best_trade) ?? 0,
        worstTrade:    parseFloat(r.worst_trade) ?? 0,
        avgPnlPercent: parseFloat(r.avg_pnl_percent) ?? 0,
      };
    } catch (e) {
      throw new DatabaseError(`Failed to get stats: ${e.message}`);
    }
  }

  // ─────────────────────────────────────────────────
  // portfolio
  // ─────────────────────────────────────────────────

  async updatePortfolio(portfolioData) {
    const today = new Date().toISOString().split('T')[0];
    try {
      const existing = await this.pool.query(
        'SELECT id FROM portfolio WHERE date = $1',
        [today]
      );
      if (existing.rows.length > 0) {
        await this.pool.query(
          `UPDATE portfolio SET
             initial_capital = $1,
             current_capital = $2, available_cash = $3, invested_stocks = $4,
             deposits = $5, withdrawals = $6, total_gains = $7, monthly_gains = $8
           WHERE date = $9`,
          [
            portfolioData.initialCapital,
            portfolioData.currentCapital,
            portfolioData.availableCash,
            portfolioData.investedStocks,
            portfolioData.deposits,
            portfolioData.withdrawals,
            portfolioData.totalGains,
            portfolioData.monthlyGains,
            today,
          ]
        );
      } else {
        await this.pool.query(
          `INSERT INTO portfolio
             (date, initial_capital, current_capital, available_cash, invested_stocks,
              deposits, withdrawals, total_gains, monthly_gains)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            today,
            portfolioData.initialCapital,
            portfolioData.currentCapital,
            portfolioData.availableCash,
            portfolioData.investedStocks,
            portfolioData.deposits,
            portfolioData.withdrawals,
            portfolioData.totalGains,
            portfolioData.monthlyGains,
          ]
        );
      }
      logger.debug('Portfolio updated');
      return portfolioData;
    } catch (e) {
      throw new DatabaseError(`Failed to update portfolio: ${e.message}`);
    }
  }

  async getLatestPortfolio() {
    try {
      const res = await this.pool.query(
        'SELECT * FROM portfolio ORDER BY date DESC LIMIT 1'
      );
      return res.rows[0] || null;
    } catch (e) {
      throw new DatabaseError(`Failed to get portfolio: ${e.message}`);
    }
  }

  // ─────────────────────────────────────────────────
  // analysis_log
  // ─────────────────────────────────────────────────

  async saveAnalysisLog(logData) {
    await this.pool.query(
      `INSERT INTO analysis_log
        (symbol, decision, price, quantity, confidence, stop_loss, take_profit, risk_reward, reasoning, close_reason, pnl, pnl_percent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        logData.symbol, logData.decision, logData.price, logData.quantity,
        logData.confidence, logData.stopLoss ?? null, logData.takeProfit ?? null,
        logData.riskReward ?? null, logData.reasoning ?? null,
        logData.closeReason ?? null, logData.pnl ?? null, logData.pnlPercent ?? null,
      ]
    );
  }

  // ─────────────────────────────────────────────────
  // daily_summary
  // ─────────────────────────────────────────────────

  async saveDailySummary(summaryData) {
    const today = new Date().toISOString().split('T')[0];
    try {
      await this.pool.query(
        `INSERT INTO daily_summary
           (date, trades_count, buy_count, sell_count, win_count, loss_count,
            daily_gains, win_rate, capital_start, capital_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (date) DO UPDATE SET
           trades_count = EXCLUDED.trades_count,
           buy_count = EXCLUDED.buy_count,
           sell_count = EXCLUDED.sell_count,
           win_count = EXCLUDED.win_count,
           loss_count = EXCLUDED.loss_count,
           daily_gains = EXCLUDED.daily_gains,
           win_rate = EXCLUDED.win_rate,
           capital_start = EXCLUDED.capital_start,
           capital_end = EXCLUDED.capital_end`,
        [
          today,
          summaryData.tradesCount || 0,
          summaryData.buyCount || 0,
          summaryData.sellCount || 0,
          summaryData.winCount || 0,
          summaryData.lossCount || 0,
          summaryData.dailyGains || 0,
          summaryData.winRate || 0,
          summaryData.capitalStart || 0,
          summaryData.capitalEnd || 0,
        ]
      );
      logger.info('Daily summary saved');
      return summaryData;
    } catch (e) {
      throw new DatabaseError(`Failed to save summary: ${e.message}`);
    }
  }

  // ─────────────────────────────────────────────────
  // 汎用クエリ（SQLite互換）
  // ─────────────────────────────────────────────────

  /**
   * SELECT 複数行 — SQLite の ? プレースホルダを $1,$2... に変換
   */
  async query(sql, params = []) {
    const pgSql = this._toPostgresSql(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return res.rows;
    } catch (e) {
      throw new DatabaseError(`Query failed: ${e.message}`);
    }
  }

  /** SELECT 単一行 */
  async queryOne(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  /** INSERT / UPDATE / DELETE */
  async execute(sql, params = []) {
    const pgSql = this._toPostgresSql(sql);
    try {
      const res = await this.pool.query(pgSql, params);
      return { lastID: null, changes: res.rowCount };
    } catch (e) {
      throw new DatabaseError(`Execute failed: ${e.message}`);
    }
  }

  /** SQLite ? → PostgreSQL $1,$2... 変換 */
  _toPostgresSql(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }
}

export default NeonRepository;
