"""
CASATS — Claude AI Stock Auto Trading System
シンプル版ダッシュボード

ページ:
  📊 ダッシュボード    : 資産概要・保有株・含み損益
  📝 売買記録         : 手動で購入・売却を入力、損益計算
  🤖 AI分析・銘柄選定 : 手動トリガー（GitHub Actions または直接実行）
  ⚙️  設定            : 監視銘柄・メール設定
"""

import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime, date
import os

# ── PostgreSQL / SQLite 切り替え ─────────────────────────────
DATABASE_URL = os.environ.get("DATABASE_URL", "")
try:
    import psycopg2
    HAS_PG = bool(DATABASE_URL)
except ImportError:
    HAS_PG = False

try:
    import sqlite3
    HAS_SQLITE = True
except ImportError:
    HAS_SQLITE = False

# python-dotenv
try:
    from dotenv import dotenv_values, set_key
    HAS_DOTENV = True
except ImportError:
    HAS_DOTENV = False

from pathlib import Path
PROJECT_DIR = Path(__file__).parent.parent.resolve()
DB_PATH     = PROJECT_DIR / "database" / "trades.db"
ENV_PATH    = PROJECT_DIR / ".env"

# ── ページ設定 ───────────────────────────────────────────────
st.set_page_config(
    page_title="CASATS",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── パスワード認証 ───────────────────────────────────────────
def check_password():
    correct = st.secrets.get("PASSWORD", "")
    if not correct:
        return True
    if st.session_state.get("authenticated"):
        return True
    st.title("🔐 CASATS — ログイン")
    pwd = st.text_input("パスワード", type="password")
    if st.button("ログイン", type="primary"):
        if pwd == correct:
            st.session_state["authenticated"] = True
            st.rerun()
        else:
            st.error("パスワードが違います")
    return False

if not check_password():
    st.stop()

# ── CSS ─────────────────────────────────────────────────────
st.markdown("""
<style>
  .metric-card{background:#f5f8ff;border-radius:10px;padding:16px;margin:4px 0}
  .pnl-pos{color:#00aa55;font-weight:bold}
  .pnl-neg{color:#cc3333;font-weight:bold}
  .badge-buy{background:#d4edda;color:#155724;padding:2px 8px;border-radius:4px;font-size:0.85em;font-weight:bold}
  .badge-sell{background:#f8d7da;color:#721c24;padding:2px 8px;border-radius:4px;font-size:0.85em;font-weight:bold}
</style>
""", unsafe_allow_html=True)

# ── DB ヘルパー ──────────────────────────────────────────────
def is_cloud():
    return HAS_PG and bool(DATABASE_URL)

def query(sql, params=()):
    try:
        if is_cloud():
            pg_sql = sql.replace("?", "%s")
            conn = psycopg2.connect(DATABASE_URL, sslmode='require')
            df = pd.read_sql_query(pg_sql, conn, params=params if params else None)
            conn.close()
            return df
        else:
            conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            df = pd.read_sql_query(sql, conn, params=params)
            conn.close()
            return df
    except Exception as e:
        return pd.DataFrame()

def execute(sql, params=()):
    """INSERT / UPDATE / DELETE"""
    try:
        if is_cloud():
            pg_sql = sql.replace("?", "%s")
            conn = psycopg2.connect(DATABASE_URL, sslmode='require')
            cur  = conn.cursor()
            cur.execute(pg_sql, params)
            conn.commit()
            lastid = cur.fetchone()[0] if cur.description else None
            conn.close()
            return lastid
        else:
            conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            cur  = conn.cursor()
            cur.execute(sql, params)
            conn.commit()
            lastid = cur.lastrowid
            conn.close()
            return lastid
    except Exception as e:
        st.error(f"DB エラー: {e}")
        return None

def db_ok():
    if is_cloud():
        try:
            conn = psycopg2.connect(DATABASE_URL, sslmode='require')
            conn.close()
            return True
        except:
            return False
    return DB_PATH.exists()

# ── Yahoo Finance 現在株価取得 ───────────────────────────────
@st.cache_data(ttl=300)
def get_current_price(symbol: str) -> float | None:
    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{symbol}.T")
        info = ticker.fast_info
        return float(info.last_price)
    except:
        return None

# ── キャッシュ付きデータ取得 ─────────────────────────────────
@st.cache_data(ttl=60)
def get_portfolio():
    df = query("SELECT * FROM portfolio ORDER BY date DESC LIMIT 1")
    return df.iloc[0].to_dict() if not df.empty else {}

@st.cache_data(ttl=60)
def get_open_positions():
    return query("SELECT * FROM positions WHERE status IN ('holding','open') ORDER BY entry_date DESC")

@st.cache_data(ttl=60)
def get_closed_positions(limit=50):
    return query(f"SELECT * FROM positions WHERE status='closed' ORDER BY exit_date DESC LIMIT {limit}")

@st.cache_data(ttl=60)
def get_recent_trades(limit=30):
    return query(f"SELECT * FROM trades ORDER BY timestamp DESC LIMIT {limit}")

@st.cache_data(ttl=60)
def get_watchlist():
    return query("SELECT * FROM watchlist WHERE is_active=1 ORDER BY rank ASC")

@st.cache_data(ttl=300)
def get_portfolio_history(days=60):
    df = query(f"SELECT * FROM portfolio ORDER BY date DESC LIMIT {days}")
    return df.sort_values('date') if not df.empty else df

def load_env():
    if not ENV_PATH.exists(): return {}
    if HAS_DOTENV: return dict(dotenv_values(str(ENV_PATH)))
    result = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                result[k.strip()] = v.strip().strip('"').strip("'")
    return result

def save_env_key(key, value):
    if HAS_DOTENV and ENV_PATH.exists():
        set_key(str(ENV_PATH), key, str(value))

# ── サイドバー ───────────────────────────────────────────────
with st.sidebar:
    st.title("📈 CASATS")
    if is_cloud():
        st.caption("🌐 クラウドモード（Neon DB）")
    else:
        st.caption("💻 ローカルモード（SQLite）")

    page = st.radio("", [
        "📊 ダッシュボード",
        "📝 売買記録",
        "🤖 AI分析・銘柄選定",
        "⚙️ 設定",
    ], label_visibility="collapsed")

    st.divider()
    port = get_portfolio()
    if port:
        cap = port.get('current_capital', 0)
        cash = port.get('available_cash', 0)
        ratio = (1 - cash / cap) * 100 if cap > 0 else 0
        st.metric("総資産", f"¥{cap:,.0f}")
        st.metric("余力", f"¥{cash:,.0f}")
        st.caption(f"株式投資比率: {ratio:.1f}%")

    st.divider()
    if st.button("🔄 データ更新", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

# ══════════════════════════════════════════════════════════════
# PAGE: 📊 ダッシュボード
# ══════════════════════════════════════════════════════════════
if page == "📊 ダッシュボード":
    st.title("📊 ダッシュボード")

    if not db_ok():
        st.warning("データベースに接続できません。設定を確認してください。")
        st.stop()

    # ── 資産サマリー ──────────────────────────────────────────
    port = get_portfolio()
    if port:
        c1, c2, c3, c4 = st.columns(4)
        cap      = port.get('current_capital', 0)
        cash     = port.get('available_cash', 0)
        invested = port.get('invested_stocks', 0)
        gains    = port.get('total_gains', 0)
        c1.metric("総資産",     f"¥{cap:,.0f}")
        c2.metric("余力（現金）", f"¥{cash:,.0f}")
        c3.metric("株式評価額",  f"¥{invested:,.0f}")
        c4.metric("累計損益",    f"¥{gains:,.0f}", delta=f"¥{gains:,.0f}")
    else:
        st.info("ポートフォリオデータがまだありません。")

    st.divider()

    # ── 保有ポジション ────────────────────────────────────────
    st.subheader("📂 保有中ポジション")
    pos_df = get_open_positions()

    if pos_df.empty:
        st.info("現在保有しているポジションはありません。")
    else:
        total_unrealized = 0
        for _, row in pos_df.iterrows():
            sym      = row.get('symbol', '')
            qty      = int(row.get('quantity', 0))
            entry    = float(row.get('entry_price', 0))
            current  = float(row.get('current_price') or entry)
            unr_pnl  = float(row.get('unrealized_pnl') or (current - entry) * qty)
            unr_pct  = float(row.get('unrealized_pnl_percent') or ((current - entry) / entry * 100 if entry else 0))
            total_unrealized += unr_pnl

            pnl_color = "pnl-pos" if unr_pnl >= 0 else "pnl-neg"
            sign      = "+" if unr_pnl >= 0 else ""

            with st.container(border=True):
                cc1, cc2, cc3, cc4, cc5 = st.columns([2, 1, 2, 2, 2])
                cc1.markdown(f"**{sym}**")
                cc2.write(f"{qty}株")
                cc3.write(f"取得: ¥{entry:,.0f}")
                cc4.write(f"現在: ¥{current:,.0f}")
                cc5.markdown(
                    f'<span class="{pnl_color}">{sign}¥{unr_pnl:,.0f}（{sign}{unr_pct:.2f}%）</span>',
                    unsafe_allow_html=True
                )

        st.caption(f"含み損益合計: {'+'if total_unrealized>=0 else ''}¥{total_unrealized:,.0f}")

    st.divider()

    # ── 資産推移グラフ ────────────────────────────────────────
    st.subheader("📈 資産推移")
    hist_df = get_portfolio_history()
    if not hist_df.empty and 'current_capital' in hist_df.columns:
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=hist_df['date'], y=hist_df['current_capital'],
            mode='lines+markers', name='総資産',
            line=dict(color='#4f8ef7', width=2),
            fill='tozeroy', fillcolor='rgba(79,142,247,0.08)'
        ))
        if 'available_cash' in hist_df.columns:
            fig.add_trace(go.Scatter(
                x=hist_df['date'], y=hist_df['available_cash'],
                mode='lines', name='余力',
                line=dict(color='#aaa', width=1, dash='dash')
            ))
        fig.update_layout(height=280, margin=dict(l=0, r=0, t=10, b=0),
                          legend=dict(orientation='h'))
        st.plotly_chart(fig, use_container_width=True)
    else:
        st.caption("資産推移データがまだありません。")

    st.divider()

    # ── 直近の決済履歴 ────────────────────────────────────────
    st.subheader("📋 直近の決済履歴")
    closed_df = get_closed_positions(20)
    if closed_df.empty:
        st.info("決済済みのポジションはありません。")
    else:
        disp = closed_df[['symbol','quantity','entry_price','exit_price','realized_pnl','realized_pnl_percent','exit_date','exit_reason']].copy()
        disp.columns = ['銘柄','株数','取得値','売却値','損益(¥)','損益(%)','決済日','理由']
        disp['損益(¥)']  = disp['損益(¥)'].apply(lambda x: f"+¥{x:,.0f}" if (x or 0) >= 0 else f"-¥{abs(x or 0):,.0f}")
        disp['損益(%)']  = disp['損益(%)'].apply(lambda x: f"+{x:.2f}%" if (x or 0) >= 0 else f"{x:.2f}%")
        st.dataframe(disp, use_container_width=True, hide_index=True)


