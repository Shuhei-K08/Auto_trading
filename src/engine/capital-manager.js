/**
 * Capital Manager Module
 * 軍資金と資産を動的に管理
 */

import logger from '../utils/logger.js';
import TradeRepository from '../database/trade-repository.js';
import config from '../config.js';

class CapitalManager {
  constructor() {
    this.repository = new TradeRepository();
    this.currentPortfolio = null;
  }

  /**
   * ポートフォリオ情報を初期化・更新
   */
  async initializePortfolio() {
    try {
      // DB から最新のポートフォリオ情報を取得
      const existing = await this.repository.getLatestPortfolio();

      if (existing) {
        // DB は snake_case で返すので camelCase に正規化する
        this.currentPortfolio = this.normalizeRow(existing);
        logger.info(`Portfolio loaded from DB: ¥${this.currentPortfolio.currentCapital}`);
      } else {
        // 初回時は .env から初期値を読み込む
        const initialCapital = config.trading.portfolioValue;

        this.currentPortfolio = {
          date: new Date().toISOString().split('T')[0],
          initialCapital,
          currentCapital: initialCapital,
          availableCash: initialCapital,
          investedStocks: 0,
          deposits: 0,
          withdrawals: 0,
          totalGains: 0,
          monthlyGains: 0,
          pendingDeposits: 0,
          pendingPurchases: 0,
        };

        await this.updatePortfolio(this.currentPortfolio);
        logger.info(`Portfolio initialized: ¥${initialCapital}`);
      }

      return this.currentPortfolio;
    } catch (error) {
      logger.error(`Failed to initialize portfolio: ${error.message}`);
      throw error;
    }
  }

  /**
   * ポートフォリオを更新
   */
  async updatePortfolio(portfolioData) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const updated = {
        ...portfolioData,
        date: today,
      };

      await this.repository.updatePortfolio(updated);
      this.currentPortfolio = updated;

