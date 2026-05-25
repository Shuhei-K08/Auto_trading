/**
 * Risk Manager Module
 * リスク管理とリスク評価
 */

import logger from '../utils/logger.js';
import config from '../config.js';
import { RiskManagementError } from '../utils/errors.js';

class RiskManager {
  constructor(capitalManager) {
    this.capitalManager = capitalManager;
  }

  /**
   * 取引可能かどうかを判定
   */
  async canTrade(analysis, currentPositions = []) {
    try {
      // 信頼度チェック
      if (analysis.confidence < config.tradingRules.confidenceThreshold) {
        logger.info(
          `Low confidence (${(analysis.confidence * 100).toFixed(1)}% < ${(config.tradingRules.confidenceThreshold * 100).toFixed(1)}%)`
        );
        return false;
      }

      // ポジション数チェック
      if (currentPositions.length >= config.risk.maxPositions) {
        logger.info(
          `Max positions reached (${currentPositions.length} >= ${config.risk.maxPositions})`
        );
        return false;
      }

      // 資金チェック
      const availableCash = this.capitalManager.getAvailableCash();
      if (availableCash <= 0) {
        logger.warn('No available cash for trading');
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`Risk check failed: ${error.message}`);
      throw new RiskManagementError(`Risk check failed: ${error.message}`);
    }
  }

  /**
   * ポジションサイズのリスクを評価
   */
  evaluatePositionRisk(positionSize, entryPrice, stopLossPercent = null) {
    const stopLoss = stopLossPercent || config.tradingRules.stopLossPercent;
    const riskPerShare = entryPrice * stopLoss;
    const totalRisk = riskPerShare * positionSize;

    const maxRiskAmount = this.capitalManager.getTotalCapital() * config.risk.maxRiskPerTrade;

    return {
      positionSize,
      entryPrice,
      riskPerShare,
      totalRisk,
      maxAllowedRisk: maxRiskAmount,
      riskExceeds: totalRisk > maxRiskAmount,
      riskPercent: (totalRisk / this.capitalManager.getTotalCapital()) * 100,
    };
  }

  /**
   * 日次ドローダウンをチェック
   */
  async checkDailyDrawdown(dailyLoss) {
    const maxDailyLoss =
      this.capitalManager.getTotalCapital() * config.risk.maxDailyLossPercent;

    if (dailyLoss > maxDailyLoss) {
      logger.warn(`Daily loss limit exceeded: ¥${dailyLoss} > ¥${maxDailyLoss}`);
      return false;
    }

    return true;
  }

  /**
   * 信頼度に基づくリスク率を計算
   */
  calculateRiskFromConfidence(confidence) {
    // 信頼度が高いほどリスクを取る
    // confidence 0.5 = 0%, confidence 1.0 = 1.5%
    const baseRisk = config.risk.maxRiskPerTrade;
    const riskIncrease = (confidence - 0.5) * 3; // 0.5 ~ 1.5%

    return Math.min(riskIncrease, baseRisk);
  }

  /**
   * ポジション内の現在の PnL を計算
   */
  calculatePnL(entryPrice, currentPrice, quantity) {
    const priceDiff = currentPrice - entryPrice;
    const pnl = priceDiff * quantity;
    const pnlPercent = (priceDiff / entryPrice) * 100;

    return {
      pnl,
      pnlPercent,
      unrealizedGain: pnl > 0,
    };
  }

  /**
   * ストップロス価格を計算
   */
  calculateStopLoss(entryPrice, stopLossPercent = null) {
    const stopLossPercentage = stopLossPercent || config.tradingRules.stopLossPercent;
    return entryPrice * (1 - stopLossPercentage);
  }

  /**
   * テイクプロフィット価格を計算
   */
  calculateTakeProfit(entryPrice, takeProfitPercent = null) {
    const takeProfitPercentage = takeProfitPercent || config.tradingRules.takeProfitPercent;
    return entryPrice * (1 + takeProfitPercentage);
  }

  /**
   * ポジションが TP/SL に到達したかをチェック
   */
  checkTargets(position, currentPrice) {
    const { entryPrice, quantity } = position;
    const sl = this.calculateStopLoss(entryPrice);
    const tp = this.calculateTakeProfit(entryPrice);

    let signal = null;

    if (currentPrice <= sl) {
      signal = 'STOP_LOSS';
    } else if (currentPrice >= tp) {
      signal = 'TAKE_PROFIT';
    }

    return {
      stopLoss: sl,
      takeProfit: tp,
      signal,
      shouldClose: signal !== null,
    };
  }

  /**
   * ポジション集中度をチェック
   */
  checkConcentration(positions, newPosition = null) {
    const totalCapital = this.capitalManager.getTotalCapital();
    const allPositions = [...positions];

    if (newPosition) {
      allPositions.push(newPosition);
    }

    const concentration = allPositions.map((pos) => {
      const ratio = (pos.value / totalCapital) * 100;
      return {
        symbol: pos.symbol,
        value: pos.value,
        percent: ratio,
        exceeds: ratio > config.risk.maxPositionPercent * 100,
      };
    });

    return {
      positions: concentration,
      totalConcentration: (
        allPositions.reduce((sum, pos) => sum + pos.value, 0) / totalCapital
      ) * 100,
    };
  }

  /**
   * 相関性リスク（複数銘柄の相関性）を評価
   */
  evaluateCorrelationRisk(positions) {
    // 簡略版：同じセクターの銘柄を検出
    const sectors = {
      automotive: ['7203', '7261'],  // トヨタ、マツダ
      technology: ['6758', '9984'],  // ソニー、ソフトバンク
      semiconductor: ['8306'],       // 三菱電機
      materials: ['2802'],           // 味の素
    };

    const positionSymbols = positions.map((p) => p.symbol);
    let correlationRisk = false;

    for (const sector in sectors) {
      const sectorStocks = sectors[sector];
      const count = positionSymbols.filter((sym) => sectorStocks.includes(sym)).length;

      if (count > 1) {
        correlationRisk = true;
        logger.warn(`Correlation risk detected in ${sector}: ${count} positions`);
      }
    }

    return {
      hasCorrelationRisk: correlationRisk,
      recommendation: correlationRisk ? 'Consider reducing concentrated sector exposure' : 'OK',
    };
  }
}

export default RiskManager;
