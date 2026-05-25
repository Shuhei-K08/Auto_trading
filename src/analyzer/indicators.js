/**
 * Technical Indicators Module
 * MA, RSI, MACD などのテクニカル指標計算
 */

/**
 * 単純移動平均（SMA）を計算
 */
export function calculateSMA(prices, period) {
  if (prices.length < period) {
    return null;
  }
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

/**
 * 指数加重移動平均（EMA）を計算
 */
export function calculateEMA(prices, period) {
  if (prices.length < period) {
    return null;
  }

  const k = 2 / (period + 1);
  let ema = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return ema;
}

/**
 * RSI（Relative Strength Index）を計算
 */
export function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) {
    return null;
  }

  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) {
      gains += changes[i];
    } else {
      losses -= changes[i];
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period; i < changes.length; i++) {
    if (changes[i] > 0) {
      avgGain = (avgGain * (period - 1) + changes[i]) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - changes[i]) / period;
    }
  }

  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

/**
 * MACD（Moving Average Convergence Divergence）を計算
 */
export function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod) {
    return null;
  }

  const emaFast = calculateEMA(prices, fastPeriod);
  const emaSlow = calculateEMA(prices, slowPeriod);

  if (!emaFast || !emaSlow) {
    return null;
  }

  const macdLine = emaFast - emaSlow;

  // Signal line を計算するため、過去のすべての MACD value が必要
  // 簡略版：最新のMACD valueのみ使用
  const signalLine = calculateEMA([macdLine], signalPeriod) || macdLine;
  const histogram = macdLine - signalLine;

  return {
    line: macdLine,
    signal: signalLine,
    histogram: histogram,
  };
}

/**
 * ボリンジャーバンドを計算
 */
export function calculateBollingerBands(prices, period = 20, stdDevs = 2) {
  if (prices.length < period) {
    return null;
  }

  const recentPrices = prices.slice(-period);
  const sma = calculateSMA(prices, period);

  // 標準偏差を計算
  const squaredDiffs = recentPrices.map(price => Math.pow(price - sma, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const stdDev = Math.sqrt(avgSquaredDiff);

  return {
    middle: sma,
    upper: sma + stdDev * stdDevs,
    lower: sma - stdDev * stdDevs,
    stdDev: stdDev,
  };
}

/**
 * ATR（Average True Range）を計算
 */
export function calculateATR(data, period = 14) {
  if (data.length < period + 1) {
    return null;
  }

  const trValues = [];

  for (let i = 1; i < data.length; i++) {
    const currentHigh = data[i].high;
    const currentLow = data[i].low;
    const previousClose = data[i - 1].close;

    const tr = Math.max(
      currentHigh - currentLow,
      Math.abs(currentHigh - previousClose),
      Math.abs(currentLow - previousClose)
    );

    trValues.push(tr);
  }

  const atr = calculateSMA(trValues, period);
  return atr;
}

/**
 * ストキャスティクスを計算
 */
export function calculateStochastic(data, kPeriod = 14, dPeriod = 3) {
  if (data.length < kPeriod) {
    return null;
  }

  const recentData = data.slice(-kPeriod);
  const highestHigh = Math.max(...recentData.map(d => d.high));
  const lowestLow = Math.min(...recentData.map(d => d.low));
  const close = data[data.length - 1].close;

  const kValue =
    highestHigh === lowestLow
      ? 50
      : ((close - lowestLow) / (highestHigh - lowestLow)) * 100;

  // D値（KのSMA）の計算には複数の K値が必要なため、簡略版では K値のみを返す
  return {
    k: kValue,
    d: null, // 複数フレームのデータが必要
  };
}

/**
 * 出来高の移動平均を計算
 */
export function calculateVolumeAverage(volumes, period = 20) {
  if (volumes.length < period) {
    return calculateSMA(volumes, Math.min(period, volumes.length));
  }
  return calculateSMA(volumes, period);
}

/**
 * OBV（On Balance Volume）を計算
 */
export function calculateOBV(data) {
  if (data.length === 0) {
    return null;
  }

  let obv = 0;
  const obvValues = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      obv = data[i].volume;
    } else {
      if (data[i].close > data[i - 1].close) {
        obv += data[i].volume;
      } else if (data[i].close < data[i - 1].close) {
        obv -= data[i].volume;
      }
      // close が同じ場合は変更なし
    }
    obvValues.push(obv);
  }

  return obvValues[obvValues.length - 1];
}

export default {
  calculateSMA,
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateStochastic,
  calculateVolumeAverage,
  calculateOBV,
};