# ══════════════════════════════════════════════════════════════
# PAGE: 📝 売買記録
# ══════════════════════════════════════════════════════════════
elif page == "📝 売買記録":
    st.title("📝 売買記録")
    st.caption("楽天証券で実際に発注した内容をここに記録してください。損益は自動計算されます。")

    tab_buy, tab_sell, tab_update = st.tabs(["🟢 購入を記録", "🔴 売却を記録", "🔄 現在値を更新"])

    # ── 購入記録 ──────────────────────────────────────────────
    with tab_buy:
        st.subheader("購入を記録する")
        with st.form("form_buy", clear_on_submit=True):
            c1, c2 = st.columns(2)
            symbol   = c1.text_input("銘柄コード（例: 7203）").strip()
            qty      = c2.number_input("購入株数", min_value=1, step=1, value=1)
            c3, c4 = st.columns(2)
            price    = c3.number_input("購入単価（¥）", min_value=1.0, step=1.0, value=1000.0)
            edate    = c4.date_input("購入日", value=date.today())
            c5, c6 = st.columns(2)
            sl_price = c5.number_input("損切り価格（¥）", min_value=0.0, step=1.0, value=0.0)
            tp_price = c6.number_input("利確価格（¥）", min_value=0.0, step=1.0, value=0.0)
            note     = st.text_area("メモ（任意）", height=60)
            submitted = st.form_submit_button("✅ 購入を記録する", type="primary", use_container_width=True)

        if submitted:
            if not symbol:
                st.error("銘柄コードを入力してください。")
            else:
                total = qty * price
                if is_cloud():
                    sql = """INSERT INTO positions
                        (symbol, quantity, entry_price, entry_date, stop_loss_price, take_profit_price, status, current_price)
                        VALUES (?, ?, ?, ?, ?, ?, 'holding', ?)
                        RETURNING id"""
                else:
                    sql = """INSERT INTO positions
                        (symbol, quantity, entry_price, entry_date, stop_loss_price, take_profit_price, status, current_price)
                        VALUES (?, ?, ?, ?, ?, ?, 'holding', ?)"""
                execute(sql, (
                    symbol, qty, price, edate.isoformat(),
                    sl_price if sl_price > 0 else None,
                    tp_price if tp_price > 0 else None,
                    price
                ))
                # trades テーブルにも記録
                execute(
                    "INSERT INTO trades (symbol, decision, entry_price, quantity, confidence, reasoning, status, timestamp) VALUES (?, 'BUY', ?, ?, 1.0, ?, 'filled', ?)",
                    (symbol, price, qty, note or f"手動購入 {qty}株 @¥{price:,.0f}", datetime.now().isoformat())
                )
                st.cache_data.clear()
                st.success(f"✅ {symbol} {qty}株 @¥{price:,.0f} を記録しました（合計 ¥{total:,.0f}）")
                st.balloons()

    # ── 売却記録 ──────────────────────────────────────────────
    with tab_sell:
        st.subheader("売却を記録する")
        pos_df = get_open_positions()

        if pos_df.empty:
            st.info("現在保有中のポジションがありません。")
        else:
            # 選択肢を作成
            options = {
                f"{row['symbol']}  {int(row['quantity'])}株 @¥{float(row['entry_price']):,.0f}（保有中）": row
                for _, row in pos_df.iterrows()
            }
            selected_label = st.selectbox("売却するポジションを選択", list(options.keys()))
            selected_pos   = options[selected_label]

            entry_p = float(selected_pos['entry_price'])
            qty_max = int(selected_pos['quantity'])

            with st.form("form_sell", clear_on_submit=True):
                c1, c2 = st.columns(2)
                sell_qty   = c1.number_input("売却株数", min_value=1, max_value=qty_max, step=1, value=qty_max)
                sell_price = c2.number_input("売却単価（¥）", min_value=1.0, step=1.0, value=entry_p)
                sell_date  = st.date_input("売却日", value=date.today())
                sell_reason = st.selectbox("売却理由", ["利益確定", "損切り", "定期見直し", "その他"])
                note        = st.text_area("メモ（任意）", height=60)
                submitted_sell = st.form_submit_button("✅ 売却を記録する", type="primary", use_container_width=True)

            if submitted_sell:
                pnl      = (sell_price - entry_p) * sell_qty
                pnl_pct  = (sell_price - entry_p) / entry_p * 100 if entry_p else 0
                sign     = "+" if pnl >= 0 else ""
                pos_id   = int(selected_pos['id'])

                if sell_qty == qty_max:
                    # 全量売却 → クローズ
                    execute(
                        """UPDATE positions SET status='closed', exit_price=?, exit_date=?,
                           exit_reason=?, realized_pnl=?, realized_pnl_percent=?, current_price=?
                           WHERE id=?""",
                        (sell_price, sell_date.isoformat(), sell_reason, pnl, pnl_pct, sell_price, pos_id)
                    )
                else:
                    # 一部売却 → 数量を減らす＋新規決済レコード
                    execute("UPDATE positions SET quantity=? WHERE id=?", (qty_max - sell_qty, pos_id))
                    execute(
                        """INSERT INTO positions
                           (symbol, quantity, entry_price, entry_date, exit_price, exit_date,
                            exit_reason, realized_pnl, realized_pnl_percent, status)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed')""",
                        (selected_pos['symbol'], sell_qty, entry_p,
                         selected_pos['entry_date'], sell_price,
                         sell_date.isoformat(), sell_reason, pnl, pnl_pct)
                    )

                st.cache_data.clear()
                st.success(
                    f"✅ {selected_pos['symbol']} {sell_qty}株 @¥{sell_price:,.0f} を売却記録しました\n\n"
                    f"損益: {sign}¥{pnl:,.0f}（{sign}{pnl_pct:.2f}%）"
                )
                if pnl >= 0:
                    st.balloons()

    # ── 現在値を手動更新 ──────────────────────────────────────
    with tab_update:
        st.subheader("保有株の現在値を更新する")
        st.caption("Yahoo Finance から自動取得します。取得できない場合は手動で入力してください。")

        pos_df2 = get_open_positions()
        if pos_df2.empty:
            st.info("保有中のポジションがありません。")
        else:
            if st.button("🔄 Yahoo Finance から一括取得", type="primary"):
                updated = 0
                with st.spinner("株価を取得中..."):
                    for _, row in pos_df2.iterrows():
                        sym   = row['symbol']
                        price = get_current_price(sym)
                        if price:
                            entry = float(row['entry_price'])
                            qty   = int(row['quantity'])
                            pnl   = (price - entry) * qty
                            pct   = (price - entry) / entry * 100
                            execute(
                                "UPDATE positions SET current_price=?, unrealized_pnl=?, unrealized_pnl_percent=? WHERE id=?",
                                (price, pnl, pct, int(row['id']))
                            )
                            updated += 1
                st.cache_data.clear()
                st.success(f"{updated} 銘柄の現在値を更新しました。")

            st.write("")
            st.caption("手動で個別入力する場合：")
            for _, row in pos_df2.iterrows():
                with st.form(f"update_{row['id']}", clear_on_submit=False):
                    sym   = row['symbol']
                    entry = float(row['entry_price'])
                    cur   = float(row.get('current_price') or entry)
                    c1, c2, c3 = st.columns([2, 2, 1])
                    c1.write(f"**{sym}**  取得: ¥{entry:,.0f}")
                    new_price = c2.number_input("現在値（¥）", value=cur, min_value=1.0, step=1.0, key=f"np_{row['id']}", label_visibility="collapsed")
                    save_btn  = c3.form_submit_button("更新")
                    if save_btn:
                        qty = int(row['quantity'])
                        pnl = (new_price - entry) * qty
                        pct = (new_price - entry) / entry * 100
                        execute(
                            "UPDATE positions SET current_price=?, unrealized_pnl=?, unrealized_pnl_percent=? WHERE id=?",
                            (new_price, pnl, pct, int(row['id']))
                        )
                        st.cache_data.clear()
                        st.rerun()


