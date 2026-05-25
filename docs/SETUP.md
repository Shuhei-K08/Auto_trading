# セットアップガイド

Claude AI Stock Auto Trading System のセットアップ手順です。

## 前提条件

- Node.js 18.0 以上
- Python 3.8 以上
- npm または yarn
- Anthropic API キー
- 楽天証券 API キー（本番モードの場合）

## ステップ 1: リポジトリを取得

```bash
# GitHub からクローン（または zip をダウンロード）
git clone https://github.com/your-repo/claude-autotrade.git
cd claude-autotrade
```

## ステップ 2: Node.js 環境構築

### 2.1 パッケージをインストール

```bash
# npm パッケージをインストール
npm install

# または yarn を使用
yarn install
```

### 2.2 パッケージ確認

```bash
# インストール状況を確認
npm list
```

## ステップ 3: Python 環境構築

### 3.1 仮想環境を作成

```bash
# macOS / Linux
python3 -m venv venv
source venv/bin/activate

# Windows
python -m venv venv
venv\Scripts\activate
```

### 3.2 Python パッケージをインストール

```bash
# 依存パッケージをインストール
pip install -r requirements.txt

# または、個別にインストール
pip install streamlit pandas plotly
```

## ステップ 4: 環境変数を設定

### 4.1 .env ファイルを作成

```bash
cp .env.example .env
```

### 4.2 API キーを設定

テキストエディタで `.env` を開いて設定します。

#### Anthropic API キーを取得

1. https://console.anthropic.com にアクセス
2. ログイン（または新規作成）
3. "API Keys" セクションから "Create Key" をクリック
4. キーをコピー

#### .env に記入

```bash
# Anthropic API
ANTHROPIC_API_KEY=sk-ant-v4-xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# 楽天証券 API（本番のみ）
RAKUTEN_CLIENT_ID=your_client_id
RAKUTEN_CLIENT_SECRET=your_client_secret

# トレーディング設定
TRADING_MODE=demo
PORTFOLIO_VALUE=1000000
```

### 4.3 その他の設定

デフォルト値で問題なければ、以下のパラメータはそのままで OK：

```bash
# リスク管理
MAX_POSITIONS=5
MAX_POSITION_PERCENT=0.20
CONFIDENCE_THRESHOLD=0.65

# 売買ルール
STOP_LOSS_PERCENT=0.05
TAKE_PROFIT_PERCENT=0.10

# 監視銘柄
WATCHED_STOCKS=7203,6758,9984,8306,2802
```

## ステップ 5: データベース初期化

```bash
# Node.js を起動
npm start

# 初回起動時に自動的にデータベースが作成されます
# Ctrl+C で停止
```

## ステップ 6: 動作確認

### 6.1 デモモードでテスト実行

```bash
# ターミナル 1: バックエンド開始
TRADING_MODE=demo npm start

# ターミナル 2: UI 開始
cd streamlit
streamlit run streamlit_app.py

# ブラウザで http://localhost:8501 にアクセス
```

### 6.2 テストが成功したら

ログが出力されていることを確認：

```bash
# ログ確認
tail -f logs/$(date +%Y-%m-%d).log

# 出力例:
# [INFO] Daily trading analysis started
# [INFO] Analyzing 7203...
# [INFO] ✓ Data fetched: 4545
# [INFO] ✓ Claude decision: BUY (72%)
```

## ステップ 7: ミニ株モードへの移行（オプション）

### 7.1 楽天証券 API を設定

1. https://api.rakuten-sec.co.jp でアプリケーション登録
2. Client ID と Client Secret を取得
3. `.env` に記入

```bash
RAKUTEN_CLIENT_ID=your_id
RAKUTEN_CLIENT_SECRET=your_secret
TRADING_MODE=live_mini
```

### 7.2 OAuth2 認可フロー

初回実行時に OAuth2 認可 URL が表示されます：

```
https://auth.example.com/authorize?...
```

ブラウザでアクセスして認可してください。

## ステップ 8: 本番モードへの移行（⚠️ 注意）

### 8.1 確認事項

```bash
# デモモードで 1～2ヶ月テスト
# ミニ株で 1～2ヶ月テスト
# 安定性を確認してから本番へ
```

### 8.2 本番設定

```bash
# .env を編集
TRADING_MODE=live
PORTFOLIO_VALUE=1000000  # 実資金に変更
```

### 8.3 本番実行

```bash
npm start

# ログで確認
tail -f logs/$(date +%Y-%m-%d).log
```

## ステップ 9: 定期運用

### 毎営業日の確認

```bash
# ログを確認
tail -f logs/$(date +%Y-%m-%d).log

# ダッシュボードで統計を確認
# http://localhost:8501
```

### 毎月の確認

```bash
# 月間レポートを生成
npm run monthly-report

# DB をバックアップ
cp database/trades.db database/trades_$(date +%Y%m%d).db
```

### 年1回の確認

- セキュリティアップデート確認
- API キーのローテーション
- 年間パフォーマンス集計
- 税理士に相談（確定申告）

## トラブルシューティング

### npm install に失敗

```bash
# キャッシュをクリア
npm cache clean --force

# 再実行
npm install
```

### Python パッケージが見つからない

```bash
# 仮想環境が有効化されているか確認
which python  # Mac/Linux
where python  # Windows

# 仮想環境を再度有効化
source venv/bin/activate  # Mac/Linux
venv\Scripts\activate      # Windows
```

### データベースエラー

```bash
# DB ファイルを削除
rm database/trades.db

# 再初期化
npm start
```

### API キーエラー

```
Error: ANTHROPIC_API_KEY is not set
```

対策:
1. `.env` ファイルが存在するか確認
2. `ANTHROPIC_API_KEY=` が記入されているか確認
3. キーの先頭に `sk-ant-v4-` があるか確認

### ポート競合エラー

```
Error: Port 8501 already in use
```

対策:
```bash
# ポート 8502 で起動
streamlit run streamlit_app.py --server.port 8502
```

## 開発モード

### ホットリロード有効で実行

```bash
npm run dev
```

### テストコードを実行

```bash
npm test
```

## FAQ

### Q. デモモードでは本当に実行されないのか？

**A.** はい。デモモードではログに記録されるだけで、実際の注文は実行されません。

### Q. データベースは安全か？

**A.** SQLite はローカルマシンのみアクセス可能です。ただし定期的にバックアップしてください。

### Q. API 使用料はいくら？

**A.** Anthropic API は従量課金です。月 ¥200～500 程度を想定してください。

### Q. 楽天証券以外のブローカーに対応している？

**A.** 現在は楽天証券のみです。他のブローカーへの対応は今後の予定です。

### Q. 複数台のマシンで実行できる？

**A.** データベースがローカルなため、複数台での同時実行は非推奨です。VPS に配置するか、クラウド DB に移行してください。

---

[README に戻る](../README.md)
