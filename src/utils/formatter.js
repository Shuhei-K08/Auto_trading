/**
 * Formatter Module
 * データ整形とフォーマット関連の処理
 */

/**
 * 株価データを Claude に送信するフォーマットに整形
 */
export function formatStockDataForClaude(symbol, stockData, indicators) {
  const recentData = stockData.historical.slice(-60); // 過去60日

  return {
    symbol,
    price: stockData.currentPrice,
    currency: 'JPY',
    technical_data: {
      ma5: indicators.ma5,
      ma20: indicators.ma20,
      ma60: indicators.ma60,
      rsi: indicators.rsi,
      macd_line: indicators.macd.line,
      macd_signal: indicators.macd.signal,
      macd_histogram: indicators.macd.histogram,
      volume_avg: indicators.volumeAvg,
      volume_current: stockData.historical[stockData.historical.length - 1]?.volume || 0,
      price_change_percent: ((stockData.currentPrice - recentData[0]?.close) / recentData[0]?.close * 100).toFixed(2),
    },
    historical_data: recentData.map(d => ({
      date: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    })),
  };
}

/**
 * 金額をフォーマット（通貨表記）
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
  }).format(amount);
}

/**
 * パーセンテージをフォーマット
 */
export function formatPercent(value, decimals = 2) {
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * 日付をフォーマット
 */
export function formatDate(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * タイムスタンプをフォーマット
 */
export function formatTimestamp(date) {
  const d = new Date(date);
  const dateStr = formatDate(d);
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${dateStr} ${hours}:${minutes}:${seconds}`;
}

/**
 * 数値をカンマ区切りでフォーマット
 */
export function formatNumber(num) {
  return num.toLocaleString('ja-JP');
}

/**
 * Claude からの応答をパース
 */
export function parseClaudeResponse(text) {
  try {
    // JSON形式の応答を探す
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    // テキストから判定を抽出
    const decision = extractDecision(text);
    const confidence = extractConfidence(text);

    return {
      decision,
      confidence,
      reasoning: text,
    };
  } catch (error) {
    return {
      decision: 'HOLD',
      confidence: 0,
      reasoning: text,
    };
  }
}

/**
 * テキストから売買判定を抽出
 */
function extractDecision(text) {
  const text_upper = text.toUpperCase();
  if (text_upper.includes('BUY')) return 'BUY';
  if (text_upper.includes('SELL')) return 'SELL';
  return 'HOLD';
}

/**
 * テキストから信頼度を抽出
 */
function extractConfidence(text) {
  const patterns = [
    /confidence[:\s]*([0-9.]+)/i,
    /([0-9.]+)\s*%?\s*confidence/i,
    /([0-9.]+)%/,
    /0\.[0-9]+/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      let value = parseFloat(match[1]);
      // パーセンテージの場合は0-1に正規化
      if (value > 1) {
        value = value / 100;
      }
      return Math.min(Math.max(value, 0), 1);
    }
  }

  return 0.5; // デフォルト
}

export default {
  formatStockDataForClaude,
  formatCurrency,
  formatPercent,
  formatDate,
  formatTimestamp,
  formatNumber,
  parseClaudeResponse,
};
