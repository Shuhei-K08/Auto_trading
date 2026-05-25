/**
 * Configuration Module
 * システム全体の設定を管理
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  // Anthropic API Configuration
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-sonnet-4-5',
  },

  // 楽天証券 API Configuration
  rakuten: {
    clientId: process.env.RAKUTEN_CLIENT_ID,
    clientSecret: process.env.RAKUTEN_CLIENT_SECRET,
    redirectUri: 'http://localhost:3000/callback',
  },

  // Trading Configuration
  trading: {
    mode: process.env.TRADING_MODE || 'demo',
    portfolioValue: parseInt(process.env.PORTFOLIO_VALUE || '1000000'),
    positionMultiplier: parseFloat(process.env.POSITION_MULTIPLIER || '1.0'),
    // 売買単位（通常は100株=1単元、単元未満株モードは1）
    tradeLotSize: parseInt(process.env.TRADE_LOT_SIZE || '100'),
  },

  // Risk Management Settings
  risk: {
    maxPositions: parseInt(process.env.MAX_POSITIONS || '5'),
    maxPositionPercent: parseFloat(process.env.MAX_POSITION_PERCENT || '0.20'),
    maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE || '0.02'),
    maxDailyLossPercent: parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || '0.05'),
    // 目標買付比率（全資本に対して何%まで投資するか）
    // 例: 0.70 = 70%, 1.00 = 100%（余力なし）
    targetAllocationPercent: parseFloat(process.env.TARGET_ALLOCATION_PERCENT || '0.70'),
  },

  // Trading Rules
  tradingRules: {
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT || '0.05'),
    takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT || '0.10'),
    confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.60'),
  },

  // Watched Stocks
  stocks: {
    watched: (process.env.WATCHED_STOCKS || '7203,6758,9984,8306,2802')
      .split(',')
      .map(s => s.trim()),
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || 'logs',
  },

  // Database Configuration
  database: {
    path: process.env.DB_PATH || 'database/trades.db',
  },

  // System paths
  paths: {
    root: path.resolve(__dirname, '..'),
    src: path.resolve(__dirname),
    database: path.resolve(__dirname, '..', 'database'),
    logs: path.resolve(__dirname, '..', process.env.LOG_DIR || 'logs'),
    exports: path.resolve(__dirname, '..', 'exports'),
  },

  // Constants
  constants: {
    TRADING_HOURS_START: 9,   // 9:00 AM
    TRADING_HOURS_END: 15,     // 3:00 PM
    EXECUTION_TIME_HOUR: 15,   // 3 PM
    EXECUTION_TIME_MIN: 5,     // 5 min
    TAX_RATE: 0.20315,         // 20.315% (復興特別税含む)
    DATA_LOOKBACK_DAYS: 60,    // 過去60日のデータを分析
    RSI_PERIOD: 14,
    MACD_FAST: 12,
    MACD_SLOW: 26,
    MACD_SIGNAL: 9,
    MA_FAST: 5,
    MA_MEDIUM: 20,
    MA_SLOW: 60,
  },
};

export default config;
