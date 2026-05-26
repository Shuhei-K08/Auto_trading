/**
 * Database Initialization Module
 * SQLite データベーステーブル作成・初期化
 */

import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import config from '../config.js';
import { DatabaseError } from '../utils/errors.js';

class DBInit {
  /**
   * データベースを初期化
   */
  static async initialize() {
    return new Promise((resolve, reject) => {
      // データベースディレクトリ作成
      const dbDir = config.paths.database;
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      const dbPath = config.database.path;
      const db = new sqlite3.Database(dbPath, (err) => {
        if (err) {
          reject(new DatabaseError(`Failed to open database: ${err.message}`));
          return;
        }

        logger.info(`Database opened: ${dbPath}`);

        // テーブル作成 → マイグレーション
        DBInit.createTables(db)
          .then(() => DBInit.migratePositionsTable(db))
          .then(() => {
            db.close((err) => {
              if (err) {
                logger.error(`Error closing database: ${err.message}`);
              }
              resolve();
            });
          })
          .catch((error) => {
            db.close();
            reject(error);
          });
      });
    });
  }

  /**
   * テーブルを作成
   */
  static async createTables(db) {
    return new Promise((resolve, reject) => {
      const tables = [
        {
          name: 'portfolio',
          sql: `
            CREATE TABLE IF NOT EXISTS portfolio (
              id INTEGER PRIMARY KEY,
              date DATE NOT NULL UNIQUE,
              initial_capital REAL DEFAULT 1000000,
              current_capital REAL NOT NULL,
              available_cash REAL NOT NULL,
              invested_stocks REAL NOT NULL,
              deposits REAL DEFAULT 0,
              withdrawals REAL DEFAULT 0,
              total_gains REAL DEFAULT 0,
              monthly_gains REAL DEFAULT 0,
              pending_deposits REAL DEFAULT 0,
              pending_purchases REAL DEFAULT 0,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `,
        },
        {
          name: 'trades',
          sql: `
            CREATE TABLE IF NOT EXISTS trades (
              id INTEGER PRIMARY KEY,
              symbol VARCHAR(10) NOT NULL,
              decision VARCHAR(10) NOT NULL,
              entry_price REAL NOT NULL,
              quantity INTEGER NOT NULL,
              confidence REAL NOT NULL,
              reasoning TEXT,
              status VARCHAR(20),
              exit_price REAL,
              pnl REAL,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `,
        },
        {
          name: 'positions',
          sql: `
            CREATE TABLE IF NOT EXISTS positions (
              id INTEGER PRIMARY KEY,
              symbol VARCHAR(10) NOT NULL,
              quantity INTEGER NOT NULL,
              entry_price REAL NOT NULL,
              entry_date DATE NOT NULL,
              current_price REAL,
              unrealized_pnl REAL,
              status VARCHAR(20) DEFAULT 'holding',
              delivery_date DATE,
              stop_loss_price REAL,
              take_profit_price REAL,
              technical_score INTEGER,
              confidence REAL,
              signal VARCHAR(10),
              exit_price REAL,
              exit_date DATE,
              exit_reason VARCHAR(30),
              realized_pnl REAL,
              realized_pnl_percent REAL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `,
        },
        {
          name: 'cash_flow',
          sql: `
            CREATE TABLE IF NOT EXISTS cash_flow (
              id INTEGER PRIMARY KEY,
              date DATE NOT NULL,
              type VARCHAR(10) NOT NULL,
              amount REAL NOT NULL,
              reason VARCHAR(100),
              approved BOOLEAN DEFAULT FALSE,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `,
        },
        {
          name: 'daily_summary',
          sql: `
            CREATE TABLE IF NOT EXISTS daily_summary (
              id INTEGER PRIMARY KEY,
              date DATE NOT NULL UNIQUE,
              trades_count INTEGER,
              buy_count INTEGER,
              sell_count INTEGER,
              win_count INTEGER,
              loss_count INTEGER,
              daily_gains REAL,
              win_rate REAL,
              capital_start REAL,
              capital_end REAL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `,
        },
        {
          name: 'analysis_log',
          sql: `
            CREATE TABLE IF NOT EXISTS analysis_log (
              id INTEGER PRIMARY KEY,
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
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `,
        },
        {
          name: 'watchlist',
          sql: `
            CREATE TABLE IF NOT EXISTS watchlist (
              id INTEGER PRIMARY KEY,
              symbol VARCHAR(10) NOT NULL,
              name VARCHAR(100),
              sector VARCHAR(50),
              rank INTEGER,
              current_price REAL,
              technical_score INTEGER,
              composite_score INTEGER,
              signal VARCHAR(10),
              confidence REAL,
              adx REAL,
              trend VARCHAR(20),
              convergence_rate REAL,
              selection_reason TEXT,
              expected_behavior TEXT,
              risk_note TEXT,
              overall_market_view TEXT,
              selection_date DATE,
              next_update_date DATE,
              is_active INTEGER DEFAULT 1,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
          `,
        },
      ];

      let completed = 0;

      tables.forEach((table) => {
        db.run(table.sql, (err) => {
          if (err) {
            reject(new DatabaseError(`Failed to create ${table.name} table: ${err.message}`));
            return;
          }

          logger.info(`✓ Table created: ${table.name}`);
          completed++;

          if (completed === tables.length) {
            resolve();
          }
        });
      });
    });
  }

  /**
   * positions テーブルに決済用カラムを追加（既存DBへのマイグレーション）
   */
  static async migratePositionsTable(db) {
    const newColumns = [
      { name: 'technical_score',        def: 'INTEGER' },
      { name: 'confidence',             def: 'REAL' },
      { name: 'signal',                 def: "VARCHAR(10)" },
      { name: 'exit_price',             def: 'REAL' },
      { name: 'exit_date',              def: 'DATE' },
      { name: 'exit_reason',            def: 'VARCHAR(30)' },
      { name: 'realized_pnl',           def: 'REAL' },
      { name: 'realized_pnl_percent',   def: 'REAL' },
      { name: 'unrealized_pnl_percent', def: 'REAL' },
      { name: 'updated_at',             def: 'TIMESTAMP' },
    ];

    for (const col of newColumns) {
      await new Promise((resolve) => {
        db.run(
          `ALTER TABLE positions ADD COLUMN ${col.name} ${col.def}`,
          (err) => {
            // "duplicate column name" エラーは無視（既に存在する場合）
            if (err && !err.message.includes('duplicate column')) {
              logger.warn(`Migration warning (${col.name}): ${err.message}`);
            }
            resolve();
          }
        );
      });
    }
    logger.info('✓ positions table migration complete');
  }

  /**
   * データベースをリセット（テスト用）
   */
  static async reset() {
    return new Promise((resolve, reject) => {
      const dbPath = config.database.path;

      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        logger.warn('Database file deleted');
      }

      DBInit.initialize()
        .then(() => {
          logger.info('Database reset completed');
          resolve();
        })
        .catch((error) => {
          reject(error);
        });
    });
  }
}

export default DBInit;
