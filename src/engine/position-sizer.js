/**
 * Position Sizer Module
 * 取引量とポジションサイズを計算
 */

import logger from '../utils/logger.js';
import config from '../config.js';
import { PositionSizeError } from '../utils/errors.js';

class PositionSizer {
  constructor(capitalManager) {
    this.capitalManager = capitalManager;
  }

  /**
   * ポジションサイズを計算（信頼度とリスク率を考慮）
   */
  async calculate(currentPrice, confidence, date) {
    try {
      const availableCash = this.capitalManager.getAvailableCash();
      const totalCapital = this.capitalManager.getTotalCapital();

      // 利用可能額の計算
      const maxPositionAmount = totalCapital * config.risk.maxPositionPercent;
      const tradeAmount = Math.min(availableCash, maxPositionAmount);

      if (tradeAmount <= 0) {
        logger.warn('No funds available for position sizing');
        return { quantity: 0, amount: 0, riskPercent: 0 };
      }

      // 信頼度に基づくリスク率を計算
      // 信頼度 50% = 0%, 75% = 0.75%, 100% = 1.5%
      const confidenceAdjustment = Math.max(0, (confidence - 0.5) * 3);
      const riskPercent = Math.min(confidenceAdjustment, config.risk.maxRiskPerTrade);

      // 実際の投資額
      const investmentAmount = totalCapital * (riskPercent / 100);

      // ポジションマルチプライヤーの適用
      const adjustedAmount = investmentAmount * config.trading.positionMultiplier;

      // 株数の計算
      let quantity = Math.floor(adjustedAmount / currentPrice);

      // 最小注文単位の確認（日本株は通常100株単位）
      if (config.trading.mode === 'live') {
        // 本番モードは100株単位に切り上げ
        quantity = Math.ceil(quantity / 100) * 100;
      } else if (config.trading.mode === 'live_mini') {
        // ミニモードは1株単位
        quantity = Math.max(1, quantity);
      } else {
        // デモモードは小数点対応
        quantity = Math.max(1, quantity);
      }

      const actualAmount = quantity * currentPrice;

      logger.info(`Position size calculated:
        - Confidence: ${(confidence * 100).toFixed(1)}%
        - Risk %: ${riskPercent.toFixed(2)}%
        - Amount: ¥${actualAmount.toFixed(0)}
        - Quantity: ${quantity} shares
      `);

      return {
        quantity,
        amount: actualAmount,
        riskPercent,
        confidence,
      };
    } catch (error) {
      logger.error(`Position sizing error: ${error.message}`);
      throw new PositionSizeError(`Failed to calculate position size: ${error.message}`);
    }
  }

  /**
   * Kelly Criterion に基づくポジションサイズ（高度な計算）
   */
  calculateKellySize(winRate, avgWin, avgLoss) {
    // Kelly Criterion: f = (bp - q) / b
    // f: 最適ポジションサイズの割合
    // b: odds
    // p: win rate
    // q: loss rate = 1 - p

    if (winRate <= 0 || winRate >= 1 || avgWin <= 0 || avgLoss <= 0) {
      return 0.01; // デフォルト 1%
    }

    const ratio = avgWin / avgLoss;
    const p = winRate;
    const q = 1 - winRate;

    const f = (ratio * p - q) / ratio;

    // Kelly Criterion は 2 で割る（Fractional Kelly = Half Kelly）
    const fractionalKelly = f / 2;

    // クリップ（最小1%、最大20%）
    return Math.max(0.01, Math.min(fractionalKelly, 0.20));
  }

  /**
   * 固定分数法に基づくポジションサイズ
   */
  calculateFixedFraction(capital, riskPerTrade, accountRiskPercent = 2) {
    // accountRiskPercent: 口座全体のリスク比率（デフォルト 2%）
    const riskAmount = capital * (accountRiskPercent / 100);
    const positionSize = riskAmount / riskPerTrade;

    return {
      riskAmount,
      positionSize,
      percentOfAccount: (positionSize / capital) * 100,
    };
  }

  /**
   * ボラティリティを考慮したサイズ計算
   */
  calculateVolatilityAdjusted(confidence, volatility, baseRiskPercent = 0.02) {
    // ボラティリティが高いほどポジションを小さく
    const volatilityFactor = Math.max(0.5, 1 - volatility);
    const confidenceFactor = confidence;

    const adjustedRisk = baseRiskPercent * volatilityFactor * confidenceFactor;

    return {
      adjustedRisk,
      volatilityFactor,
      confidenceFactor,
    };
  }
}

export default PositionSizer;
