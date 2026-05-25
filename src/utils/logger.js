/**
 * Logger Module
 * Winston を使用したログ管理
 */

import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ログディレクトリ作成
const logsDir = config.paths.logs;
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// 日付フォーマット
const getDateString = () => {
  const now = new Date();
  return now.toISOString().split('T')[0];
};

// ログレベルカラー
const colors = {
  error: '\x1b[31m',    // Red
  warn: '\x1b[33m',     // Yellow
  info: '\x1b[36m',     // Cyan
  debug: '\x1b[35m',    // Magenta
  reset: '\x1b[0m',     // Reset
};

// カスタムフォーマット
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ level, message, timestamp }) => {
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  })
);

// ロガー初期化
const logger = winston.createLogger({
  level: config.logging.level,
  format: customFormat,
  transports: [
    // ファイルログ（全レベル）
    new winston.transports.File({
      filename: path.join(logsDir, `${getDateString()}.log`),
      maxsize: 10485760, // 10MB
      maxFiles: 30,      // 30日分保持
    }),
    // エラーログ
    new winston.transports.File({
      filename: path.join(logsDir, `${getDateString()}-error.log`),
      level: 'error',
      maxsize: 10485760,
      maxFiles: 30,
    }),
    // コンソール出力
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.printf(({ level, message, timestamp }) => {
          const color = colors[level] || colors.info;
          return `${color}[${timestamp}] [${level.toUpperCase()}]${colors.reset} ${message}`;
        })
      ),
    }),
  ],
});

export default logger;
