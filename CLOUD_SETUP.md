# クラウド化セットアップガイド

GitHub Actions（毎朝自動実行）+ Neon PostgreSQL（クラウドDB）+ Streamlit Cloud（ダッシュボード）の構成です。

---

## ① Neon PostgreSQL のセットアップ（5分）

1. [https://neon.tech](https://neon.tech) でアカウント作成（GitHub ログイン可）
2. 「New Project」→ プロジェクト名: `autotrade`、リージョン: `AWS / ap-southeast-1`（東京に近い）
3. 作成後、「SQL Editor」タブを開く
4. `neon-schema.sql` の内容をコピー&ペーストして「Run」
5. 「Dashboard」→「Connection Details」→「Connection string」をコピー
   - 形式: `postgresql://user:password@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`

---

## ② GitHub リポジトリの設定（3分）

1. このプロジェクトを GitHub に push（まだなら）
2. GitHub リポジトリ → **Settings → Secrets and variables → Actions**
3. 以下の Secrets を追加：

| Secret 名 | 値 |
|---|---|
| `ANTHROPIC_API_KEY` | `.env` の `ANTHROPIC_API_KEY` の値 |
| `DATABASE_URL` | ① でコピーした Neon 接続文字列 |
| `PORTFOLIO_VALUE` | `10000`（初期資金） |
| `WATCHED_STOCKS` | `0462,9536,6138,2978,4820,5195,2002,8308` |

4. Actions タブ → 「自動株式売買ボット」→「Run workflow」で手動テスト実行

### スケジュール変更（オプション）
`.github/workflows/trading-bot.yml` の `cron` を編集します：
```yaml
- cron: '0 23 * * 0-4'  # UTC 23:00 = JST 08:00（月〜金）
```

---

## ③ Streamlit Cloud のデプロイ（5分）

1. [https://streamlit.io/cloud](https://streamlit.io/cloud) でアカウント作成（GitHub ログイン）
2. 「New app」→ GitHub リポジトリを選択
3. 設定：
   - **Main file path**: `streamlit/streamlit_app.py`
   - **Python version**: 3.11
4. 「Advanced settings」→「Secrets」に以下を追加：

```toml
DATABASE_URL = "postgresql://user:password@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
```

5. 「Deploy!」を押す

---

## 動作フロー

```
毎朝 8:00 JST
    ↓
GitHub Actions が Node.js を実行
    ↓
Yahoo Finance からリアルタイム株価取得
    ↓
Claude AI が売買判断
    ↓
advisor モード: logs/trade-report-YYYY-MM-DD.txt に記録
    ↓
結果を Neon PostgreSQL に保存
    ↓
Streamlit Cloud ダッシュボードで確認（随時）
    ↓
楽天証券アプリで手動発注
```

---

## ローカル開発（Mac）

クラウドDBに接続してローカルで動作確認できます：

```bash
# .env に DATABASE_URL を追加
echo 'DATABASE_URL=postgresql://...' >> .env

# Node.js 実行（Neon に書き込み）
node src/index.js

# Streamlit ローカル起動（Neon から読み込み）
cd streamlit && streamlit run streamlit_app.py
```

`DATABASE_URL` を設定しなければ従来通りローカル SQLite を使います。

---

## コスト

| サービス | 無料枠 |
|---|---|
| Neon PostgreSQL | 0.5 GB ストレージ、月500 compute hours（十分） |
| GitHub Actions | 月2,000分（十分） |
| Streamlit Cloud | 無料（パブリックリポジトリ） |

**合計: 完全無料** 🎉
