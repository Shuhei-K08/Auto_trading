-- ============================================
-- Neon PostgreSQL Schema
-- 自動株式売買ツール - クラウドDB定義
-- ============================================
-- 使い方:
--   1. https://neon.tech でプロジェクトを作成
--   2. 接続文字列（DATABASE_URL）をコピー
--   3. このファイルを Neon の SQL エディタで実行
-- ============================================

-- portfolio テーブル
CREATE TABLE IF NOT EXISTS portfolio (
  id               SERIAL PRIMARY KEY,
  date             DATE NOT NULL UNIQUE,
  initial_capital  REAL DEFAULT 1000000,
  current_capital  REAL NOT NULL,
  available_cash   REAL NOT NULL,
  invested_stocks  REAL NOT NULL,
  deposits         REAL DEFAULT 0,
  withdrawals      REAL DEFAULT 0,
  total_gains      REAL DEFAULT 0,
  monthly_gains    REAL DEFAULT 0,
  pending_deposits REAL DEFAULT 0,
  pending_purchases REAL DEFAULT 0,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- positions テーブル
CREATE TABLE IF NOT EXISTS positions (
  id                    SERIAL PRIMARY KEY,
  symbol                VARCHAR(10) NOT NULL,
  quantity              INTEGER NOT NULL,
  entry_price           REAL NOT NULL,
  entry_date            DATE NOT NULL,
  current_price         REAL,
  unrealized_pnl        REAL,
  unrealized_pnl_percent REAL,
  status                VARCHAR(20) DEFAULT 'holding',
  delivery_date         DATE,
  stop_loss_price       REAL,
  take_profit_price     REAL,
  technical_score       INTEGER,
  confidence            REAL,
  signal                VARCHAR(10),
  exit_price            REAL,
  exit_date             DATE,
  exit_reason           VARCHAR(30),
  realized_pnl          REAL,
  realized_pnl_percent  REAL,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- trades テーブル
CREATE TABLE IF NOT EXISTS trades (
  id          SERIAL PRIMARY KEY,
  symbol      VARCHAR(10) NOT NULL,
  decision    VARCHAR(10) NOT NULL,
  entry_price REAL NOT NULL,
  quantity    INTEGER NOT NULL,
  confidence  REAL NOT NULL,
  reasoning   TEXT,
  status      VARCHAR(20),
  exit_price  REAL,
  pnl         REAL,
  timestamp   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- daily_summary テーブル
CREATE TABLE IF NOT EXISTS daily_summary (
  id            SERIAL PRIMARY KEY,
  date          DATE NOT NULL UNIQUE,
  trades_count  INTEGER,
  buy_count     INTEGER,
  sell_count    INTEGER,
  win_count     INTEGER,
  loss_count    INTEGER,
  daily_gains   REAL,
  win_rate      REAL,
  capital_start REAL,
  capital_end   REAL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- watchlist テーブル
CREATE TABLE IF NOT EXISTS watchlist (
  id                  SERIAL PRIMARY KEY,
  symbol              VARCHAR(10) NOT NULL,
  name                VARCHAR(100),
  sector              VARCHAR(50),
  rank                INTEGER,
  current_price       REAL,
  technical_score     INTEGER,
  composite_score     INTEGER,
  signal              VARCHAR(10),
  confidence          REAL,
  adx                 REAL,
  trend               VARCHAR(20),
  convergence_rate    REAL,
  selection_reason    TEXT,
  expected_behavior   TEXT,
  risk_note           TEXT,
  overall_market_view TEXT,
  selection_date      DATE,
  next_update_date    DATE,
  is_active           INTEGER DEFAULT 1,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- cash_flow テーブル
CREATE TABLE IF NOT EXISTS cash_flow (
  id         SERIAL PRIMARY KEY,
  date       DATE NOT NULL,
  type       VARCHAR(10) NOT NULL,
  amount     REAL NOT NULL,
  reason     VARCHAR(100),
  approved   BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_positions_status    ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_symbol    ON positions(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp    ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_date      ON portfolio(date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_summary_date  ON daily_summary(date DESC);