# ══════════════════════════════════════════════════════════════
# PAGE: 🤖 AI分析・銘柄選定
# ══════════════════════════════════════════════════════════════
elif page == "🤖 AI分析・銘柄選定":
    st.title("🤖 AI分析・銘柄選定")

    # ── GitHub Actions ヘルパー関数 ──────────────────────────
    import urllib.request, json as _json

    def _github_request(method, path, payload=None):
        token = st.secrets.get("GITHUB_TOKEN", "")
        repo  = st.secrets.get("GITHUB_REPO", "")
        if not token or not repo:
            return None, "GITHUB_TOKEN / GITHUB_REPO が Secrets に未設定"
        url = f"https://api.github.com/repos/{repo}{path}"
        req = urllib.request.Request(url, data=_json.dumps(payload).encode() if payload else None, method=method)
        req.add_header("Authorization", f"token {token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return _json.loads(r.read()), None
        except urllib.error.HTTPError as e:
            if e.code == 204:   # dispatches は 204 No Content で成功
                return {}, None
            return None, f"HTTP {e.code}: {e.reason}"
        except Exception as e:
            return None, str(e)

    def trigger_github_workflow(workflow_file):
        _, err = _github_request("POST", f"/actions/workflows/{workflow_file}/dispatches", {"ref": "main"})
        if err:
            return False, f"❌ 起動失敗: {err}"
        return True, "✅ GitHub Actions を起動しました（数秒後にステータスが更新されます）"

    def get_workflow_status(workflow_file):
        """最新の実行ステータスを取得"""
        data, err = _github_request("GET", f"/actions/workflows/{workflow_file}/runs?per_page=1")
        if err or not data:
            return None
        runs = data.get("workflow_runs", [])
        return runs[0] if runs else None

    def render_status_badge(run):
        """ステータスバッジを表示"""
        if not run:
            return
        status     = run.get("status", "")
        conclusion = run.get("conclusion", "")
        updated    = run.get("updated_at", "")[:16].replace("T", " ")
        url        = run.get("html_url", "#")

        if status == "in_progress" or status == "queued":
            st.info(f"⏳ **実行中...** （開始: {updated} UTC）　[ログを見る]({url})")
        elif conclusion == "success":
            st.success(f"✅ **完了** （{updated} UTC）　[ログを見る]({url})")
        elif conclusion == "failure":
            st.error(f"❌ **失敗** （{updated} UTC）　[ログを見る]({url})")
        elif conclusion == "cancelled":
            st.warning(f"⚠️ **キャンセル** （{updated} UTC）　[ログを見る]({url})")
        else:
            st.caption(f"ステータス: {status} / {conclusion}　[ログを見る]({url})")

    # ── 毎日の AI 分析 ────────────────────────────────────────
    with st.container(border=True):
        st.subheader("📊 売買分析を実行")
        st.caption("監視銘柄に対して Claude AI がテクニカル分析を実行し、売買推奨を出力します。")
        col1, col2 = st.columns([2, 1])
        with col1:
            st.caption("毎営業日 15:05 JST に自動実行。今すぐ手動実行する場合はボタンを押してください。")
        with col2:
            if st.button("▶ 今すぐ実行", type="primary", use_container_width=True, key="run_trading"):
                ok, msg = trigger_github_workflow("trading-bot.yml")
                if ok:
                    st.success(msg)
                else:
                    st.error(msg)
        render_status_badge(get_workflow_status("trading-bot.yml"))

    st.divider()

    # ── 月次銘柄選定 ─────────────────────────────────────────
    with st.container(border=True):
        st.subheader("📡 銘柄選定を実行")
        st.caption(
            "東証上場銘柄から200社をサンプリングし、テクニカルスコアで上位8銘柄を選定します。  \n"
            "月1〜2回の実行を推奨します。"
        )
        col1, col2 = st.columns([2, 1])
        with col2:
            if st.button("▶ 今すぐ実行", type="primary", use_container_width=True, key="run_scan"):
                ok, msg = trigger_github_workflow("watchlist-scan.yml")
                if ok:
                    st.success(msg)
                else:
                    st.error(msg)
        render_status_badge(get_workflow_status("watchlist-scan.yml"))

        # 現在のウォッチリスト表示
        wl = get_watchlist()
        if not wl.empty:
            st.write("**現在の監視銘柄：**")
            for _, row in wl.iterrows():
                sig   = row.get('signal', 'HOLD')
                score = row.get('technical_score', 0) or 0
                icon  = "🟢" if sig == "BUY" else "🔴" if sig == "SELL" else "🟡"
                name  = row.get('name') or row['symbol']
                st.write(f"{icon} **{row['symbol']}** {name}　スコア: {score}pt")
        else:
            st.info("ウォッチリストはまだありません。")

    st.divider()

    # ── 直近の AI 判断ログ ────────────────────────────────────
    st.subheader("📋 直近の AI 判断ログ")
    trades_df = get_recent_trades(20)
    if trades_df.empty:
        st.info("まだ分析結果がありません。")
    else:
        def to_jst(ts_str):
            try:
                from datetime import timezone, timedelta
                JST = timezone(timedelta(hours=9))
                ts_str = str(ts_str).strip()
                # タイムゾーン情報を除いて parse
                ts_str_clean = ts_str.replace('Z', '+00:00')
                dt = datetime.fromisoformat(ts_str_clean)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                return dt.astimezone(JST).strftime('%Y-%m-%d %H:%M')
            except Exception:
                return str(ts_str)[:16]

        for _, row in trades_df.iterrows():
            decision = row.get('decision', '')
            badge = "badge-buy" if decision == "BUY" else "badge-sell"
            ts    = to_jst(row.get('timestamp', ''))
            with st.expander(f"{ts}　{row.get('symbol','')}　{'🟢 BUY' if decision=='BUY' else '🔴 SELL'}"):
                st.write(f"**単価:** ¥{float(row.get('entry_price') or 0):,.0f}　**株数:** {row.get('quantity',0)}株")
                st.write(f"**信頼度:** {float(row.get('confidence') or 0)*100:.0f}%")
                if row.get('reasoning'):
                    st.caption(row['reasoning'][:300])


# ══════════════════════════════════════════════════════════════
# PAGE: ⚙️ 設定
# ══════════════════════════════════════════════════════════════
elif page == "⚙️ 設定":
    st.title("⚙️ 設定")

    # ── 監視銘柄 ──────────────────────────────────────────────
    with st.container(border=True):
        st.subheader("📡 監視銘柄")
        env = load_env()
        current_stocks = env.get('WATCHED_STOCKS', '9536,6138,2978,4820,5195,2002,8308')

        new_stocks = st.text_area(
            "監視銘柄（カンマ区切り）",
            value=current_stocks,
            height=80,
            help="銘柄コードをカンマで区切って入力（例: 7203,6758,9984）"
        )
        if st.button("💾 監視銘柄を保存", type="primary"):
            # ローカルの .env を更新
            save_env_key('WATCHED_STOCKS', new_stocks.strip())
            # GitHub Secrets への反映案内
            st.success("✅ ローカルの .env を更新しました。")
            st.info(
                "GitHub Actions に反映するには、以下の Secret も更新してください：  \n"
                "https://github.com/Shuhei-K08/Auto_trading/settings/secrets/actions  \n"
                "→ `WATCHED_STOCKS` を更新"
            )

    st.divider()

    # ── 取引設定 ──────────────────────────────────────────────
    with st.container(border=True):
        st.subheader("⚙️ 取引設定")
        env = load_env()
        col1, col2 = st.columns(2)
        confidence = col1.slider(
            "AI信頼度しきい値（%）",
            min_value=50, max_value=90,
            value=int(float(env.get('CONFIDENCE_THRESHOLD', 0.60)) * 100)
        )
        sl = col1.number_input("損切り（%）", value=float(env.get('STOP_LOSS_PERCENT', 0.05)) * 100, step=0.5)
        tp = col2.number_input("利確（%）",  value=float(env.get('TAKE_PROFIT_PERCENT', 0.10)) * 100, step=0.5)

        if st.button("💾 取引設定を保存"):
            save_env_key('CONFIDENCE_THRESHOLD', str(confidence / 100))
            save_env_key('STOP_LOSS_PERCENT', str(sl / 100))
            save_env_key('TAKE_PROFIT_PERCENT', str(tp / 100))
            st.success("✅ 保存しました。")

    st.divider()

    # ── 軍資金リセット ────────────────────────────────────────
    with st.container(border=True):
        st.subheader("💴 軍資金をリセット")
        st.caption("⚠️ 現在の資産・損益がすべてリセットされます。保有ポジションは手動で売却記録を入力してください。")
        new_capital = st.number_input(
            "新しい軍資金（¥）",
            min_value=1000,
            step=1000,
            value=int(env.get('PORTFOLIO_VALUE', 10000)),
        )
        if st.button("🔄 この金額でリセットする", type="primary"):
            today = date.today().isoformat()
            # 既存レコードを削除して新規挿入
            execute("DELETE FROM portfolio")
            execute(
                """INSERT INTO portfolio
                   (date, initial_capital, current_capital, available_cash,
                    invested_stocks, deposits, withdrawals, total_gains, monthly_gains)
                   VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0)""",
                (today, new_capital, new_capital, new_capital)
            )
            save_env_key('PORTFOLIO_VALUE', str(int(new_capital)))
            st.cache_data.clear()
            st.success(f"✅ 軍資金を ¥{new_capital:,} にリセットしました。")

    st.divider()

    # ── DB情報 ────────────────────────────────────────────────
    with st.container(border=True):
        st.subheader("🗄️ データベース情報")
        if is_cloud():
            st.success("✅ Neon PostgreSQL（クラウド）に接続中")
            st.caption(f"接続先: {DATABASE_URL[:40]}...")
        else:
            if DB_PATH.exists():
                st.success(f"✅ SQLite（ローカル）: {DB_PATH}")
            else:
                st.error("❌ データベースファイルが見つかりません")
