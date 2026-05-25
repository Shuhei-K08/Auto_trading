/**
 * Technical Analyzer Module
 * テクニカル指標を計算して分析
 */

import logger from '../utils/logger.js';
import * as indicators from './indicators.js';
import config from '../config.js';
import { AnalysisError } from '../utils/errors.js';

class TechnicalAnalyzer {
  /**
   * 株価データを分析してテクニカル指標を計算
   */
  analyze(stockData) {
    try {
      if (!stockData || !stockData.historical || stockData.historical.length === 0) {
        throw new AnalysisError('Invalid stock data for analysis');
      }

      const prices = stockData.historical.map(d => d.close);
      const data = stockData.historical;
      const volumes = stockData.historical.map(d => d.volume || 0);

      // 移動平均線を計算
      const ma5 = indicators.calculateSMA(prices, config.constants.MA_FAST);
      const ma20 = indicators.calculateSMA(prices, config.constants.MA_MEDIUM);
      const ma60 = indicators.calculateSMA(prices, config.constants.MA_SLOW);

      // RSI を計算
      const rsi = indicators.calculateRSI(prices, config.constants.RSI_PERIOD);

      // MACD を計算
      const macd = indicators.calculateMACD(
        prices,
        config.constants.MACD_FAST,
        config.constants.MACD_SLOW,
        config.constants.MACD_SIGNAL
      );

      // ボリンジャーバンドを計算
      const bollingerBands = indicators.calculateBollingerBands(prices, 20, 2);

      // ATR を計算
      const atr = indicators.calculateATR(data, 14);

      // ストキャスティクスを計算
      const stochastic = indicators.calculateStochastic(data, 14, 3);

      // 出来高分析
      const volumeAvg = indicators.calculateVolumeAverage(volumes, 20);
      const currentVolume = volumes[volumes.length - 1];
      const volumeRatio = volumeAvg > 0 ? currentVolume / volumeAvg : 1;

      // OBV を計算
      const obv = indicators.calculateOBV(data);

      return {
        // 移動平均線
        ma5,
        ma20,
        ma60,

        // RSI
        rsi,

        // MACD
        macd: {
          line: macd?.line || 0,
          signal: macd?.signal || 0,
          histogram: macd?.histogram || 0,
        },

        // ボリンジャーバンド
        bollingerBands: {
          upper: bollingerBands?.upper || 0,
          middle: bollingerBands?.middle || 0,
          lower: bollingerBands?.lower || 0,
          stdDev: bollingerBands?.stdDev || 0,
        },

        // ATR
        atr,

        // ストキャスティクス
        stochastic: {
          k: stochastic?.k || 0,
          d: stochastic?.d || null,
        },

        // 出来高
        volumeAvg,
        currentVolume,
        volumeRatio,

        // OBV
        obv,

        // トレンド判定
        trend: this.determineTrend(ma5, ma20, ma60),
      };
    } catch (error) {
      logger.error(`Analysis error: ${error.message}`);
      throw new AnalysisError(`Failed to analyze stock data: ${error.message}`);
    }
  }

  /**
   * トレンド判定
   */
  determineTrend(ma5, ma20, ma60) {
    if (!ma5 || !ma20 || !ma60) {
      return 'UNKNOWN';
    }

    // 上昇トレンド
    if (ma5 > ma20 && ma20 > ma60) {
      return 'UPTREND';
    }

    // 下降トレンド
    if (ma5 < ma20 && ma20 < ma60) {
      return 'DOWNTREND';
    }

    // レンジ相場 / ニュートラル
    return 'NEUTRAL';
  }

  /**
   * 買いシグナルをチェック（複合判定）
   */
  checkBuySignals(indicators_data) {
    const signals = [];

    // MA5 > MA20 > MA60（上昇トレンド）
    if (
      indicators_data.ma5 > indicators_data.ma20 &&
      indicators_data.ma20 > indicators_data.ma60
    ) {
      signals.push('uptrend_confirmed');
    }

    // RSI < 70（買われすぎでない）
    if (indicators_data.rsi < 70) {
      signals.push('rsi_not_overbought');
    }

    // MACD が正（ポジティブ）
    if (indicators_data.macd.histogram > 0) {
      signals.push('macd_positive');
    }

    // 出来高が平均以上
    if (indicators_data.volumeRatio >= 0.9) {
      signals.push('volume_above_average');
    }

    return signals;
  }

  /**
   * 売りシグナルをチェック（複合判定）
   */
  checkSellSignals(indicators_data) {
    const signals = [];

    // MA5 < MA20 < MA60（下降トレンド）
    if (
      indicators_data.ma5 < indicators_data.ma20 &&
      indicators_data.ma20 < indicators_data.ma60
    ) {
      signals.push('downtrend_confirmed');
    }

    // RSI > 30（売られすぎでない）
    if (indicators_data.rsi > 30) {
      signals.push('rsi_not_oversold');
    }

    // MACD が負（ネガティブ）
    if (indicators_data.macd.histogram < 0) {
      signals.push('macd_negative');
    }

    // 出来高が平均以上
    if (indicators_data.volumeRatio >= 0.9) {
      signals.push('volume_above_average');
    }

    return signals;
  }

  /**
   * 指標の要約を生成
   */
  summarizeIndicators(indicators_data) {
    return {
      trend: indicators_data.trend,
      rsiStatus:
        indicators_data.rsi < 30
          ? 'oversold'
          : indicators_data.rsi > 70
            ? 'overbought'
            : 'neutral',
      macdTrend: indicators_data.macd.histogram > 0 ? 'bullish' : 'bearish',
      volumeTrend: indicators_data.volumeRatio > 1 ? 'above_average' : 'below_average',
      buySignals: this.checkBuySignals(indicators_data),
      sellSignals: this.checkSellSignals(indicators_data),
    };
  }
}

export default TechnicalAnalyzer;
