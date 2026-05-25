/**
 * Multi Position Manager
 * 複数ポジションの計画・最適化・売却判定
 */

import logger from '../utils/logger.js';

class MultiPositionManager {
  /**
   * ポジション計画を作成
   * @param {number} confidence 信頼度（0〜1）
   * @param {number} technicalScore テクニカルスコア（0〜100）
   * @param {string} symbol 銘柄コード
   * @returns {object}
   */
  createPositionPlan(confidence, technicalScore, symbol) {
    // スコアに応じて目標利益率を動的に調整
    const profitMultiplier = technicalScore >= 80 ? 1.2 : technicalScore >= 60 ? 1.0 : 0.8;

    return {
      symbol,
      shortTerm: {
        targetHoldDays: 2,
        targetProfitPercent: 2.5 * profitMultiplier,
        sizePercent: 0.30,
        probability: Math.min(0.90, confidence * 0.8),
      },
      mediumTerm: {
        targetHoldDays: 5,
        targetProfitPercent: 6.0 * profitMultiplier,
        sizePercent: 0.50,
        probability: Math.min(0.90, confidence * 0.9),
      },
      longTerm: {
        targetHoldDays: 10,
        targetProfitPercent: 10.0 * profitMultiplier,
        sizePercent: 0.20,
        probability: Math.min(0.95, confidence),
      },
    };
  }

  /**
   * 最適なポジション配置を計算
   * @param {Array} currentPositions 現在保有中のポジション
   * @param {object} newSignal 新規シグナル情報
   * @param {number} maxPositions 最大ポジション数
   * @returns {object}
   */
  optimizePositionAllocation(currentPositions, newSignal, maxPositions = 5) {
    const openCount = currentPositions.filter(p => p.status === 'open').length;

    if (openCount >= maxPositions) {
      logger.info(`[MultiPositionManager] MAX_POSITIONS (${maxPositions}) reached. Skip new position.`);
      return {
        canOpen: false,
        reason: `Max positions (${maxPositions}) reached`,
        currentCount: openCount,
        suggestion: 'Wait for existing positions to close',
      };
    }

    // 同一銘柄が既に保有されているか確認
    const sameSymbol = currentPositions.find(
      p => p.symbol === newSignal.symbol && p.status === 'open'
    );
    if (sameSymbol) {
      return {
        canOpen: false,
        reason: `Already holding ${newSignal.symbol}`,
        currentCount: openCount,
        suggestion: 'Wait for existing position to close',
      };
    }

    return {
      canOpen: true,
      reason: null,
      currentCount: openCount,
      remainingSlots: maxPositions - openCount,
    };
  }

  /**
   * ポジションの売却タイミングを判定
   * @param {object} position 保有ポジション
   * @param {object} market 現在の市場データ（currentPrice, indicators など）
   * @returns {object}
   */
  decideSellTiming(position, market) {
    const currentPrice = market.currentPrice ?? position.entryPrice;
    const holdDays = this.calcHoldDays(position.entryDate);
    const pnlPercent = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    const reasons = [];
    let shouldSell = false;

    // 目標利益に達したか
    if (position.targetProfitPercent && pnlPercent >= position.targetProfitPercent) {
      shouldSell = true;
      reasons.push(`Target profit reached (${pnlPercent.toFixed(2)}% >= ${position.targetProfitPercent}%)`);
    }

    // 保有日数の目標に達したか
    if (position.targetHoldDays && holdDays >= position.targetHoldDays) {
      shouldSell = true;
      reasons.push(`Hold period reached (${holdDays}d >= ${position.targetHoldDays}d)`);
    }

    // ストップロスに達したか
    if (position.stopLoss && currentPrice <= position.stopLoss) {
      shouldSell = true;
      reasons.push(`Stop loss triggered (¥${currentPrice} <= ¥${position.stopLoss})`);
    }

    // テクニカル悪化（トレンド転換）
    if (market.indicators?.trend === 'DOWNTREND' && position.category !== 'longTerm') {
      reasons.push('Technical deterioration: downtrend confirmed');
      if (pnlPercent > 0) shouldSell = true; // 利益があれば手仕舞い
    }

    return {
      shouldSell,
      reasons,
      pnlPercent: Math.round(pnlPercent * 100) / 100,
      holdDays,
      currentPrice,
    };
  }

  /** 保有日数を計算 */
  calcHoldDays(entryDate) {
    if (!entryDate) return 0;
    const entry = new Date(entryDate);
    const now = new Date();
    const diffMs = now - entry;
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}

export default MultiPositionManager;
