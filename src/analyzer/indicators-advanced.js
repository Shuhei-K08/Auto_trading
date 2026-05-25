/**
 * Advanced Technical Indicators Module
 * ボリンジャーバンド・ストキャスティクス・一目均衡表・ATR拡張・ADX
 */

import logger from '../utils/logger.js';

// ─────────────────────────────────────────────
// 1. ボリンジャーバンド
// ─────────────────────────────────────────────

/**
 * ボリンジャーバンドを計算
 * @param {number[]} prices 終値の配列
 * @param {number} period 期間（デフォルト20）
 * @returns {object|null}
 */
export function calculateBollingerBands(prices, period = 20) {
  try {
    if (!prices || prices.length < period) return null;

    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;
    const variance = recentPrices.reduce((sum, p) => sum + Math.pow(p - sma, 2), 0) / period;
    const stdDev = Math.sqrt(variance);

    const upperBand = sma + stdDev * 2;
    const lowerBand = sma - stdDev * 2;
    const bandwidth = ((upperBand - lowerBand) / sma) * 100;

    const currentPrice = prices[prices.length - 1];
    let position;
    if (currentPrice > upperBand) position = 'above';
    else if (currentPrice < lowerBand) position = 'below';
    else position = 'in';

    // バンドウォーク判定（直近3日間連続でバンド外にいるか）
    const last3 = prices.slice(-3);
    const isWalking =
      last3.length === 3 &&
      (last3.every(p => p > upperBand) || last3.every(p => p < lowerBand));

    if ([sma, stdDev, upperBand, lowerBand].some(v => isNaN(v))) {
      logger.error('BollingerBands: NaN detected');
      return null;
    }

    return { sma, stdDev, upperBand, lowerBand, bandwidth, position, currentPrice, isWalking };
  } catch (e) {
    logger.error(`calculateBollingerBands error: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// 2. ストキャスティクス
// ─────────────────────────────────────────────

/**
 * ストキャスティクスを計算
 * @param {Array<{high:number, low:number, close:number}>} data
 * @param {number} period K期間（デフォルト14）
 * @param {number} dPeriod D期間（デフォルト3）
 * @returns {object|null}
 */
export function calculateStochastic(data, period = 14, dPeriod = 3) {
  try {
    if (!data || data.length < period + dPeriod) return null;

    // 複数のK値を計算してD値（SMA）を求める
    const kValues = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const highestHigh = Math.max(...slice.map(d => d.high));
      const lowestLow = Math.min(...slice.map(d => d.low));
      const close = data[i].close;
      const k = highestHigh === lowestLow
        ? 50
        : ((close - lowestLow) / (highestHigh - lowestLow)) * 100;
      kValues.push(k);
    }

    const k = kValues[kValues.length - 1];
    const previousK = kValues[kValues.length - 2] ?? k;
    const dSlice = kValues.slice(-dPeriod);
    const d = dSlice.reduce((a, b) => a + b, 0) / dSlice.length;

    const previousD = kValues.length >= dPeriod + 1
      ? kValues.slice(-dPeriod - 1, -1).reduce((a, b) => a + b, 0) / dPeriod
      : d;

    // クロス判定
    let crossover = 'none';
    if (previousK < previousD && k >= d) crossover = 'golden';
    else if (previousK > previousD && k <= d) crossover = 'dead';

    const overbought = k > 80;
    const oversold = k < 20;

    // ダイバージェンス判定（価格は新高値だがKは前回高値未更新）
    const recentHighPrice = Math.max(...data.slice(-5).map(d => d.high));
    const prevHighPrice = Math.max(...data.slice(-10, -5).map(d => d.high));
    const divergence = recentHighPrice > prevHighPrice && k < previousK;

    return { k, d, previousK, previousD, overbought, oversold, crossover, divergence };
  } catch (e) {
    logger.error(`calculateStochastic error: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// 3. 一目均衡表
// ─────────────────────────────────────────────

/**
 * 一目均衡表を計算
 * @param {Array<{high:number, low:number, close:number}>} data
 * @param {number} p1 転換線期間（デフォルト9）
 * @param {number} p2 基準線期間（デフォルト26）
 * @param {number} p3 先行スパンB期間（デフォルト52）
 * @returns {object|null}
 */
export function calculateIchimoku(data, p1 = 9, p2 = 26, p3 = 52) {
  try {
    if (!data || data.length < p3) return null;

    const periodHigh = (d, n) => Math.max(...d.slice(-n).map(x => x.high));
    const periodLow = (d, n) => Math.min(...d.slice(-n).map(x => x.low));

    const conversionLine = (periodHigh(data, p1) + periodLow(data, p1)) / 2;
    const baseLine = (periodHigh(data, p2) + periodLow(data, p2)) / 2;
    const leadingSpanA = (conversionLine + baseLine) / 2;
    const leadingSpanB = (periodHigh(data, p3) + periodLow(data, p3)) / 2;

    const cloudTop = Math.max(leadingSpanA, leadingSpanB);
    const cloudBottom = Math.min(leadingSpanA, leadingSpanB);

    const currentPrice = data[data.length - 1].close;
    const inCloud = currentPrice >= cloudBottom && currentPrice <= cloudTop;

    let signal;
    if (currentPrice > cloudTop && conversionLine > baseLine) signal = 'strongBullish';
    else if (currentPrice > cloudTop) signal = 'bullish';
    else if (inCloud) signal = 'neutral';
    else signal = 'bearish';

    return {
      conversionLine,
      baseLine,
      leadingSpanA,
      leadingSpanB,
      cloudTop,
      cloudBottom,
      currentPrice,
      signal,
      inCloud,
    };
  } catch (e) {
    logger.error(`calculateIchimoku error: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// 4. ATR（拡張版）
// ─────────────────────────────────────────────

/**
 * ATR（Average True Range）拡張版を計算
 * @param {Array<{high:number, low:number}>} highLows
 * @param {number[]} closePrices
 * @param {number} period 期間（デフォルト14）
 * @returns {object|null}
 */
export function calculateATRAdvanced(highLows, closePrices, period = 14) {
  try {
    if (!highLows || !closePrices || highLows.length < period + 1) return null;

    const trValues = [];
    for (let i = 1; i < highLows.length; i++) {
      const high = highLows[i].high;
      const low = highLows[i].low;
      const prevClose = closePrices[i - 1];
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trValues.push(tr);
    }

    const recentTR = trValues.slice(-period);
    const atr = recentTR.reduce((a, b) => a + b, 0) / period;
    const trueRange = trValues[trValues.length - 1];
    const currentPrice = closePrices[closePrices.length - 1];

    // ボラティリティレベル
    let volatilityLevel;
    if (atr > currentPrice * 0.05) volatilityLevel = 'high';
    else if (atr > currentPrice * 0.02) volatilityLevel = 'medium';
    else volatilityLevel = 'low';

    return {
      atr,
      trueRange,
      volatilityLevel,
      dynamicStopLoss: (entryPrice) => entryPrice - atr * 2,
      dynamicTakeProfit: (entryPrice) => entryPrice + atr * 3,
    };
  } catch (e) {
    logger.error(`calculateATRAdvanced error: ${e.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────
// 5. ADX（Average Directional Index）
// ─────────────────────────────────────────────

/**
 * ADXを計算
 * @param {Array<{high:number, low:number}>} highLows
 * @param {number[]} closePrices
 * @param {number} period 期間（デフォルト14）
 * @returns {object|null}
 */
export function calculateADX(highLows, closePrices, period = 14) {
  try {
    if (!highLows || !closePrices || highLows.length < period * 2) return null;

    const dmPlus = [];
    const dmMinus = [];
    const trValues = [];

    for (let i = 1; i < highLows.length; i++) {
      const currHigh = highLows[i].high;
      const currLow = highLows[i].low;
      const prevHigh = highLows[i - 1].high;
      const prevLow = highLows[i - 1].low;
      const prevClose = closePrices[i - 1];

      const upMove = currHigh - prevHigh;
      const downMove = prevLow - currLow;

      dmPlus.push(upMove > downMove && upMove > 0 ? upMove : 0);
      dmMinus.push(downMove > upMove && downMove > 0 ? downMove : 0);

      const tr = Math.max(
        currHigh - currLow,
        Math.abs(currHigh - prevClose),
        Math.abs(currLow - prevClose)
      );
      trValues.push(tr);
    }

    // Wilder's smoothing
    const smooth = (arr) => {
      let val = arr.slice(0, period).reduce((a, b) => a + b, 0);
      const result = [val];
      for (let i = period; i < arr.length; i++) {
        val = val - val / period + arr[i];
        result.push(val);
      }
      return result;
    };

    const smoothTR = smooth(trValues);
    const smoothDMPlus = smooth(dmPlus);
    const smoothDMMinus = smooth(dmMinus);

    const dxValues = [];
    for (let i = 0; i < smoothTR.length; i++) {
      if (smoothTR[i] === 0) { dxValues.push(0); continue; }
      const diPlus = (smoothDMPlus[i] / smoothTR[i]) * 100;
      const diMinus = (smoothDMMinus[i] / smoothTR[i]) * 100;
      const diSum = diPlus + diMinus;
      const dx = diSum === 0 ? 0 : (Math.abs(diPlus - diMinus) / diSum) * 100;
      dxValues.push(dx);
    }

    const recentDX = dxValues.slice(-period);
    const adx = recentDX.reduce((a, b) => a + b, 0) / period;

    // 最後のDI値
    const lastIdx = smoothTR.length - 1;
    const diPlus = smoothTR[lastIdx] === 0 ? 0 : (smoothDMPlus[lastIdx] / smoothTR[lastIdx]) * 100;
    const diMinus = smoothTR[lastIdx] === 0 ? 0 : (smoothDMMinus[lastIdx] / smoothTR[lastIdx]) * 100;

    let trendStrength;
    if (adx > 25) trendStrength = 'strong';
    else if (adx >= 20) trendStrength = 'moderate';
    else trendStrength = 'weak';

    return {
      adx,
      diPlus,
      diMinus,
      trendStrength,
      trending: adx > 25,
    };
  } catch (e) {
    logger.error(`calculateADX error: ${e.message}`);
    return null;
  }
}

export default {
  calculateBollingerBands,
  calculateStochastic,
  calculateIchimoku,
  calculateATRAdvanced,
  calculateADX,
};
