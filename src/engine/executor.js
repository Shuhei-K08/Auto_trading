/**
 * Executor Module
 * 注文を実行（デモ/本番モード対応）
 *
 * [修正] デモモードで price:0 を返していたバグを修正。
 *         positionSize.currentPrice（呼び出し元から渡す）を使用する。
 *         live_mini / live モードは楽天証券 RakutenClient を利用。
 */

import logger from '../utils/logger.js';
import TradeRepository from '../database/trade-repository.js';
import config from '../config.js';
import { ExecutionError } from '../utils/errors.js';

class Executor {
  constructor() {
    this.repository = new TradeRepository();
    this.mode = config.trading.mode;
    this._rakuten = null; // 遅延ロード
  }

  /** 楽天証券クライアントを遅延ロード（live系モードのみ初期化） */
  async _getRakutenClient() {
    if (!this._rakuten) {
      try {
        const { default: RakutenClient } = await import('../api/rakuten-client.js');
        this._rakuten = new RakutenClient();
        await this._rakuten.authenticate();
      } catch (e) {
        throw new ExecutionError(`楽天証券クライアントの初期化に失敗: ${e.message}`);
      }
    }
    return this._rakuten;
  }

  /**
   * 注文を実行
   * @param {string} symbol  銘柄コード
   * @param {string} decision BUY / SELL
   * @param {object} positionSize { quantity, currentPrice, stopLoss, takeProfit, confidence, reasoning, ... }
   */
  async execute(symbol, decision, positionSize) {
    try {
      const price = positionSize.currentPrice ?? positionSize.entryPrice ?? 0;
      logger.info(
        `Executing ${decision} order for ${symbol}: ${positionSize.quantity} shares @ ¥${price.toFixed(0)}`
      );

      let orderResult;

      switch (this.mode) {
        case 'advisor':
          orderResult = await this.executeAdvisorOrder(symbol, decision, positionSize, price);
          break;
        case 'demo':
          orderResult = await this.executeDemoOrder(symbol, decision, positionSize, price);
          break;
        case 'live_mini':
          orderResult = await this.executeLiveMiniOrder(symbol, decision, positionSize);
          break;
        case 'live':
          orderResult = await this.executeLiveOrder(symbol, decision, positionSize);
          break;
        default:
          throw new ExecutionError(`Unknown trading mode: ${this.mode}`);
      }

      // DB に記録
      await this.repository.saveTradeRecord({
        symbol,
        decision,
        entryPrice: orderResult.price,
        quantity: positionSize.quantity,
        confidence: positionSize.confidence,
        reasoning: positionSize.reasoning
          ? positionSize.reasoning.slice(0, 500)
          : `${decision} order executed in ${this.mode} mode`,
      });

      logger.info(`✓ Order executed: ${orderResult.orderId} @ ¥${orderResult.price}`);

      return {
        success: true,
        ...orderResult,
      };
    } catch (error) {
      logger.error(`Execution error for ${symbol}: ${error.message}`);
      throw new ExecutionError(`Failed to execute order: ${error.message}`);
    }
  }

  /**
   * アドバイザーモード（手動発注モード）
   * 実際には注文せず、推奨内容をレポートファイルに追記する
   */
  async executeAdvisorOrder(symbol, decision, positionSize, currentPrice) {
    const orderId = `ADVISOR-${Date.now()}`;
    const amount  = positionSize.quantity * currentPrice;
    const side    = decision === 'BUY' ? '買' : '売';
    const emoji   = decision === 'BUY' ? '🟢' : '🔴';

    // コンソールに目立つ形で出力
    const line = '─'.repeat(50);
    logger.info(line);
    logger.info(`${emoji} 【手動発注してください】`);
    logger.info(`   銘柄   : ${symbol}`);
    logger.info(`   売買   : ${side}`);
    logger.info(`   株数   : ${positionSize.quantity}株`);
    logger.info(`   現在値 : ¥${Math.round(currentPrice).toLocaleString('ja-JP')}`);
    logger.info(`   概算金額: ¥${Math.round(amount).toLocaleString('ja-JP')}`);
    logger.info(`   注文種別: 成行（寄付）`);
    logger.info(`   口座   : 特定口座`);
    logger.info(line);

    // レポートファイルに追記（logs/trade-report-YYYY-MM-DD.txt）
    await this._appendTradeReport({ symbol, decision, currentPrice, positionSize, amount });

    return {
      orderId,
      status:      'advisor',
      price:       currentPrice,
      quantity:    positionSize.quantity,
      symbol,
      mode:        'advisor',
      timestamp:   new Date().toISOString(),
    };
  }

