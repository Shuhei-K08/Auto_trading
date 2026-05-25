# API 仕様書

Claude AI Stock Auto Trading System の API 仕様です。

## 1. Anthropic API

### エンドポイント

```
POST https://api.anthropic.com/v1/messages
```

### リクエスト

```javascript
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": "株価分析のプロンプト"
    }
  ]
}
```

### レスポンス

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "{\"decision\": \"BUY\", \"confidence\": 0.72, \"reasoning\": \"...\"}"
    }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 150
  }
}
```

### 認証

```
Authorization: Bearer YOUR_API_KEY
```

## 2. 取引エンジン API

### getStockData(symbol)

Yahoo Finance からデータを取得します。

#### パラメータ

| 名前 | 型 | 説明 |
|-----|----|----|
| symbol | string | 株式シンボル（4桁の数字） |

#### リターン

```javascript
{
  symbol: "7203",
  currentPrice: 4545,
  lastUpdate: "2026-05-19T15:00:00Z",
  historical: [
    {
      date: "2026-05-19",
      open: 4540,
      high: 4550,
      low: 4535,
      close: 4545,
      volume: 10000000,
      adjClose: 4545
    },
    // ... 過去60日分
  ]
}
```

### analyzeStock(symbol, stockData, indicators)

Claude AI が株価を分析して売買判定します。

#### パラメータ

| 名前 | 型 | 説明 |
|-----|----|----|
| symbol | string | 株式シンボル |
| stockData | object | getStockData() の戻り値 |
| indicators | object | テクニカル指標 |

#### リターン

```javascript
{
  decision: "BUY",           // BUY / SELL / HOLD
  confidence: 0.72,          // 0.0 ~ 1.0
  reasoning: "MA5 > MA20..."  // 判定理由
}
```

### calculatePositionSize(confidence, currentPrice)

信頼度から購入株数を計算します。

#### パラメータ

| 名前 | 型 | 説明 |
|-----|----|----|
| confidence | number | Claude の信頼度（0.0～1.0） |
| currentPrice | number | 現在価格 |

#### リターン

```javascript
{
  quantity: 44,              // 購入株数
  amount: 200000,            // 投資額（¥）
  riskPercent: 0.5,          // リスク率（%）
  confidence: 0.72
}
```

### execute(symbol, decision, positionSize)

注文を実行します（デモ/本番）。

#### パラメータ

| 名前 | 型 | 説明 |
|-----|----|----|
| symbol | string | 株式シンボル |
| decision | string | BUY / SELL / HOLD |
| positionSize | object | calculatePositionSize() の戻り値 |

#### リターン

```javascript
{
  success: true,
  orderId: "DEMO-1717....",
  status: "executed",
  price: 4545,
  quantity: 44,
  symbol: "7203",
  mode: "demo",
  timestamp: "2026-05-19T15:05:00Z"
}
```

## 3. データベース API

### saveTradeRecord(tradeData)

取引記録を保存します。

#### パラメータ

```javascript
{
  symbol: "7203",
  decision: "BUY",
  entryPrice: 4545,
  quantity: 44,
  confidence: 0.72,
  reasoning: "...",
  timestamp: "2026-05-19T15:05:00Z"
}
```

### getLatestPortfolio()

最新のポートフォリオ情報を取得します。

#### リターン

```javascript
{
  id: 1,
  date: "2026-05-19",
  initialCapital: 1000000,
  currentCapital: 1050000,
  availableCash: 800000,
  investedStocks: 250000,
  deposits: 0,
  withdrawals: 0,
  totalGains: 50000,
  monthlyGains: 12000,
  pendingDeposits: 0,
  pendingPurchases: 0,
  created_at: "2026-05-19T15:05:00Z"
}
```

### getOpenPositions()

保有中のポジション一覧を取得します。

#### リターン

```javascript
[
  {
    id: 1,
    symbol: "7203",
    quantity: 44,
    entry_price: 4545,
    entry_date: "2026-05-19",
    current_price: 4550,
    unrealized_pnl: 220,
    status: "holding",
    delivery_date: null,
    stop_loss_price: 4318,
    take_profit_price: 5000,
    created_at: "2026-05-19T15:05:00Z"
  }
]
```

### getRecentTrades(limit = 10)

最近の取引記録を取得します。

#### パラメータ

| 名前 | 型 | 説明 |
|-----|----|----|
| limit | number | 取得件数（デフォルト: 10） |

#### リターン

```javascript
[
  {
    id: 1,
    symbol: "7203",
    decision: "BUY",
    entry_price: 4545,
    quantity: 44,
    confidence: 0.72,
    reasoning: "MA5 > MA20 > MA60...",
    status: "pending",
    exit_price: null,
    pnl: null,
    timestamp: "2026-05-19T15:05:00Z"
  }
]
```

## 4. リスク管理 API

### canTrade(analysis, currentPositions)

取引可能かどうかをチェックします。

#### パラメータ

| 名前 | 型 | 説明 |
|-----|----|----|
| analysis | object | analyzeStock() の戻り値 |
| currentPositions | array | getOpenPositions() の戻り値 |

#### リターン

```javascript
true or false
```

### checkTargets(position, currentPrice)

ストップロス/テイクプロフィットに到達したかをチェック。

#### パラメータ

| 名前 | 型 | 説明 |
|-----|----|----|
| position | object | ポジション情報 |
| currentPrice | number | 現在価格 |

#### リターン

```javascript
{
  stopLoss: 4318,
  takeProfit: 5000,
  signal: "TAKE_PROFIT",     // null / STOP_LOSS / TAKE_PROFIT
  shouldClose: true
}
```

## 5. 技術指標 API

### calculateSMA(prices, period)

単純移動平均を計算します。

#### パラメータ

| 名前 | 型 | 説明 |
|-----|----|----|
| prices | array | 価格配列 |
| period | number | 期間（5, 20, 60 など） |

#### リターン

```javascript
4520.5  // SMA の値
```

### calculateRSI(prices, period = 14)

RSI（Relative Strength Index）を計算します。

#### リターン

```javascript
65.3  // RSI 値（0～100）
```

### calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9)

MACD を計算します。

#### リターン

```javascript
{
  line: 0.45,       // MACD ライン
  signal: 0.38,     // シグナルライン
  histogram: 0.07   // ヒストグラム
}
```

## 6. ユーティリティ API

### formatCurrency(amount)

金額を通貨表記でフォーマットします。

```javascript
formatCurrency(1000000);
// => "¥1,000,000"
```

### formatPercent(value, decimals = 2)

パーセンテージをフォーマットします。

```javascript
formatPercent(0.72, 2);
// => "72.00%"
```

### formatDate(date)

日付をフォーマットします。

```javascript
formatDate(new Date());
// => "2026-05-19"
```

## エラーレスポンス

### 400 Bad Request

```json
{
  "error": "Invalid request",
  "message": "Symbol is required"
}
```

### 401 Unauthorized

```json
{
  "error": "Unauthorized",
  "message": "Invalid API key"
}
```

### 429 Too Many Requests

```json
{
  "error": "Rate limit exceeded",
  "message": "Please retry after 60 seconds"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal error",
  "message": "Database connection failed"
}
```

## レート制限

- **Anthropic API**: 1分あたり 60 リクエスト
- **Yahoo Finance**: 1分あたり 100 リクエスト
- **楽天証券 API**: 1時間あたり 1000 リクエスト

## タイムアウト

- **HTTP リクエスト**: 30秒
- **データベース操作**: 10秒
- **API 呼び出し**: 10秒

---

[README に戻る](../README.md)
