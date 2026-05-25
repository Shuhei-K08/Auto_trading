# 🤖 Claude AI Stock Auto Trading System (CASATS) v3.0

> **Claude AI を活用した日本株スイングトレード自動売買システム**  
> デモトレード → 楽天証券 API 接続の段階的移行に対応

---

## ⚠️ 免責事項

本システムは教育・研究目的で作成されています。  
**実際の株式取引には必ず損失リスクが伴います。**  
本システムを利用して生じた損失について、作者は一切責任を負いません。  
必ずデモトレードで十分な検証を行ってから実運用に移行してください。

---

## 📋 目次

1. [システム概要](#システム概要)
2. [機能一覧](#機能一覧)
3. [セットアップ](#セットアップ)
4. [デモトレードの実行](#デモトレードの実行)
5. [楽天証券 API 接続](#楽天証券-api-接続)
6. [設定一覧](#設定一覧)
7. [システム設計](#システム設計)
8. [GitHub へのアップロード](#github-へのアップロード)

---

## システム概要

```
Yahoo Finance → テクニカル分析 → Claude AI 判断 → 自動売買
                                                    ↓
                                              デモ / 楽天証券
```

### 主要フロー（毎営業日 15:05 自動実行）

```
[Phase 1] 保有ポジション確認
  ├─ ストップロス到達  → 自動売却
  ├─ 利益確定到達      → 自動売却
  └─ Claude SELL 判断  → 自動売却（信頼度 65% 以上）

[Phase 2] 新規エントリー
  ├─ ウォッチリスト銘柄を取得
  ├─ 軍資金比率フィルタ（1単元が利用可能資金の30%以内）
  ├─ テクニカル分析（MA/RSI/MACD/ADX/ボリンジャー/一目均衡表）
  ├─ Claude AI 分析 → BUY/HOLD/SELL 判断
  └─ BUY → ポジションサイズ計算 → 発注
```

---

## 機能一覧

| 機能 | 説明 |
|------|------|
| **軍資金比率フィルタ** | 利用可能資金の30%以内で1単元買える銘柄のみ候補に |
| **株価帯スコア** | 理想帯（資金の3〜15%/単元）の銘柄にボーナス付与 |
| **自動ストップロス** | ATR × 2 ベースの動的SL設定 |
| **自動利益確定** | ATR × 3 ベースの動的TP設定 |
| **Claude AI 判断** | 各銘柄を AI がテクニカル + ファンダメンタル分析 |
| **デモトレード** | 実資金を使わずシミュレーション（スリッページも再現） |
| **楽天証券 API** | kabu Station® API 経由でリアル発注 |
| **ダッシュボード** | Streamlit による Web UI（ポートフォリオ・損益・ログ） |

---

## セットアップ

### 1. 前提条件

```bash
node -v    # v18 以上が必要
python -v  # v3.9 以上（Streamlit UI 用）
```

### 2. リポジトリのクローン

```bash
git clone git@github.com:your-username/casats.git
cd casats
```

### 3. Node.js 依存パッケージのインストール

```bash
npm install
```

> ⚠️ `sqlite3` のネイティブバインディングエラーが出た場合:
> ```bash
> rm -rf node_modules
> npm install
> ```

### 4. Python 依存パッケージのインストール（Streamlit UI 用）

```bash
pip install -r requirements.txt
# または仮想環境を使う場合:
python -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

### 5. 環境変数の設定

```bash
cp .env.example .env
# .env をエディタで開いて設定
```

最低限必要な設定:

```env
ANTHROPIC_API_KEY=sk-ant-...   # Anthropic API キー（必須）
TRADING_MODE=demo              # demo / live_mini / live
PORTFOLIO_VALUE=1000000        # 初期資金（円）
WATCHED_STOCKS=7203,6758,9984  # 監視銘柄（証券コード）
```

---

## デモトレードの実行

### ▶ デモサイクルの自動実行（推奨）

```bash
# 5サイクル（デフォルト）実行
node demo-cycle.js

# 10サイクル実行
node demo-cycle.js --cycles 10

# 現在の成績レポートのみ表示
node demo-cycle.js --report
```

### ▶ リアルタイムスケジューラーの起動

```bash
# 毎営業日 15:05 に自動実行（常駐）
npm start

# 今すぐ1回テスト実行
npm start -- --test
```

### ▶ Streamlit ダッシュボードの起動

```bash
streamlit run streamlit/streamlit_app.py
# → http://localhost:8501 でブラウザアクセス
```

### デモで確認できること

- ポジションの自動売買サイクル（買い→保有→売り）
- 軍資金に対する銘柄選定フィルタリング
- P&L（損益）の累積推移
- Claude AI の売買判断根拠

---

## 楽天証券 API 接続

デモトレードで安定した利益が出たら、以下の手順で実取引に移行できます。

### Step 1: kabu.com 証券の口座開設

本システムは **kabu.com 証券（KDDI グループ）の kabu Station® API** を使用します。  
（楽天証券の RSS は VBA/COM 専用のため、REST API 対応の kabu.com を推奨）

1. [kabu.com 証券](https://kabu.com) で口座開設
2. kabu Station® アプリをダウンロード・起動・ログイン
3. アプリの「API」メニューから API パスワードを設定

### Step 2: .env に API 設定を追加

```env
RAKUTEN_API_BASE_URL=http://localhost:18080
RAKUTEN_API_PASSWORD=your_api_password_here
```

### Step 3: 接続テスト

```bash
node -e "
import('./src/api/rakuten-client.js').then(async ({ default: RakutenClient }) => {
  const client = new RakutenClient();
  const result = await client.testConnection();
  console.log(result);
});
"
```

### Step 4: ミニ株モードで小額テスト

```env
TRADING_MODE=live_mini
POSITION_MULTIPLIER=0.1   # ポジションサイズを 1/10 に
```

### Step 5: 本番モードへ移行

十分な検証後:

```env
TRADING_MODE=live
POSITION_MULTIPLIER=1.0
```

---

## 設定一覧

`.env` で調整できるパラメータ:

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `TRADING_MODE` | `demo` | `demo` / `live_mini` / `live` |
| `PORTFOLIO_VALUE` | `1000000` | 初期資金（円） |
| `MAX_POSITIONS` | `5` | 最大同時保有ポジション数 |
| `MAX_POSITION_PERCENT` | `0.20` | 1ポジション最大20% |
| `MAX_RISK_PER_TRADE` | `0.02` | 1取引最大リスク2% |
| `MAX_DAILY_LOSS_PERCENT` | `0.05` | 日次最大損失5%でストップ |
| `STOP_LOSS_PERCENT` | `0.05` | デフォルトSL5% |
| `TAKE_PROFIT_PERCENT` | `0.10` | デフォルトTP10% |
| `CONFIDENCE_THRESHOLD` | `0.65` | Claude の最小信頼度65% |
| `WATCHED_STOCKS` | `7203,6758,9984,8306,2802` | 監視銘柄リスト |

---

## システム設計

```
src/
├── index.js                      # メインエントリーポイント
├── config.js                     # 設定管理
├── api/
│   ├── data-fetcher.js           # Yahoo Finance データ取得
│   ├── anthropic-client-v2.js    # Claude AI クライアント
│   └── rakuten-client.js         # 楽天/kabu.com 証券 API ★New
├── analyzer/
│   ├── indicators.js             # テクニカル指標計算
│   └── technical-analyzer-v2.js # 高度分析（ADX/Ichimoku/Stochastic）
├── engine/
│   ├── trading-engine.js         # メイン取引エンジン ★改修
│   ├── executor.js               # 注文実行（デモ/リアル）★改修
│   ├── capital-manager.js        # 資金管理
│   ├── position-sizer-v2.js      # ポジションサイズ計算
│   └── risk-manager.js           # リスク管理
├── scanner/
│   ├── stock-scanner.js          # 銘柄スキャン ★改修（軍資金比率フィルタ）
│   ├── stock-universe.js         # 銘柄ユニバース
│   └── watchlist-manager.js     # ウォッチリスト管理
├── scheduler/
│   └── trading-scheduler.js     # Cron スケジューラー（平日15:05）
├── database/
│   ├── db-init.js                # DB 初期化（SQLite）
│   └── trade-repository.js      # DB 操作
└── utils/
    ├── logger.js                 # ログ管理（Winston）
    ├── formatter.js              # フォーマッター
    └── errors.js                 # カスタムエラー

demo-cycle.js   # デモサイクル自動実行スクリプト ★New
```

### 軍資金比率フィルタの仕組み

```
利用可能資金: ¥1,000,000

株価 ¥2,000  → 1単元(100株)=¥200,000 → 資金の20% → ✅ 理想帯(+スコアボーナス)
株価 ¥1,000  → 1単元(100株)=¥100,000 → 資金の10% → ✅ 理想帯
株価 ¥3,500  → 1単元(100株)=¥350,000 → 資金の35% → ❌ 除外（上限30%超）
株価 ¥  100  → 1単元(100株)=¥ 10,000 → 資金の 1% → ✅ 通過(ペナルティ小)
```

---

## GitHub へのアップロード

### 1. GitHub でプライベートリポジトリを作成

1. [GitHub](https://github.com) にログイン
2. 右上「+」→「New repository」
3. Repository name: `casats`（任意）
4. **「Private」を必ず選択**（API キーなど機密情報保護のため）
5. 「Create repository」をクリック

### 2. ローカルでの初期設定

```bash
# プロジェクトディレクトリへ移動
cd ~/Documents/Claude/Projects/自動株式売買ツール

# Git 初期化（未初期化の場合）
git init

# ユーザー設定（初回のみ）
git config user.name "Shuhei Kubo"
git config user.email "shuheikubo1208@gmail.com"

# 全ファイルをステージング（.gitignore が機密ファイルを除外）
git add .

# 内容確認（.env が含まれていないことを確認）
git status

# 初回コミット
git commit -m "feat: initial commit - CASATS v3.0"

# GitHub のリモートを追加（URLは自分のリポジトリに変更）
git remote add origin git@github.com:your-username/casats.git

# プッシュ
git push -u origin main
```

### 3. SSH 認証の設定（推奨）

```bash
# SSH キー生成（なければ）
ssh-keygen -t ed25519 -C "shuheikubo1208@gmail.com"

# 公開鍵を表示してコピー
cat ~/.ssh/id_ed25519.pub

# GitHub の Settings → SSH and GPG keys → New SSH key にペースト

# 接続確認
ssh -T git@github.com
# → Hi your-username! You've successfully authenticated... と表示されれば成功
```

### 4. 以後の更新手順

```bash
git add .
git commit -m "update: 〇〇を修正"
git push
```

### ⚠️ 絶対にコミットしてはいけないファイル（.gitignore で除外済み）

- `.env`（Anthropic API キー・証券 API パスワードが含まれる）
- `database/trades.db`（取引履歴）
- `node_modules/`
- `logs/`
- `venv/`

---

## ライセンス

MIT License

---

*Built with Claude Sonnet by Shuhei Kubo*
