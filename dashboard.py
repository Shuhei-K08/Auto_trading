"""
自動株式売買ツール - 判断結果ダッシュボード
Streamlit でリアルタイム表示
"""

import sqlite3
import os
import json
import pandas as pd
import streamlit as st
from datetime import datetime, timedelta
import time

# ─── DB パス ──────────────────────────────────
DB_PATH = os.path.join(os.path.dirname(__file__), "database", "trades.db")

# ─── ページ設定 ───────────────────────────────
st.set_page_config(
    page_title="株式自動売買 ダッシュボード",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ─── CSS ─────────────────────────────────────
st.markdown("""
<style>
  .metric-card {
    background: #1e2130;
    border-radius: 10px;
    padding: 16px 20px;
    margin: 4px 0;
  }
  .buy-badge  { color: #00cc88; font-weight: bold; font-size: 1.1em; }
  .sell-badge { color: #ff4b4b; font-weight: bold; font-size: 1.1em; }
  .hold-badge { color: #ffa500; font-weight: bold; font-size: 1.1em; }
  .section-title { font-size: 1.2em; font-weight: bold; margin-top: 1rem; margin-bottom: 0.4rem; }
  .small-muted { color: #888; font-size: 0.85em; }
</style>
""", unsafe_allow_html=True)

# ─── DB 読み込み関数 ──────────────────────────
def get_connection():
    if not os.path.exists(DB_PATH):
        return None
    return sqlite3.connect(DB_PATH, check_same_thread=False)

def load_trades(limit=50):
    conn = get_connection()
    if conn is None:
        return pd.DataFrame()
    try:
        df = pd.read_sql_query(
            f"""
            SELECT id, symbol, decision, entry_price, quantity, confidence,
                   reasoning, status, exit_price, pnl, timestamp
            FROM trades
            ORDER BY timestamp DESC
            LIMIT {limit}
            """,
            conn,
        )
        conn.close()
        return df
    except Exception:
        conn.close()
        return pd.DataFrame()

def load_positions():
    conn = get_connection()
    if conn is None:
        return pd.DataFrame()
    try:
        df = pd.read_sql_query(
            """
            SELECT symbol, quantity, entry_price, entry_date,
                   current_price, unrealized_pnl, status,
                   stop_loss_price, take_profit_price, created_at
            FROM positions
            WHERE status = 'open'
            ORDER BY created_at DESC
            """,
            conn,
        )
        conn.close()
        return df
    except Exception:
        conn.close()
        return pd.DataFrame()

def load_portfolio():
    conn = get_connection()
    if conn is None:
        return None
    try:
        row = pd.read_sql_query(
            "SELECT * FROM portfolio ORDER BY date DESC LIMIT 1", conn
        )
        conn.close()
        return row.iloc[0] if not row.empty else None
    except Exception:
        conn.close()
        return None

def load_daily_summary(days=30):
    conn = get_connection()
    if conn is None:
        return pd.DataFrame()
    try:
        df = pd.read_sql_query(
            f"""
            SELECT date, trades_count, buy_count, sell_count,
                   win_count, loss_count, daily_gains, win_rate,
                   capital_start, capital_end
            FROM daily_summary
            ORDER BY date DESC
            LIMIT {days}
            """,
            conn,
        )
        conn.close()
        return df
    except Exception:
        conn.close()
        return pd.DataFrame()

# ─── ヘルパー ──────────────────────────────────
def badge(decision):
    cls = {"BUY": "buy-badge", "SELL": "sell-badge"}.get(decision, "hold-badge")
    return f'<span class="{cls}">{decision}</span>'

def fmt_pnl(val):
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return "—"
    color = "#00cc88" if val >= 0 else "#ff4b4b"
    sign = "+" if val >= 0 else ""
    return f'<span style="color:{color}">{sign}¥{val:,.0f}</span>'

def fmt_conf(val):
    if val is None:
        return "—"
    pct = val * 100 if val <= 1 else val
    color = "#00cc88" if pct >= 75 else "#ffa500" if pct >= 65 else "#ff4b4b"
    return f'<span style="color:{color}">{pct:.1f}%</span>'

# ─── タイトル ─────────────────────────────────
st.title("📈 株式自動売買 ダッシュボード")
st.caption(f"最終更新: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

# DB が存在しない場合の警告
if not os.path.exists(DB_PATH):
    st.warning(f"⚠ データベースが見つかりません: `{DB_PATH}`\nまず `node manual-trade.js` を実行してください。")
    st.stop()

# ─── ポートフォリオ サマリー ──────────────────
portfolio = load_portfolio()
col1, col2, col3, col4 = st.columns(4)

if portfolio is not None:
    initial = portfolio.get("initial_capital", 1_000_000) or 1_000_000
    current = portfolio.get("current_capital", initial)
    available = portfolio.get("available_cash", current)
    total_gain = current - initial

    col1.metric("💴 現在資産", f"¥{current:,.0f}", f"{'+' if total_gain >= 0 else ''}¥{total_gain:,.0f}")
    col2.metric("💰 利用可能現金", f"¥{available:,.0f}")
    gain_pct = (total_gain / initial * 100) if initial else 0
    col3.metric("📊 総収益率", f"{gain_pct:+.2f}%")
    invested = current - available
    col4.metric("📦 投資中", f"¥{invested:,.0f}")
else:
    st.info("ポートフォリオデータがまだありません。")

st.divider()

# ─── タブ ─────────────────────────────────────
tab1, tab2, tab3, tab4 = st.tabs(["🤖 直近の判断", "📂 保有ポジション", "📅 日別サマリー", "📊 パフォーマンス"])

# ─── Tab1: 直近の判断結果 ─────────────────────
with tab1:
    st.markdown('<div class="section-title">直近 50 件の AI 判断結果</div>', unsafe_allow_html=True)

    trades_df = load_trades(50)
    if trades_df.empty:
        st.info("まだ取引データがありません。`node manual-trade.js` を実行してください。")
    else:
        # フィルター
        filter_col1, filter_col2, filter_col3 = st.columns([2, 2, 2])
        with filter_col1:
            decision_filter = st.multiselect(
                "判断でフィルター", ["BUY", "SELL", "HOLD"], default=["BUY", "SELL", "HOLD"]
            )
        with filter_col2:
            symbol_opts = ["全銘柄"] + sorted(trades_df["symbol"].unique().tolist())
            symbol_filter = st.selectbox("銘柄でフィルター", symbol_opts)
        with filter_col3:
            min_conf = st.slider("最低信頼度 (%)", 0, 100, 0)

        # フィルタリング
        filtered = trades_df[trades_df["decision"].isin(decision_filter)]
        if symbol_filter != "全銘柄":
            filtered = filtered[filtered["symbol"] == symbol_filter]
        filtered = filtered[filtered["confidence"] * 100 >= min_conf]

        st.caption(f"{len(filtered)} 件表示中")

        # テーブル表示
        for _, row in filtered.iterrows():
            with st.container():
                r1, r2, r3, r4, r5, r6 = st.columns([1, 1.2, 1, 1, 1, 2.5])
                r1.markdown(
                    f"<span class='small-muted'>{str(row['timestamp'])[:16]}</span>",
                    unsafe_allow_html=True,
                )
                r2.markdown(f"**{row['symbol']}**")
                r3.markdown(badge(row["decision"]), unsafe_allow_html=True)
                r4.markdown(fmt_conf(row["confidence"]), unsafe_allow_html=True)
                r5.markdown(f"¥{row['entry_price']:,.0f} × {int(row['quantity'])}株")

                # reasoning の表示（JSON 文字列 or テキスト）
                reasoning_text = row.get("reasoning", "") or ""
                try:
                    rj = json.loads(reasoning_text)
                    disp = rj.get("considerations") or rj.get("whyBuy") or rj.get("whySell") or str(rj)
                except Exception:
                    disp = str(reasoning_text)[:120]
                r6.markdown(
                    f"<span class='small-muted'>{disp[:100]}</span>",
                    unsafe_allow_html=True,
                )

            # PnL（決済済みの場合）
            if row.get("pnl") is not None and not pd.isna(row["pnl"]):
                st.markdown(
                    f"&nbsp;&nbsp;&nbsp;損益: {fmt_pnl(row['pnl'])} | 決済価格: ¥{row['exit_price']:,.0f}",
                    unsafe_allow_html=True,
                )

            st.markdown('<hr style="margin:4px 0; border-color:#333">', unsafe_allow_html=True)

# ─── Tab2: 保有ポジション ─────────────────────
with tab2:
    st.markdown('<div class="section-title">現在の保有ポジション</div>', unsafe_allow_html=True)

    pos_df = load_positions()
    if pos_df.empty:
        st.info("現在、保有ポジションはありません。")
    else:
        for _, row in pos_df.iterrows():
            entry = row["entry_price"]
            current_p = row.get("current_price") or entry
            upnl = row.get("unrealized_pnl") or ((current_p - entry) * row["quantity"])
            upnl_pct = ((current_p - entry) / entry * 100) if entry else 0

            with st.expander(f"**{row['symbol']}** — {int(row['quantity'])}株 @ ¥{entry:,.0f}"):
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("エントリー価格", f"¥{entry:,.0f}")
                c2.metric("現在価格", f"¥{current_p:,.0f}")
                c3.metric("含み損益", f"¥{upnl:+,.0f}", f"{upnl_pct:+.2f}%")
                c4.metric("エントリー日", str(row.get("entry_date", "—"))[:10])

                sl = row.get("stop_loss_price")
                tp = row.get("take_profit_price")
                if sl:
                    st.markdown(f"🔴 ストップロス: **¥{sl:,.0f}** &nbsp;&nbsp; 🟢 テイクプロフィット: **¥{(tp or 0):,.0f}**", unsafe_allow_html=True)

# ─── Tab3: 日別サマリー ────────────────────────
with tab3:
    st.markdown('<div class="section-title">日別サマリー（直近30日）</div>', unsafe_allow_html=True)

    ds_df = load_daily_summary(30)
    if ds_df.empty:
        st.info("日別サマリーデータがまだありません。")
    else:
        ds_df = ds_df.sort_values("date")
        # 表示用カラム整理
        display_df = ds_df.copy()
        display_df["daily_gains"] = display_df["daily_gains"].apply(
            lambda v: f"+¥{v:,.0f}" if (v or 0) >= 0 else f"¥{v:,.0f}"
        )
        display_df["win_rate"] = display_df["win_rate"].apply(
            lambda v: f"{(v or 0)*100:.1f}%" if v is not None and v <= 1 else f"{v or 0:.1f}%"
        )
        display_df.columns = ["日付", "取引数", "買い", "売り", "勝ち", "負け", "日次損益", "勝率", "資産(始)", "資産(終)"]
        st.dataframe(display_df, use_container_width=True, hide_index=True)

        # 日次損益チャート
        st.markdown("#### 日次損益推移")
        chart_df = ds_df[["date", "daily_gains"]].copy()
        chart_df["daily_gains"] = pd.to_numeric(chart_df["daily_gains"], errors="coerce").fillna(0)
        chart_df = chart_df.rename(columns={"date": "日付", "daily_gains": "日次損益"}).set_index("日付")
        st.bar_chart(chart_df)

# ─── Tab4: パフォーマンス ─────────────────────
with tab4:
    st.markdown('<div class="section-title">パフォーマンス分析</div>', unsafe_allow_html=True)

    all_trades = load_trades(500)
    if all_trades.empty:
        st.info("取引データがありません。")
    else:
        closed = all_trades[all_trades["status"] == "closed"].copy()
        total_trades = len(all_trades)
        total_closed = len(closed)

        col_a, col_b, col_c, col_d = st.columns(4)
        col_a.metric("総判断回数", total_trades)
        col_b.metric("決済済み", total_closed)

        if total_closed > 0:
            wins = closed[closed["pnl"] > 0]
            losses = closed[closed["pnl"] <= 0]
            win_rate = len(wins) / total_closed * 100
            total_pnl = closed["pnl"].sum()
            col_c.metric("勝率", f"{win_rate:.1f}%")
            col_d.metric("総損益", f"¥{total_pnl:+,.0f}")

            # BUY/SELL/HOLD 分布
            st.markdown("#### シグナル分布")
            sig_counts = all_trades["decision"].value_counts()
            c1, c2, c3 = st.columns(3)
            c1.metric("🟢 BUY", int(sig_counts.get("BUY", 0)))
            c2.metric("🔴 SELL", int(sig_counts.get("SELL", 0)))
            c3.metric("🟡 HOLD", int(sig_counts.get("HOLD", 0)))

            # 銘柄別損益
            st.markdown("#### 銘柄別損益")
            symbol_pnl = closed.groupby("symbol")["pnl"].sum().sort_values()
            pnl_df = symbol_pnl.reset_index()
            pnl_df.columns = ["銘柄", "損益"]
            st.bar_chart(pnl_df.set_index("銘柄"))

            # 信頼度分布
            st.markdown("#### 信頼度ヒストグラム（全判断）")
            conf_df = all_trades[["confidence"]].copy()
            conf_df["信頼度(%)"] = (conf_df["confidence"] * 100).round(0)
            hist_data = conf_df["信頼度(%)"].value_counts().sort_index()
            st.bar_chart(hist_data)
        else:
            col_c.metric("勝率", "—")
            col_d.metric("総損益", "—")
            st.info("まだ決済済みの取引がありません。")

# ─── 自動更新 ────────────────────────────────
st.divider()
auto_refresh = st.checkbox("🔄 30秒ごとに自動更新", value=False)
if auto_refresh:
    st.caption("30秒後に再読込します...")
    time.sleep(30)
    st.rerun()

if st.button("🔄 今すぐ更新"):
    st.rerun()
