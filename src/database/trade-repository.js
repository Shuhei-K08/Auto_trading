/**
 * Trade Repository Module
 * データベース操作の主要な機能
 */

import sqlite3 from 'sqlite3';
import logger from '../utils/logger.js';
import config from '../config.js';
import { DatabaseError } from '../utils/errors.js';

class TradeRepository {
  constructor() {
    this.dbPath = config.database.path;
  }

  /**
   * データベース接続を取得
   */
  getDB() {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(new DatabaseError(`Failed to open database: ${err.message}`));
        } else {
          resolve(db);
        }
      });
    });
  }

  /**
   * 取引記録を保存
   */
  async saveTradeRecord(tradeData) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO trades (
          symbol, decision, entry_price, quantity, confidence, reasoning, status, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

      db.run(sql, values, function (err) {
        db.close();

        if (err) {
          logger.error(`Failed to save trade record: ${err.message}`);
          reject(new DatabaseError(`Failed to save trade: ${err.message}`));
        } else {
          logger.info(`Trade record saved: ${tradeData.symbol} ${tradeData.decision}`);
          resolve({ id: this.lastID, ...tradeData });
        }
      });
    });
  }

  /**
   * ポジションを記録
   */
  async savePosition(positionData) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO positions (
          symbol, quantity, entry_price, entry_date, stop_loss_price, take_profit_price, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
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

      db.run(sql, values, function (err) {
        db.close();

        if (err) {
          logger.error(`Failed to save position: ${err.message}`);
          reject(new DatabaseError(`Failed to save position: ${err.message}`));
        } else {
          logger.info(`Position saved: ${positionData.symbol} x${positionData.quantity}`);
          resolve({ id: this.lastID, ...positionData });
        }
      });
    });
  }

  /**
   * ポートフォリオ情報を更新
   */
  async updatePortfolio(portfolioData) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const today = new Date().toISOString().split('T')[0];

      // 既存レコードをチェック
      const selectSql = 'SELECT id FROM portfolio WHERE date = ?';

      db.get(selectSql, [today], (err, row) => {
        if (err) {
          db.close();
          reject(new DatabaseError(`Failed to query portfolio: ${err.message}`));
          return;
        }

        let sql;
        let values;

        if (row) {
          // 更新
          sql = `
            UPDATE portfolio SET
              current_capital = ?, available_cash = ?, invested_stocks = ?,
              deposits = ?, withdrawals = ?, total_gains = ?, monthly_gains = ?
            WHERE date = ?
          `;
          values = [
            portfolioData.currentCapital,
            portfolioData.availableCash,
            portfolioData.investedStocks,
            portfolioData.deposits,
            portfolioData.withdrawals,
            portfolioData.totalGains,
            portfolioData.monthlyGains,
            today,
          ];
        } else {
          // 挿入
          sql = `
            INSERT INTO portfolio (
              date, initial_capital, current_capital, available_cash, invested_stocks,
              deposits, withdrawals, total_gains, monthly_gains
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          values = [
            today,
            portfolioData.initialCapital,
            portfolioData.currentCapital,
            portfolioData.availableCash,
            portfolioData.investedStocks,
            portfolioData.deposits,
            portfolioData.withdrawals,
            portfolioData.totalGains,
            portfolioData.monthlyGains,
          ];
        }

        db.run(sql, values, (err) => {
          db.close();

          if (err) {
            logger.error(`Failed to update portfolio: ${err.message}`);
            reject(new DatabaseError(`Failed to update portfolio: ${err.message}`));
          } else {
            logger.debug('Portfolio updated');
            resolve(portfolioData);
          }
        });
      });
    });
  }

  /**
   * 最新のポートフォリオ情報を取得
   */
  async getLatestPortfolio() {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM portfolio ORDER BY date DESC LIMIT 1';

      db.get(sql, (err, row) => {
        db.close();

        if (err) {
          reject(new DatabaseError(`Failed to get portfolio: ${err.message}`));
        } else {
          resolve(row || null);
        }
      });
    });
  }

  /**
   * オープンポジションの現在価格・含み損益を更新（ホールド継続時に呼ぶ）
   */
  async updateCurrentPrice(positionId, currentPrice, entryPrice, quantity) {
    const db = await this.getDB();
    const unrealizedPnl = (currentPrice - entryPrice) * quantity;
    const unrealizedPnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE positions SET
           current_price        = ?,
           unrealized_pnl       = ?,
           unrealized_pnl_percent = ?,
           updated_at           = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [currentPrice, unrealizedPnl, unrealizedPnlPct, positionId],
        function (err) {
          db.close();
          if (err) reject(new DatabaseError(`Failed to update price: ${err.message}`));
          else resolve({ positionId, currentPrice, unrealizedPnl });
        }
      );
    });
  }

  /**
   * ポジションを決済（クローズ）
   */
  async closePosition(positionId, exitData) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const sql = `
        UPDATE positions SET
          status              = 'closed',
          exit_price          = ?,
          exit_date           = ?,
          exit_reason         = ?,
          realized_pnl        = ?,
          realized_pnl_percent = ?,
          current_price       = ?
        WHERE id = ?
      `;
      const today = new Date().toISOString().split('T')[0];
      db.run(sql, [
        exitData.exitPrice,
        today,
        exitData.exitReason,
        exitData.realizedPnl,
        exitData.realizedPnlPercent,
        exitData.exitPrice,
        positionId,
      ], function (err) {
        db.close();
        if (err) {
          reject(new DatabaseError(`Failed to close position: ${err.message}`));
        } else {
          logger.info(`Position #${positionId} closed: ${exitData.exitReason} PnL=¥${exitData.realizedPnl?.toFixed(0)}`);
          resolve({ positionId, ...exitData });
        }
      });
    });
  }

  /**
   * 決済済みポジション一覧を取得
   */
  async getClosedPositions(limit = 50) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM positions
        WHERE status = 'closed'
        ORDER BY exit_date DESC, id DESC
        LIMIT ?
      `;
      db.all(sql, [limit], (err, rows) => {
        db.close();
        if (err) {
          reject(new DatabaseError(`Failed to get closed positions: ${err.message}`));
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 全ポジション（保有中＋決済済み）を取得
   */
  async getAllPositions(limit = 100) {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM positions ORDER BY entry_date DESC, id DESC LIMIT ?',
        [limit],
        (err, rows) => {
          db.close();
          if (err) reject(new DatabaseError(`Failed to get all positions: ${err.message}`));
          else resolve(rows || []);
        }
      );
    });
  }

  /**
   * トレード統計を計算
   */
  async getTradeStats() {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const sql = `
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
      `;
      db.get(sql, (err, row) => {
        db.close();
        if (err) reject(new DatabaseError(`Failed to get stats: ${err.message}`));
        else {
          const r = row || {};
          resolve({
            total:          r.total ?? 0,
            wins:           r.wins ?? 0,
            losses:         r.losses ?? 0,
            winRate:        r.total > 0 ? (r.wins / r.total) * 100 : 0,
            totalPnl:       r.total_pnl ?? 0,
            avgPnl:         r.avg_pnl ?? 0,
            bestTrade:      r.best_trade ?? 0,
            worstTrade:     r.worst_trade ?? 0,
            avgPnlPercent:  r.avg_pnl_percent ?? 0,
          });
        }
      });
    });
  }

  /**
   * 保有ポジション一覧を取得
   */
  async getOpenPositions() {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const sql = 'SELECT * FROM positions WHERE status = ? ORDER BY entry_date DESC';

      db.all(sql, ['holding'], (err, rows) => {
        db.close();

        if (err) {
          reject(new DatabaseError(`Failed to get positions: ${err.message}`));
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 最近の取引記録を取得
   */
  async getRecentTrades(limit = 10) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const sql =
        'SELECT * FROM trades ORDER BY timestamp DESC LIMIT ? ';

      db.all(sql, [limit], (err, rows) => {
        db.close();

        if (err) {
          reject(new DatabaseError(`Failed to get trades: ${err.message}`));
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * 日別サマリーを保存
   */
  async saveDailySummary(summaryData) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      const today = new Date().toISOString().split('T')[0];

      const sql = `
        INSERT OR REPLACE INTO daily_summary (
          date, trades_count, buy_count, sell_count, win_count, loss_count,
          daily_gains, win_rate, capital_start, capital_end
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const values = [
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
      ];

      db.run(sql, values, (err) => {
        db.close();

        if (err) {
          logger.error(`Failed to save daily summary: ${err.message}`);
          reject(new DatabaseError(`Failed to save summary: ${err.message}`));
        } else {
          logger.info('Daily summary saved');
          resolve(summaryData);
        }
      });
    });
  }

  /**
   * SQL クエリを実行（汎用）
   */
  async query(sql, params = []) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        db.close();

        if (err) {
          reject(new DatabaseError(`Query failed: ${err.message}`));
        } else {
          resolve(rows || []);
        }
      });
    });
  }

  /**
   * SQL 単一行クエリを実行
   */
  async queryOne(sql, params = []) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        db.close();

        if (err) {
          reject(new DatabaseError(`Query failed: ${err.message}`));
        } else {
          resolve(row || null);
        }
      });
    });
  }

  /**
   * SQL 実行（INSERT/UPDATE/DELETE）
   */
  async execute(sql, params = []) {
    const db = await this.getDB();

    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        db.close();

        if (err) {
          reject(new DatabaseError(`Execute failed: ${err.message}`));
        } else {
          resolve({
            lastID: this.lastID,
            changes: this.changes,
          });
        }
      });
    });
  }
}

export default TradeRepository;
