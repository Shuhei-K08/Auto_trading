# トラブルシューティングガイド

よくある問題と解決方法です。

## インストール関連

### npm install に失敗

#### エラー: `ERR! code ERESOLVE`

```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE could not resolve dependency peer
```

**原因**: パッケージの依存関係の競合

**解決策**:
```bash
# キャッシュをクリア
npm cache clean --force

# 強制インストール
npm install --legacy-peer-deps

# または npm 7+ なら
npm install --force
```

### パッケージのバージョンエラー

#### エラー: `Node 18+ required`

```
Error: Node 18+ is required
```

**解決策**:
```bash
# Node.js のバージョン確認
node -v

# v16 以下なら更新
# https://nodejs.org/ から最新版をダウンロード

# 更新後確認
node -v
npm -v
```

### Python 仮想環境エラー

#### エラー: `venv command not found`

```
Error: venv: error: the following arguments are required: ENV_DIR
```

**解決策**:
```bash
# Python 3.8+ のインストール確認
python3 --version

# 仮想環境を再作成
python3 -m venv venv

# 有効化（Mac/Linux）
source venv/bin/activate

# 有効化（Windows）
venv\Scripts\activate
```

---

## 環境設定関連

### API キーエラー

#### エラー: `ANTHROPIC_API_KEY is not set`

```
Error: ANTHROPIC_API_KEY is not set in .env
```

**原因**: `.env` ファイルが存在しないか、API キーが設定されていない

**解決策**:
```bash
# .env ファイルを確認
cat .env

# ファイルが無い場合は作成
cp .env.example .env

# エディタで編集
nano .env

# または
vim .env
```

API キーの確認:
```bash
# キーが正しく設定されているか確認
grep ANTHROPIC_API_KEY .env
```

#### エラー: `401 Unauthorized`

```
Error: 401 Unauthorized - Invalid API key
```

**原因**: API キーが無効または期限切れ

**解決策**:
1. https://console.anthropic.com にアクセス
2. API キーを確認（生成日時など）
3. 新しいキーを生成
4. `.env` に貼り付け
5. Node.js アプリを再起動

---

## 実行エラー

### スケジューラーが実行されない

#### 問題: `毎日 15:05 に実行されない`

**原因**: 考えられる理由
- ローカルマシンがスリープ状態
- マシンが 15:05 に電源オフ
- タイムゾーン設定の不一致

**解決策**:
```bash
# タイムゾーン確認
date

# マシンをスリープさせない設定
# Mac: システム環境設定 > 省エネルギー > スリープを無効化
# Windows: 設定 > 電源とバッテリー > スリープなし

# または VPS/クラウドサーバーに配置
# AWS EC2, DigitalOcean, Heroku など
```

### スケジューラーの手動実行でテスト

```bash
# Node.js REPL で手動実行
node

> const Scheduler = (await import('./src/scheduler/trading-scheduler.js')).default;
> const scheduler = new Scheduler();
> await scheduler.manualExecute();

# または別ファイルで
# npm run manual-execute
```

---

## API エラー

### 外部 API への接続失敗

#### エラー: `ECONNREFUSED`

```
Error: connect ECONNREFUSED 127.0.0.1:8080
```

**原因**: 接続先サーバーがダウン

**解決策**:
```bash
# Yahoo Finance API の状態確認
# https://finance.yahoo.com

# Anthropic API の状態確認
# https://status.anthropic.com

# ネットワーク接続確認
ping google.com

# ファイアウォール設定確認
# ポート 443 (HTTPS) が開いているか確認
```

#### エラー: `TIMEOUT`

```
Error: Request timeout after 30000ms
```

**原因**: ネットワークが遅い、サーバーが応答していない

**解決策**:
```bash
# タイムアウト値を増やす（src/config.js で設定）
// timeout: 10000  // → 30000

# または再試行ロジックを追加
```

---

## データベースエラー

### データベース破損

#### エラー: `database disk image malformed`

```
Error: database disk image malformed
```

**原因**: DB ファイルが破損（プロセス異常終了など）

**解決策**:
```bash
# DB ファイルをバックアップ
cp database/trades.db database/trades_backup_$(date +%Y%m%d).db

# 破損したファイルを削除
rm database/trades.db

# 再初期化（自動的にテーブルが作成される）
npm start

# Ctrl+C で停止
```

### データベースロック

#### エラー: `database is locked`

```
Error: database is locked
```

**原因**: 複数のプロセスが同時にアクセス

**解決策**:
```bash
# 実行中のプロセスを確認
ps aux | grep node

# プロセスを終了
kill -9 <PID>

# DB ロックファイルを削除（存在する場合）
rm database/trades.db-journal

# 再実行
npm start
```

### テーブル作成エラー

#### エラー: `table already exists`

```
Error: table already exists
```

**原因**: テーブルが既に存在

