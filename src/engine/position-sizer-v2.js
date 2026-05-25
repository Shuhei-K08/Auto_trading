/**
 * Position Sizer V2
 * 信頼度 × ADX × 連敗数 の多要因ポジションサイズ計算
 * + 目標買付比率（TARGET_ALLOCATION_PERCENT）による最低株数保証
 */

import logger from '../utils/logger.js';
import { PositionSizeError } from '../utils/errors.js';
import config from '../config.js';

class PositionSizerV2 {
  constructor(capitalManager) {
    this.capitalManager = capitalManager;
  }

  /**
   * 最適ポジションサイズを計算
   * @param {string} symbol 銘柄コード
   * @param {number} entryPrice エントリー価格
   * @param {number} confidence 信頼度（0〜1）
   * @param {object} advancedTechnical analyzeAdvanced() の結果
   * @param {Array}  recentTrades 直近の取引履歴
   * @returns {object}
   */
  async calculateOptimizedSize(symbol, entryPrice, confidence, advancedTechnical, recentTrades = []) {
    try {
      // Step 1: 信頼度からベースリスク率
      const baseRiskPercent = this.getBaseRiskPercent(confidence);
      if (baseRiskPercent === 0) {
        logger.info(`[PositionSizerV2] Confidence ${(confidence * 100).toFixed(1)}% < 60% → skip trade`);
        return this.zeroPosition('Confidence below threshold (60%)');
      }

      // Step 2: ADX からテクニカル乗数
      const adxValue = advancedTechnical?.advanced?.adx?.adx ?? 22;
      const technicalMultiplier = this.calculateTechnicalMultiplier(adxValue);

      // Step 3: 連敗数から調整乗数
      const consecutiveLosses = this.countConsecutiveLosses(recentTrades);
      const consecutiveLossesMultiplier = this.getConsecutiveLossesMultiplier(consecutiveLosses);

      // Step 4: 資金を取得（getTotalCapital は同期メソッド）
      const currentCapital = this.capitalManager.getTotalCapital();

      // Step 5: 最終リスク率・株数計算
      const finalRiskPercent = baseRiskPercent * technicalMultiplier * consecutiveLossesMultiplier;
      const riskAmount = currentCapital * finalRiskPercent;

      // ATR ベースの SL/TP
      const atrVal = advancedTechnical?.advanced?.atr?.atr ?? entryPrice * 0.03;
      const stopLoss = entryPrice - atrVal * 2;
      const takeProfit = entryPrice + atrVal * 3;
      const riskPerShare = entryPrice - stopLoss;
      const riskRewardRatio = riskPerShare > 0 ? (takeProfit - entryPrice) / riskPerShare : 0;

      // 株数計算
      let quantity = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;

      // MAX_POSITION_PERCENT（20%）上限チェック
      const maxPositionValue = currentCapital * (config.risk?.maxPositionPercent ?? 0.20);
      if (quantity * entryPrice > maxPositionValue) {
        quantity = Math.floor(maxPositionValue / entryPrice);
      }

      // ── 目標買付比率による最低株数保証 ──────────────────────────
      // TARGET_ALLOCATION_PERCENT を maxPositions で割った分を1ポジションの目標金額とする
      // 例: targetAllocation=0.70, maxPositions=5 → 1ポジション = 14% = ¥140,000
      const targetAllocation = config.risk?.targetAllocationPercent ?? 0.70;
      const maxPos = config.risk?.maxPositions ?? 5;
      const targetPositionValue = currentCapital * (targetAllocation / maxPos);
      const targetQuantity = Math.floor(targetPositionValue / entryPrice / 100) * 100; // 100株単位

      // リスクベースの株数 vs 目標配分ベースの株数 → 大きい方を採用
      if (targetQuantity > quantity && targetQuantity * entryPrice <= maxPositionValue) {
        logger.info(
          `[PositionSizerV2] 目標配分 ${(targetAllocation * 100).toFixed(0)}% → ` +
          `1ポジション目標¥${Math.round(targetPositionValue).toLocaleString()} ` +
          `(${targetQuantity}株) ※リスクベース(${quantity}株)より大きいため採用`
        );
        quantity = targetQuantity;
      }
      // ────────────────────────────────────────────────────────────

      // 売買単位（通常=100株, 単元未満株モード=1株）
      const LOT = config.trading?.tradeLotSize ?? 100;
      if (LOT === 1) {
        // 1株モード: 目標金額内で何株買えるか
        quantity = Math.floor(targetPositionValue / entryPrice);
        if (quantity < 1) quantity = (entryPrice <= maxPositionValue ? 1 : 0);
        logger.info(`[PositionSizerV2] 1株モード: ${quantity}株 × ¥${entryPrice} = ¥${(quantity * entryPrice).toLocaleString()}`);
      } else {
        quantity = Math.floor(quantity / LOT) * LOT; // LOT単位に切り捨て
        if (quantity < LOT) {
          // リスク計算では足りないが、最低1単元なら資金的に許容できるか確認
          if (entryPrice * LOT <= maxPositionValue) {
            quantity = LOT;
            logger.info(`[PositionSizerV2] 最低1単元(${LOT}株)に切り上げ`);
          } else {
            quantity = 0; // 1単元も買えない
          }
        }
      }
      quantity = Math.max(0, quantity);

      const positionValue = quantity * entryPrice;

      // Step 6: 複数ポジション計画
      const multiPosition = this.buildMultiPositionPlan(quantity);

      const explanation = {
        baseRisk: `Confidence ${(confidence * 100).toFixed(1)}% → ${(baseRiskPercent * 100).toFixed(2)}% base risk`,
        technical: `ADX ${adxValue.toFixed(1)} → ×${technicalMultiplier} multiplier`,
        losses: `${consecutiveLosses} consecutive losses → ×${consecutiveLossesMultiplier} multiplier`,
        final: `${(baseRiskPercent * 100).toFixed(2)}% × ${technicalMultiplier} × ${consecutiveLossesMultiplier} = ${(finalRiskPercent * 100).toFixed(3)}% final risk`,
      };

      logger.info(`[PositionSizerV2] ${symbol}: qty=${quantity}, risk=${(finalRiskPercent * 100).toFixed(2)}%, SL=¥${stopLoss.toFixed(0)}, TP=¥${takeProfit.toFixed(0)}`);

      return {
        quantity,
        riskAmount: Math.round(riskAmount),
        positionValue: Math.round(positionValue),
        baseRiskPercent,
        technicalMultiplier,
        consecutiveLossesMultiplier,
        finalRiskPercent,
        stopLoss: Math.round(stopLoss),
        takeProfit: Math.round(takeProfit),
        riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
        multiPosition,
        explanation,
      };
    } catch (error) {
      logger.error(`[PositionSizerV2] Error: ${error.message}`);
      throw new PositionSizeError(`Failed to calculate optimized size: ${error.message}`);
    }
  }

