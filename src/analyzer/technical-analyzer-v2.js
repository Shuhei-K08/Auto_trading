/**
 * Technical Analyzer V2
 * 高度な指標を統合した拡張テクニカル分析エンジン
 */

import TechnicalAnalyzer from './technical-analyzer.js';
import {
  calculateBollingerBands,
  calculateStochastic,
  calculateIchimoku,
  calculateATRAdvanced,
  calculateADX,
} from './indicators-advanced.js';
import logger from '../utils/logger.js';

class TechnicalAnalyzerV2 extends TechnicalAnalyzer {
  /**
   * 高度なテクニカル分析を実行
   * @param {object} stockData DataFetcher から返されるデータ
   * @returns {object|null}
   */
  analyzeAdvanced(stockData) {
    try {
      if (!stockData || !stockData.historical || stockData.historical.length === 0) {
        logger.error('TechnicalAnalyzerV2: invalid stockData');
        return null;
      }

      const hist = stockData.historical;
      const prices = hist.map(d => d.close);
      const highLows = hist.map(d => ({ high: d.high, low: d.low }));
      const closePrices = prices;
      const dataWithClose = hist.map(d => ({ high: d.high, low: d.low, close: d.close }));

      // 基本指標（既存の analyze() を流用）
      const basic = this.analyze(stockData);

      // ─── 高度な指標を計算 ─────────────────────
      const bollinger = calculateBollingerBands(prices, 20);
      const stochastic = calculateStochastic(dataWithClose, 14, 3);
      const ichimoku = calculateIchimoku(dataWithClose, 9, 26, 52);
      const atr = calculateATRAdvanced(highLows, closePrices, 14);
      const adx = calculateADX(highLows, closePrices, 14);

      // ─── 指標の相互確認（convergence） ────────
      const convergence = this.checkConvergence({
        basic,
        bollinger,
        stochastic,
        ichimoku,
        adx,
        currentPrice: stockData.currentPrice,
      });

      // ─── テクニカルスコア（0〜100） ────────────
      const technicalScore = this.calculateTechnicalScore({
        basic,
        bollinger,
        stochastic,
        ichimoku,
        adx,
        currentPrice: stockData.currentPrice,
      });

      // ─── 総合シグナル ─────────────────────────
      const signal = this.deriveSignal(convergence, technicalScore);
      const confidence = this.deriveConfidence(convergence, technicalScore, adx);

      return {
        symbol: stockData.symbol,
        currentPrice: stockData.currentPrice,
        timestamp: new Date().toISOString(),

        // 基本指標
        basic: {
          ma5: basic.ma5,
          ma20: basic.ma20,
          ma60: basic.ma60,
          rsi: basic.rsi,
          macd: basic.macd,
          volumeRatio: basic.volumeRatio,
          trend: basic.trend,
        },

        // 高度な指標
        advanced: { bollinger, stochastic, ichimoku, atr, adx },

        // 相互確認結果
        convergence,

        // テクニカルスコア
        technicalScore,

        // 総合判定
        signal,
        confidence,
      };
    } catch (e) {
      logger.error(`TechnicalAnalyzerV2.analyzeAdvanced error: ${e.message}`);
      return null;
    }
  }

  /**
   * 複数指標の相互確認
   */
  checkConvergence({ basic, bollinger, stochastic, ichimoku, adx, currentPrice }) {
    const signals = [];

    // MA トレンド
    if (basic.trend === 'UPTREND') signals.push('bullish');
    else if (basic.trend === 'DOWNTREND') signals.push('bearish');
    else signals.push('neutral');

    // RSI
    if (basic.rsi < 70 && basic.rsi > 50) signals.push('bullish');
    else if (basic.rsi > 30 && basic.rsi < 50) signals.push('bearish');
    else if (basic.rsi >= 70) signals.push('bearish'); // 買われすぎ
    else if (basic.rsi <= 30) signals.push('bullish'); // 売られすぎ・反転
    else signals.push('neutral');

    // MACD
    if (basic.macd?.histogram > 0) signals.push('bullish');
    else if (basic.macd?.histogram < 0) signals.push('bearish');
    else signals.push('neutral');

    // ボリンジャーバンド
    if (bollinger) {
      if (bollinger.position === 'above' && bollinger.isWalking) signals.push('bullish');
      else if (bollinger.position === 'below') signals.push('bearish');
      else signals.push('neutral');
    } else signals.push('neutral');

    // ストキャスティクス
    if (stochastic) {
      if (stochastic.crossover === 'golden' || (stochastic.oversold && stochastic.k > 20)) signals.push('bullish');
      else if (stochastic.crossover === 'dead' || stochastic.overbought) signals.push('bearish');
      else signals.push('neutral');
    } else signals.push('neutral');

    // 一目均衡表
    if (ichimoku) {
      if (ichimoku.signal === 'strongBullish' || ichimoku.signal === 'bullish') signals.push('bullish');
      else if (ichimoku.signal === 'bearish') signals.push('bearish');
      else signals.push('neutral');
    } else signals.push('neutral');

    // ADX（トレンド強度）
    if (adx) {
      if (adx.trending && adx.diPlus > adx.diMinus) signals.push('bullish');
      else if (adx.trending && adx.diMinus > adx.diPlus) signals.push('bearish');
      else signals.push('neutral');
    } else signals.push('neutral');

    const bullishSignals = signals.filter(s => s === 'bullish').length;
    const bearishSignals = signals.filter(s => s === 'bearish').length;
    const neutralSignals = signals.filter(s => s === 'neutral').length;
    const totalSignals = signals.length;
    const convergenceRate = Math.max(bullishSignals, bearishSignals) / totalSignals;

    // ダイバージェンス（矛盾）の検出
    const divergences = [];
    if (stochastic?.divergence) divergences.push('Stochastic divergence detected (price new high but K not)');
    if (basic.rsi > 70 && basic.trend === 'UPTREND') divergences.push('RSI overbought in uptrend');
    if (basic.rsi < 30 && basic.trend === 'DOWNTREND') divergences.push('RSI oversold in downtrend');

    return {
      totalSignals,
      bullishSignals,
      bearishSignals,
      neutralSignals,
      convergenceRate,
      divergences,
    };
  }