**解決策**:
```javascript
// db-init.js で CREATE TABLE IF NOT EXISTS を使用
// これは既に実装済みなので、手動削除は不要

// もし手動で削除した場合:
// sqlite3 database/trades.db
// sqlite> DROP TABLE trades;
// sqlite> .quit
```

---

## ログ・デバッグ

### ログが出力されない

#### 問題: `logs/ ディレクトリが空`

**原因**: ログレベル設定、ディレクトリ作成失敗など

**解決策**:
```bash
# ログディレクトリを確認
ls -la logs/

# ディレクトリが無い場合は作成
mkdir -p logs

# ログレベルを確認
grep LOG_LEVEL .env

# デバッグレベルで実行
LOG_LEVEL=debug npm start
```

### ログが大きくなりすぎた

#### 問題: `ログファイルが GB を超えている`

**解決策**:
```bash
# 古いログを削除
find logs/ -mtime +30 -delete  # 30日以上前のログを削除

# または圧縮
gzip logs/*.log

# または手動で管理
rm logs/2026-01-*.log
```

---

## Streamlit UI エラー

### UI が起動しない

#### エラー: `Port 8501 already in use`

```
Error: Port 8501 already in use
```

**解決策**:
```bash
# ポートを確認
lsof -i :8501

# プロセスを終了
kill -9 <PID>

# または別ポートで起動
streamlit run streamlit_app.py --server.port 8502
```

### UI がリロードされない

#### 問題: `ダッシュボードが自動更新されていない`

**原因**: `@st.cache_data` のキャッシュが有効

**解決策**:
```bash
# キャッシュをクリア
rm -rf ~/.streamlit/cache

# または実行時に指定
streamlit run streamlit_app.py --logger.level=debug

# キャッシュ有効期限を短くする（streamlit_app.py）
# @st.cache_data(ttl=30)  # 30秒
```

### グラフが表示されない

#### 問題: `Plotly グラフが空白`

**原因**: データが無い、ライブラリエラー

**解決策**:
```bash
# Plotly を再インストール
pip install --upgrade plotly

# pandas を確認
pip show pandas

# ブラウザキャッシュをクリア
# Ctrl+Shift+Delete (Windows/Linux)
# Cmd+Shift+Delete (Mac)
```

---

## メモリ・パフォーマンス

### メモリ不足エラー

#### エラー: `JavaScript heap out of memory`

```
FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory
```

**原因**: Node.js がメモリ不足

**解決策**:
```bash
# メモリ制限を増やす
node --max-old-space-size=4096 src/index.js

# または環境変数で設定
export NODE_OPTIONS="--max-old-space-size=4096"
npm start
```

### CPU 使用率が高い

#### 問題: `システムが重い`

**原因**: 無限ループ、データ取得が多すぎるなど

**解決策**:
```bash
# CPU 使用状況を確認
top  # または Windows なら タスクマネージャ

# 監視銘柄を減らす
WATCHED_STOCKS=7203,6758  # 2銘柄のみ

# データ取得間隔を長くする
```

---

## セキュリティ

### API キーが漏洩

#### 問題: `GitHub に .env をコミットしてしまった`

**解決策**:
```bash
# 1. 新しい API キーを生成（console.anthropic.com）

# 2. git 履歴から削除
git filter-branch --tree-filter 'rm -f .env' HEAD

# 3. 強制プッシュ
git push -f origin main

# 4. コラボレータに通知して新キーを配布

# 5. 旧キーを無効化（console.anthropic.com で削除）
```

---

## 本番環境での問題

### VPS/クラウドでの実行

#### エラー: `タイムゾーンが日本時間でない`

```
# タイムゾーンが UTC の場合
```

**解決策**:
```bash
# タイムゾーン確認
date
timedatectl

# タイムゾーン設定（Linux）
sudo timedatectl set-timezone Asia/Tokyo

# または cron ジョブで対応
# TZ=Asia/Tokyo crontab -e
```

#### エラー: `PM2 でプロセス管理できない`

```
# PM2 をインストール
npm install -g pm2

# PM2 で起動
pm2 start src/index.js --name "auto-trading"

# 自動起動設定
pm2 startup
pm2 save

# ログ確認
pm2 logs auto-trading
```

---

## さらに助けが必要な場合

### リソース

- **公式ドキュメント**: https://docs.anthropic.com
- **GitHub Issues**: https://github.com/your-repo/issues
- **Stack Overflow**: tag `anthropic-api`, `node.js`

### 報告の仕方

バグを報告する際は以下の情報を含めてください：

```markdown
## 環境
- Node.js バージョン: v18.x
- npm バージョン: v9.x
- OS: macOS / Windows / Linux

## 問題
[エラーメッセージ全文]

## 再現手順
1. ...
2. ...
3. ...

## 期待される動作
[説明]

## 実際の動作
[説明]

## ログ
[ログ内容（機密情報は削除）]
```

---

[README に戻る](../README.md)