  /** 信頼度 → ベースリスク率（閾値を60%に引き下げ） */
  getBaseRiskPercent(confidence) {
    if (confidence >= 0.85) return 0.020;
    if (confidence >= 0.80) return 0.015;
    if (confidence >= 0.75) return 0.012;
    if (confidence >= 0.70) return 0.008;
    if (confidence >= 0.65) return 0.005;
    if (confidence >= 0.60) return 0.003;
    return 0;
  }

  /** ADX → テクニカル乗数 */
  calculateTechnicalMultiplier(adx) {
    if (adx > 30) return 1.2;
    if (adx >= 25) return 1.0;
    if (adx >= 20) return 0.8;
    return 0.5;
  }

  /** 直近取引の連敗数をカウント */
  countConsecutiveLosses(trades) {
    if (!trades || trades.length === 0) return 0;
    let count = 0;
    for (let i = trades.length - 1; i >= 0; i--) {
      if ((trades[i].pnl ?? 0) < 0) count++;
      else break;
    }
    return count;
  }

  /** 連敗数 → 乗数 */
  getConsecutiveLossesMultiplier(count) {
    const map = { 0: 1.0, 1: 1.0, 2: 0.7, 3: 0.5, 4: 0.3 };
    return map[Math.min(count, 4)];
  }

  /** 複数ポジション計画（短期30%・中期50%・長期20%） */
  buildMultiPositionPlan(totalQuantity) {
    return {
      shortTerm: {
        quantity: Math.floor(totalQuantity * 0.30),
        targetDays: 2,
        targetProfitPercent: 2.5,
      },
      mediumTerm: {
        quantity: Math.floor(totalQuantity * 0.50),
        targetDays: 5,
        targetProfitPercent: 6.0,
      },
      longTerm: {
        quantity: totalQuantity - Math.floor(totalQuantity * 0.30) - Math.floor(totalQuantity * 0.50),
        targetDays: 10,
        targetProfitPercent: 10.0,
      },
    };
  }

  /** ゼロポジション結果 */
  zeroPosition(reason) {
    return {
      quantity: 0,
      riskAmount: 0,
      positionValue: 0,
      baseRiskPercent: 0,
      technicalMultiplier: 1,
      consecutiveLossesMultiplier: 1,
      finalRiskPercent: 0,
      stopLoss: 0,
      takeProfit: 0,
      riskRewardRatio: 0,
      multiPosition: { shortTerm: { quantity: 0, targetDays: 2, targetProfitPercent: 2.5 }, mediumTerm: { quantity: 0, targetDays: 5, targetProfitPercent: 6.0 }, longTerm: { quantity: 0, targetDays: 10, targetProfitPercent: 10.0 } },
      explanation: { baseRisk: reason, technical: '', losses: '', final: reason },
    };
  }
}

export default PositionSizerV2;