      logger.debug(`Portfolio updated: ¥${updated.currentCapital}`);
      return updated;
    } catch (error) {
      logger.error(`Failed to update portfolio: ${error.message}`);
      throw error;
    }
  }

  /**
   * 利益を再投資（後方互換用 — 既存呼び出し向け）
   * 純粋利益のみを加える（損失なら何もしない）
   */
  async reinvestGains(gains) {
    try {
      if (gains <= 0) return;

      const portfolio = this.currentPortfolio;
      portfolio.availableCash += gains;
      portfolio.currentCapital += gains;
      portfolio.totalGains += gains;

      await this.updatePortfolio(portfolio);
      logger.info(`Gains reinvested: ¥${gains}`);
    } catch (error) {
      logger.error(`Failed to reinvest gains: ${error.message}`);
      throw error;
    }
  }

  /**
   * BUY 約定時の資金処理
   *   availableCash -= cost
   *   investedStocks += cost
   *   currentCapital は不変（株式評価額として保持）
   */
  async recordBuy(cost) {
    try {
      if (!this.currentPortfolio) await this.initializePortfolio();
      const portfolio = this.currentPortfolio;
      portfolio.availableCash  = Math.max(0, (portfolio.availableCash  ?? 0) - cost);
      portfolio.investedStocks = (portfolio.investedStocks ?? 0) + cost;
      await this.updatePortfolio(portfolio);
      logger.info(`Buy recorded: -¥${Math.round(cost)} (available: ¥${Math.round(portfolio.availableCash)})`);
    } catch (e) {
      logger.error(`Failed to record buy: ${e.message}`);
      throw e;
    }
  }

  /**
   * SELL 約定時の資金処理
   *   availableCash  += proceeds  (売却で戻る現金)
   *   investedStocks -= originalCost (取得額分の投資を解除)
   *   totalGains     += pnl (純損益)
   *   currentCapital += pnl (損益反映)
   */
  async recordSell(proceeds, originalCost) {
    try {
      if (!this.currentPortfolio) await this.initializePortfolio();
      const portfolio = this.currentPortfolio;
      const pnl = proceeds - originalCost;

      portfolio.availableCash  = (portfolio.availableCash  ?? 0) + proceeds;
      portfolio.investedStocks = Math.max(0, (portfolio.investedStocks ?? 0) - originalCost);
      portfolio.totalGains     = (portfolio.totalGains     ?? 0) + pnl;
      portfolio.currentCapital = (portfolio.currentCapital ?? 0) + pnl;

      await this.updatePortfolio(portfolio);
      logger.info(
        `Sell recorded: +¥${Math.round(proceeds)} (PnL ${pnl >= 0 ? '+' : ''}¥${Math.round(pnl)} | available: ¥${Math.round(portfolio.availableCash)})`
      );
      return pnl;
    } catch (e) {
      logger.error(`Failed to record sell: ${e.message}`);
      throw e;
    }
  }

  /**
   * 出金を処理
   */
  async withdrawCash(amount, reason = '') {
    try {
      const portfolio = this.currentPortfolio;

      if (amount > portfolio.availableCash) {
        throw new Error(
          `Insufficient cash: requested ¥${amount}, available ¥${portfolio.availableCash}`
        );
      }

      portfolio.availableCash -= amount;
      portfolio.currentCapital -= amount;
      portfolio.withdrawals += amount;

      await this.updatePortfolio(portfolio);
      logger.info(`Cash withdrawn: ¥${amount} (${reason})`);

      return portfolio;
    } catch (error) {
      logger.error(`Failed to withdraw cash: ${error.message}`);
      throw error;
    }
  }

  /**
   * 入金を処理
   */
  async depositCash(amount, reason = '') {
    try {
      const portfolio = this.currentPortfolio;

      portfolio.availableCash += amount;
      portfolio.currentCapital += amount;
      portfolio.deposits += amount;

      await this.updatePortfolio(portfolio);
      logger.info(`Cash deposited: ¥${amount} (${reason})`);

      return portfolio;
    } catch (error) {
      logger.error(`Failed to deposit cash: ${error.message}`);
      throw error;
    }
  }

  /**
   * 利用可能な資金を取得
   */
  getAvailableCash() {
    const p = this.currentPortfolio;
    // camelCase / snake_case の両方に対応
    return p?.availableCash ?? p?.available_cash ?? 0;
  }

  /**
   * 現在の総資産を取得
   */
  getTotalCapital() {
    const p = this.currentPortfolio;
    return p?.currentCapital ?? p?.current_capital ?? 0;
  }

  /**
   * DB の snake_case 行を camelCase に正規化
   */
  normalizeRow(row) {
    return {
      date:             row.date,
      initialCapital:   row.initialCapital   ?? row.initial_capital   ?? 0,
      currentCapital:   row.currentCapital   ?? row.current_capital   ?? 0,
      availableCash:    row.availableCash    ?? row.available_cash    ?? 0,
      investedStocks:   row.investedStocks   ?? row.invested_stocks   ?? 0,
      deposits:         row.deposits         ?? 0,
      withdrawals:      row.withdrawals      ?? 0,
      totalGains:       row.totalGains       ?? row.total_gains       ?? 0,
      monthlyGains:     row.monthlyGains     ?? row.monthly_gains     ?? 0,
      pendingDeposits:  row.pendingDeposits  ?? row.pending_deposits  ?? 0,
      pendingPurchases: row.pendingPurchases ?? row.pending_purchases ?? 0,
    };
  }

  /**
   * ポジション投資額を更新
   */
  updateInvestedStocks(amount) {
    if (this.currentPortfolio) {
      this.currentPortfolio.investedStocks = amount;
    }
  }

  /**
   * 取引に使用可能な最大額を計算
   */
  getMaxTradeAmount() {
    const available = this.getAvailableCash();
    const maxPercent = config.risk.maxPositionPercent;
    const maxAmount = this.getTotalCapital() * maxPercent;

    return Math.min(available, maxAmount);
  }

  /**
   * 税金を計算して天引き
   */
  calculateAndDeductTaxes(gains) {
    const tax = gains * config.constants.TAX_RATE;
    return {
      beforeTax: gains,
      tax,
      afterTax: gains - tax,
    };
  }

  /**
   * ポートフォリオ情報を取得
   */
  getPortfolio() {
    return this.currentPortfolio;
  }

  /**
   * ポートフォリオ統計を計算
   */
  getStats() {
    const portfolio = this.currentPortfolio;

    if (!portfolio) {
      return null;
    }

    const totalGains = portfolio.totalGains;
    const initialCapital = portfolio.initialCapital;
    const returnPercent = (totalGains / initialCapital) * 100;

    return {
      totalCapital: portfolio.currentCapital,
      availableCash: portfolio.availableCash,
      investedStocks: portfolio.investedStocks,
      totalGains,
      returnPercent,
      deposits: portfolio.deposits,
      withdrawals: portfolio.withdrawals,
    };
  }
}

export default CapitalManager;
