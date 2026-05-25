/**
 * Rakuten Securities (楽天証券) API Client
 * MarketSpeed II RSS (Remote Store Service) API ラッパー
 *
 * 【接続方法】
 *  楽天証券の自動売買 API は「MarketSpeed II」の RSS 機能を使用します。
 *  - RSS は Excel VBA や COM オートメーション経由が公式だが、
 *    非公式の REST ラッパー (kabucom/kabusdk 相当) を使う方法もある。
 *  - 現在の実装は「楽天証券 API (kabu.com API 互換形式)」の HTTP REST を想定。
 *    実際には kabu.com 証券 (KDDI グループ) の kabu Station® API が
 *    最も使いやすい REST API として利用される例が多い。
 *
 * 【本番利用前に必要な設定】
 *  .env に以下を追加:
 *    RAKUTEN_API_BASE_URL=http://localhost:18080  (kabu Station® のデフォルト)
 *    RAKUTEN_API_PASSWORD=your_password
 *    RAKUTEN_CLIENT_ID=your_client_id    (オプション)
 *    RAKUTEN_CLIENT_SECRET=your_secret  (オプション)
 *
 * 【kabu Station® API の起動方法】
 *  1. kabu.com 証券に口座開設
 *  2. kabu Station® アプリをインストール・起動
 *  3. kabu Station® の API 設定でパスワードを設定
 *  4. このクライアントが localhost:18080 に接続
 *
 * @see https://kabucom.github.io/kabusdk/api/
 */

import axios from 'axios';
import logger from '../utils/logger.js';

// API 設定
const RAKUTEN_CONFIG = {
  baseUrl:  process.env.RAKUTEN_API_BASE_URL  ?? 'http://localhost:18080',
  password: process.env.RAKUTEN_API_PASSWORD  ?? '',
  clientId: process.env.RAKUTEN_CLIENT_ID     ?? '',
  secret:   process.env.RAKUTEN_CLIENT_SECRET ?? '',

  // タイムアウト設定
  timeoutMs: 10_000,

  // 注文タイプ対応表
  orderTypes: {
    MARKET: 1,   // 成行
    LIMIT:  2,   // 指値
  },

  // 売買区分
  sides: {
    BUY:  1,  // 買い
    SELL: 2,  // 売り
  },

  // 市場コード（東証）
  exchange: 1, // 東証プライム
};