  /**
   * テクニカルスコアを計算（0〜100点）
   * MA:25点 / RSI:15点 / MACD:15点 / 一目:15点 / ADX:10点 / BB:10点 / Stoch:10点
   */
  calculateTechnicalScore({ basic, bollinger, stochastic, ichimoku, adx, currentPrice }) {
    let score = 0;

    // MA（25点）
    if (basic.ma5 && basic.ma20 && basic.ma60) {
      if (basic.trend === 'UPTREND') score += 25;
      else if (basic.ma5 > basic.ma20) score += 12; // 部分点
    }

    // RSI（15点）
    if (basic.rsi != null) {
      if (basic.rsi > 50 && basic.rsi < 70) score += 15;  // 理想的な買い圏
      else if (basic.rsi > 40 && basic.rsi <= 50) score += 8;
      else if (basic.rsi < 30) score += 10; // 売られすぎ反転期待
    }

    // MACD（15点）
    if (basic.macd?.histogram > 0) score += 15;
    else if (basic.macd?.histogram > -0.5) score += 5;

    // 一目均衡表（15点）
    if (ichimoku) {
      if (ichimoku.signal === 'strongBullish') score += 15;
      else if (ichimoku.signal === 'bullish') score += 10;
      else if (ichimoku.signal === 'neutral') score += 5;
    }

    // ADX（10点）
    if (adx) {
      if (adx.adx > 30 && adx.diPlus > adx.diMinus) score += 10;
      else if (adx.adx > 20 && adx.diPlus > adx.diMinus) score += 6;
      else if (adx.trending) score += 3;
    }

    // ボリンジャーバンド（10点）
    if (bollinger) {
      if (bollinger.position === 'above' && bollinger.isWalking) score += 10;
      else if (bollinger.position === 'in' && bollinger.bandwidth > 2) score += 6;
      else if (bollinger.position === 'in') score += 3;
    }

    // ストキャスティクス（10点）
    if (stochastic) {
      if (stochastic.crossover === 'golden') score += 10;
      else if (!stochastic.overbought && stochastic.k > stochastic.d) score += 6;
      else if (!stochastic.overbought) score += 3;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * 総合シグナルを導出
   */
  deriveSignal(convergence, technicalScore) {
    const { bullishSignals, bearishSignals, totalSignals } = convergence;

    if (bullishSignals >= 5 && technicalScore >= 55) return 'BUY';
    if (bearishSignals >= 5 && technicalScore <= 40) return 'SELL';
    return 'HOLD';
  }

  /**
   * 信頼度を導出（0〜1）
   */
  deriveConfidence(convergence, technicalScore, adx) {
    let confidence = 0.5;

    // convergenceRate が高いほど信頼度UP
    confidence += (convergence.convergenceRate - 0.5) * 0.3;

    // テクニカルスコアの寄与
    confidence += (technicalScore - 50) / 200;

    // ADXが強いほどUP
    if (adx?.adx > 30) confidence += 0.05;
    else if (adx?.adx < 20) confidence -= 0.10;

    // ダイバージェンスがあれば信頼度DOWN
    confidence -= convergence.divergences.length * 0.05;

    return Math.min(1.0, Math.max(0.0, Math.round(confidence * 1000) / 1000));
  }
}

export default TechnicalAnalyzerV2;