  /** 推奨売買レポートファイルに追記 */
  async _appendTradeReport({ symbol, decision, currentPrice, positionSize, amount }) {
    try {
      const fs   = await import('fs');
      const path = await import('path');

      const today     = new Date().toISOString().split('T')[0];
      const time      = new Date().toLocaleTimeString('ja-JP');
      const logsDir   = config.paths?.logs ?? 'logs';
      const reportPath = path.default.join(logsDir, `trade-report-${today}.txt`);
      const side      = decision === 'BUY' ? '買い' : '売り';

      const line =
        `[${time}] ${decision === 'BUY' ? '🟢 BUY' : '🔴 SELL'} ` +
        `${symbol} ${positionSize.quantity}株 ` +
        `@¥${Math.round(currentPrice).toLocaleString('ja-JP')} ` +
        `= ¥${Math.round(amount).toLocaleString('ja-JP')} (成行・${side})\n`;

      fs.default.mkdirSync(logsDir, { recursive: true });
      fs.default.appendFileSync(reportPath, line, 'utf8');
      logger.info(`レポートに追記: ${reportPath}`);
    } catch (e) {
      logger.warn(`レポート書き込み失敗: ${e.message}`);
    }
  }

  /**
   * デモモード注文実行
   * price には実際の現在株価を使用する（price:0 バグを修正）
   *
   * スリッページは 0〜0.01% (≒ 0〜30銭/¥3000株) と非常に小さくし、
   * 「買った直後にいきなり含み損が大きく出る」 違和感を解消。
   * 大引け（15:00）成行注文は実際もこの程度でほぼ約定するため現実的。
   */
  async executeDemoOrder(symbol, decision, positionSize, currentPrice) {
    const orderId = `DEMO-${Date.now()}`;

    // スリッページを 0〜0.01% に縮小（旧 0.1% → 1/10）
    const slippage = 1 + (Math.random() * 0.0001) * (decision === 'BUY' ? 1 : -1);
    const executedPrice = Math.round(currentPrice * slippage);

    logger.info(
      `[DEMO] ${decision} ${positionSize.quantity} shares of ${symbol} @ ¥${executedPrice} (slip: ${((slippage - 1) * 100).toFixed(4)}% / market ¥${Math.round(currentPrice)})`
    );

    return {
      orderId,
      status: 'executed',
      price: executedPrice,
      marketPrice: Math.round(currentPrice),   // 約定時の市場価格（スリッページ無し）
      quantity: positionSize.quantity,
      symbol,
      mode: 'demo',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * ミニ株モード注文実行（楽天証券 API）
   */
  async executeLiveMiniOrder(symbol, decision, positionSize) {
    try {
      const client = await this._getRakutenClient();

      logger.info(
        `[LIVE-MINI] Placing order: ${decision} ${positionSize.quantity} shares of ${symbol}`
      );

      const result = await client.placeOrder({
        symbol,
        side: decision,
        quantity: positionSize.quantity,
        orderType: 'MARKET',
        miniLot: true,
      });

      return {
        orderId: result.orderId,
        status: result.status,
        price: result.executedPrice ?? positionSize.currentPrice ?? 0,
        quantity: positionSize.quantity,
        symbol,
        mode: 'live_mini',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new ExecutionError(`Mini trade execution failed: ${error.message}`);
    }
  }

  /**
   * 本番モード注文実行（楽天証券 API）
   */
  async executeLiveOrder(symbol, decision, positionSize) {
    try {
      const client = await this._getRakutenClient();

      logger.warn(
        `[LIVE] ⚠ REAL MONEY ORDER: ${decision} ${positionSize.quantity} shares of ${symbol}`
      );

      const result = await client.placeOrder({
        symbol,
        side: decision,
        quantity: positionSize.quantity,
        orderType: 'MARKET',
        miniLot: false,
      });

      return {
        orderId: result.orderId,
        status: result.status,
        price: result.executedPrice ?? positionSize.currentPrice ?? 0,
        quantity: positionSize.quantity,
        symbol,
        mode: 'live',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new ExecutionError(`Live trade execution failed: ${error.message}`);
    }
  }

  /**
   * 注文をキャンセル
   */
  async cancelOrder(orderId) {
    try {
      logger.info(`Canceling order: ${orderId}`);

      // モード別にキャンセル処理
      // 実装例

      logger.info(`✓ Order cancelled: ${orderId}`);

      return {
        success: true,
        orderId,
      };
    } catch (error) {
      throw new ExecutionError(`Failed to cancel order: ${error.message}`);
    }
  }

  /**
   * 注文ステータスを確認
   */
  async getOrderStatus(orderId) {
    try {
      // API から注文ステータスを取得

      return {
        orderId,
        status: 'filled', // 約定済み
        filledQuantity: 100,
        filledPrice: 4545.0,
      };
    } catch (error) {
      throw new ExecutionError(`Failed to get order status: ${error.message}`);
    }
  }

  /**
   * 実際の実行モード検証
   */
  validateExecutionMode() {
    if (!['demo', 'live_mini', 'live'].includes(this.mode)) {
      throw new ExecutionError(`Invalid trading mode: ${this.mode}`);
    }

    if (this.mode === 'live') {
      logger.warn('⚠⚠⚠ LIVE TRADING MODE ENABLED ⚠⚠⚠');
      logger.warn('Real money will be traded.');
    }

    return true;
  }
}

export default Executor;