class RakutenClient {
  constructor() {
    this._token = null;
    this._tokenExpiry = null;

    this.http = axios.create({
      baseURL: RAKUTEN_CONFIG.baseUrl,
      timeout: RAKUTEN_CONFIG.timeoutMs,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // レスポンスインターセプター（エラーログ）
    this.http.interceptors.response.use(
      res => res,
      err => {
        const status = err.response?.status;
        const msg    = err.response?.data?.Message ?? err.message;
        logger.error(`[RakutenClient] HTTP ${status}: ${msg}`);
        return Promise.reject(err);
      }
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  認証
  // ─────────────────────────────────────────────────────────────

  /**
   * API トークンを取得（24時間有効）
   */
  async authenticate() {
    if (this._token && this._tokenExpiry > Date.now()) {
      return this._token;
    }

    try {
      logger.info('[RakutenClient] 認証中...');

      const res = await this.http.post('/kabusapi/token', {
        APIPassword: RAKUTEN_CONFIG.password,
      });

      this._token = res.data.Token;
      this._tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23時間

      // 以降のリクエストに自動付与
      this.http.defaults.headers.common['X-API-KEY'] = this._token;

      logger.info('[RakutenClient] 認証成功');
      return this._token;
    } catch (error) {
      throw new Error(
        `楽天証券 API 認証失敗: ${error.response?.data?.Message ?? error.message}\n` +
        '確認事項:\n' +
        '  1. kabu Station® が起動・ログイン済みか\n' +
        '  2. .env の RAKUTEN_API_PASSWORD が正しいか\n' +
        '  3. RAKUTEN_API_BASE_URL が http://localhost:18080 か'
      );
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  口座情報
  // ─────────────────────────────────────────────────────────────

  /**
   * 口座残高・余力を取得
   */
  async getBalance() {
    await this.authenticate();

    try {
      const res = await this.http.get('/kabusapi/wallet/cash');
      const data = res.data;

      return {
        cashBalance:     data.StockAccountWallet ?? 0,   // 現物買付余力
        marginBalance:   data.MarginAccountWallet ?? 0,  // 信用建余力
        totalAssets:     data.TotalAssets ?? 0,
        availableCash:   data.StockAccountWallet ?? 0,
      };
    } catch (error) {
      throw new Error(`残高取得失敗: ${error.message}`);
    }
  }

  /**
   * 保有ポジションを取得
   */
  async getPositions() {
    await this.authenticate();

    try {
      const res = await this.http.get('/kabusapi/positions');
      const items = res.data ?? [];

      return items.map(p => ({
        symbol:      p.Symbol,
        name:        p.SymbolName,
        quantity:    p.LeavesQty,
        entryPrice:  p.Price,
        currentPrice: p.CurrentPrice ?? p.Price,
        pnl:         (p.CurrentPrice - p.Price) * p.LeavesQty,
        pnlPct:      ((p.CurrentPrice - p.Price) / p.Price) * 100,
        side:        p.Side === '2' ? 'BUY' : 'SELL',
      }));
    } catch (error) {
      throw new Error(`ポジション取得失敗: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  注文
  // ─────────────────────────────────────────────────────────────

  /**
   * 注文を発注
   *
   * @param {object} params
   * @param {string}  params.symbol     銘柄コード（例: '7203'）
   * @param {string}  params.side       'BUY' | 'SELL'
   * @param {number}  params.quantity   株数
   * @param {string}  params.orderType  'MARKET' | 'LIMIT'
   * @param {number}  [params.price]    指値価格（LIMIT の場合）
   * @param {boolean} [params.miniLot]  ミニ株（単元未満）注文か
   * @returns {{ orderId, status, executedPrice }}
   */
  async placeOrder({ symbol, side, quantity, orderType = 'MARKET', price = 0, miniLot = false }) {
    await this.authenticate();

    const body = {
      Password:     RAKUTEN_CONFIG.password,
      Symbol:       symbol,
      Exchange:     RAKUTEN_CONFIG.exchange,
      SecurityType: 1,           // 株式
      Side:         side === 'BUY' ? '2' : '1',  // 2=買 1=売（kabu API 仕様）
      CashMargin:   1,           // 1=現物
      DelivType:    2,           // 2=お預かり
      FundType:     '  ',
      AccountType:  4,           // 4=特定口座
      Qty:          quantity,
      FrontOrderType: orderType === 'MARKET' ? 10 : 20,  // 10=成行 20=指値
      Price:        orderType === 'LIMIT' ? price : 0,
      ExpireDay:    0,           // 0=当日
    };

    // ミニ株の場合（kabu.com では単元未満株を別エンドポイント経由）
    if (miniLot) {
      logger.info(`[RakutenClient] ミニ株注文: ${side} ${quantity}株 ${symbol}`);
      // ミニ株は証券会社によって対応が異なる。kabu.comでは通常注文と同じエンドポイント
    }

    logger.info(`[RakutenClient] 注文発注: ${side} ${quantity}株 ${symbol} ${orderType}`);

    try {
      const res = await this.http.post('/kabusapi/sendorder', body);
      const data = res.data;

      if (data.Result !== 0) {
        throw new Error(`注文エラー (code: ${data.Result}): ${data.ResultCode}`);
      }

      logger.info(`[RakutenClient] 注文受付: OrderId=${data.OrderId}`);

      // 約定確認（最大5回ポーリング）
      const executedOrder = await this.waitForExecution(data.OrderId);

      return {
        orderId:       data.OrderId,
        status:        executedOrder.status,
        executedPrice: executedOrder.price,
        executedQty:   executedOrder.qty,
      };
    } catch (error) {
      throw new Error(`注文失敗: ${error.message}`);
    }
  }

  /**
   * 注文の約定を最大 maxRetries 回ポーリングで確認
   * @param {string} orderId
   * @param {number} maxRetries 最大試行回数（成行は通常すぐ約定）
   */
  async waitForExecution(orderId, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, 1000)); // 1秒待機

      try {
        const res = await this.http.get(`/kabusapi/orders?id=${orderId}`);
        const orders = res.data ?? [];
        const order = orders.find(o => o.ID === orderId);

        if (!order) continue;

        // 約定済み（RecvStatus=2 or State=5）
        if (order.State === 5 || order.RecvStatus === 2) {
          return {
            status: 'executed',
            price:  order.Price ?? order.ExecutionPrice ?? 0,
            qty:    order.CumQty ?? order.Qty,
          };
        }

        logger.debug(`[RakutenClient] 約定待ち (${i + 1}/${maxRetries})...`);
      } catch {
        // ポーリング中のエラーは無視して継続
      }
    }

    // タイムアウト（注文は受付済みだが約定未確認）
    logger.warn(`[RakutenClient] 約定確認タイムアウト: ${orderId}`);
    return { status: 'pending', price: 0, qty: 0 };
  }

  /**
   * 注文をキャンセル
   * @param {string} orderId
   */
  async cancelOrder(orderId) {
    await this.authenticate();

    try {
      const res = await this.http.put('/kabusapi/cancelorder', {
        OrderId:  orderId,
        Password: RAKUTEN_CONFIG.password,
      });

      logger.info(`[RakutenClient] 注文キャンセル: ${orderId}`);
      return { success: true, orderId };
    } catch (error) {
      throw new Error(`注文キャンセル失敗: ${error.message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  時価情報
  // ─────────────────────────────────────────────────────────────

  /**
   * 銘柄の現在値・板情報を取得
   * @param {string} symbol  銘柄コード
   */
  async getQuote(symbol) {
    await this.authenticate();

    try {
      const res = await this.http.get(`/kabusapi/board/${symbol}@${RAKUTEN_CONFIG.exchange}`);
      const d = res.data;

      return {
        symbol:       d.Symbol,
        name:         d.SymbolName,
        currentPrice: d.CurrentPrice,
        openPrice:    d.OpeningPrice,
        highPrice:    d.HighPrice,
        lowPrice:     d.LowPrice,
        prevClose:    d.PreviousClose,
        volume:       d.TradingVolume,
        changeRate:   d.PriceChangeStatus,
      };
    } catch (error) {
      throw new Error(`時価取得失敗 (${symbol}): ${error.message}`);
    }
  }

  /**
   * API 接続テスト
   */
  async testConnection() {
    try {
      await this.authenticate();
      const balance = await this.getBalance();
      logger.info(`[RakutenClient] 接続テスト成功: 現物買付余力 ¥${balance.cashBalance.toLocaleString('ja-JP')}`);
      return { success: true, balance };
    } catch (error) {
      logger.error(`[RakutenClient] 接続テスト失敗: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

export default RakutenClient;
