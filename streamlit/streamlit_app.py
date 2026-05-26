"""
CASATS — Claude AI Stock Auto Trading System
"""

import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime, date, timezone, timedelta
import os

# ── DB 切り替え ──────────────────────────────────────────────
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

try:
    from dotenv import dotenv_values, set_key
    HAS_DOTENV = True
except ImportError:
    HAS_DOTENV = False

from pathlib import Path
PROJECT_DIR = Path(__file__).parent.parent.resolve()
DB_PATH     = PROJECT_DIR / "database" / "trades.db"
ENV_PATH    = PROJECT_DIR / ".env"
JST         = timezone(timedelta(hours=9))

# ── ページ設定 ───────────────────────────────────────────────
st.set_page_config(
    page_title="CASATS",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ══════════════════════════════════════════════════════════════
# CSS
# ══════════════════════════════════════════════════════════════
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

html, body, [class*="css"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
}
.main .block-container {
    padding-top: 1.5rem;
    padding-bottom: 2.5rem;
    max-width: 1200px;
}

/* ── サイドバー ── */
section[data-testid="stSidebar"] {
    background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
    border-right: 1px solid #334155;
}
section[data-testid="stSidebar"] * { color: #e2e8f0 !important; }
section[data-testid="stSidebar"] .stRadio > div > div[data-testid="stWidgetLabel"] {
    display: none;
}
section[data-testid="stSidebar"] .stRadio div[role="radiogroup"] {
    gap: 2px;
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"] {
    border-radius: 10px;
    padding: 2px 4px;
    transition: background 0.15s;
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"]:hover {
    background: rgba(99,102,241,0.15);
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"] > div:first-child {
    display: none;
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"] label {
    padding: 9px 14px !important;
    font-size: 0.875rem !important;
    font-weight: 500 !important;
    color: #94a3b8 !important;
    cursor: pointer;
    border-radius: 8px;
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"][data-checked="true"] {
    background: rgba(99,102,241,0.18);
    border: 1px solid rgba(99,102,241,0.3);
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"][data-checked="true"] label {
    color: #a5b4fc !important;
    font-weight: 600 !important;
}
section[data-testid="stSidebar"] .stButton button {
    background: rgba(99,102,241,0.15) !important;
    border: 1px solid rgba(99,102,241,0.3) !important;
    color: #a5b4fc !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
}
section[data-testid="stSidebar"] .stButton button:hover {
    background: rgba(99,102,241,0.25) !important;
}
section[data-testid="stSidebar"] hr { border-color: #334155 !important; }

/* ── ページヘッダー ── */
.page-header {
    background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
    border-radius: 16px;
    padding: 26px 30px;
    margin-bottom: 26px;
    color: white;
    position: relative;
    overflow: hidden;
}
.page-header::after {
    content: '';
    position: absolute;
    top: -40px; right: -40px;
    width: 160px; height: 160px;
    border-radius: 50%;
    background: rgba(255,255,255,0.06);
    pointer-events: none;
}
.page-header h1 {
    font-size: 1.5rem;
    font-weight: 800;
    margin: 0 0 4px 0;
    color: white !important;
    letter-spacing: -0.02em;
}
.page-header p {
    font-size: 0.82rem;
    color: rgba(255,255,255,0.72);
    margin: 0;
}

/* ── KPI カード ── */
.kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 26px;
}
.kpi-card {
    background: white;
    border-radius: 14px;
    padding: 20px 22px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.07), 0 4px 16px rgba(0,0,0,0.04);
    border: 1px solid #f1f5f9;
    position: relative;
    overflow: hidden;
    transition: transform 0.15s, box-shadow 0.15s;
}
.kpi-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.kpi-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    border-radius: 14px 14px 0 0;
}
.kpi-card.blue::before  { background: linear-gradient(90deg,#4f46e5,#818cf8); }
.kpi-card.green::before { background: linear-gradient(90deg,#059669,#34d399); }
.kpi-card.amber::before { background: linear-gradient(90deg,#d97706,#fbbf24); }
.kpi-card.red::before   { background: linear-gradient(90deg,#dc2626,#f87171); }
.kpi-icon { font-size: 1.4rem; margin-bottom: 8px; display: block; }
.kpi-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #94a3b8;
    margin-bottom: 6px;
}
.kpi-value {
    font-size: 1.55rem;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.03em;
    line-height: 1.1;
}
.kpi-delta { font-size: 0.75rem; font-weight: 500; margin-top: 5px; }
.kpi-delta.pos { color: #059669; }
.kpi-delta.neg { color: #dc2626; }
.kpi-delta.neu { color: #94a3b8; }

/* ── ポジションカード ── */
.pos-card {
    background: white;
    border-radius: 14px;
    padding: 18px 22px;
    margin-bottom: 10px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    border: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    gap: 18px;
    transition: border-color 0.15s;
}
.pos-card:hover { border-color: #cbd5e1; }
.pos-ticker { font-size: 1.1rem; font-weight: 800; color: #0f172a; min-width: 64px; }
.pos-info   { color: #64748b; font-size: 0.82rem; line-height: 1.7; flex: 1; }
.pos-info strong { color: #334155; }
.pnl-pos { font-weight: 700; color: #059669; }
.pnl-neg { font-weight: 700; color: #dc2626; }
.tag-hold {
    background: #f0fdf4;
    color: #059669;
    border: 1px solid #bbf7d0;
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
}

/* ── 売買シグナルカード ── */
.signal-card {
    background: white;
    border-radius: 14px;
    padding: 20px 22px;
    margin-bottom: 14px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    border: 1px solid #e2e8f0;
    transition: transform 0.15s;
}
.signal-card:hover { transform: translateY(-2px); }
.signal-card.buy  {
    border-top: 3px solid #059669;
    background: linear-gradient(180deg, rgba(5,150,105,0.03) 0%, white 60%);
}
.signal-card.sell {
    border-top: 3px solid #dc2626;
    background: linear-gradient(180deg, rgba(220,38,38,0.03) 0%, white 60%);
}
.sig-ticker { font-size: 1.25rem; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; }
.sig-price  { font-size: 0.85rem; color: #64748b; margin-top: 2px; }

/* バッジ */
.badge-buy  { background:#dcfce7; color:#166534; border:1px solid #bbf7d0;
              padding:3px 12px; border-radius:20px; font-size:0.75rem;
              font-weight:700; letter-spacing:0.04em; text-transform:uppercase; }
.badge-sell { background:#fee2e2; color:#991b1b; border:1px solid #fecaca;
              padding:3px 12px; border-radius:20px; font-size:0.75rem;
              font-weight:700; letter-spacing:0.04em; text-transform:uppercase; }
.badge-hold { background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;
              padding:3px 12px; border-radius:20px; font-size:0.75rem;
              font-weight:700; letter-spacing:0.04em; text-transform:uppercase; }
.conf-pill  { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;
              padding:3px 10px; border-radius:20px; font-size:0.75rem; font-weight:600; }

/* インフォグリッド */
.info-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 14px;
}
.info-cell {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 10px 14px;
    text-align: center;
}
.info-cell-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #94a3b8;
    margin-bottom: 5px;
}
.info-cell-value { font-size: 1rem; font-weight: 700; color: #0f172a; }
.info-cell-value.sl { color: #dc2626; }
.info-cell-value.tp { color: #059669; }

/* AI自動入力ボックス */
.ai-autofill-box {
    background: linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%);
    border: 1px solid #bbf7d0;
    border-radius: 14px;
    padding: 18px 20px;
    margin-bottom: 18px;
}
.ai-autofill-title {
    font-size: 0.82rem;
    font-weight: 700;
    color: #166534;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.ai-autofill-sub {
    font-size: 0.75rem;
    color: #64748b;
}

/* ステータスバッジ */
.run-status {
    border-radius: 10px;
    padding: 10px 16px;
    font-size: 0.83rem;
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 500;
    margin-top: 8px;
}
.run-status.running { background:#fffbeb; border:1px solid #fde68a; color:#92400e; }
.run-status.success { background:#f0fdf4; border:1px solid #bbf7d0; color:#166534; }
.run-status.failure { background:#fff1f2; border:1px solid #fecdd3; color:#9f1239; }

/* セクションヘッダー */
.sec-head {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #64748b;
    margin: 28px 0 14px 0;
    padding-bottom: 10px;
    border-bottom: 2px solid #f1f5f9;
}

/* ウォッチリスト */
.wl-row {
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    padding: 13px 18px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    transition: border-color 0.15s;
}
.wl-row:hover { border-color: #cbd5e1; }
.wl-rank {
    width: 28px; height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg,#4f46e5,#7c3aed);
    color: white; font-size: 0.7rem; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.wl-name { font-weight: 600; color: #0f172a; font-size: 0.88rem; }
.wl-sub  { font-size: 0.72rem; color: #94a3b8; margin-top: 2px; }
.score-bg {
    background: #f1f5f9; border-radius: 4px; height: 5px;
    width: 72px; overflow: hidden; display: inline-block; vertical-align: middle;
}
.score-fill {
    height: 100%; border-radius: 4px;
    background: linear-gradient(90deg,#4f46e5,#818cf8);
}

/* アクションパネル */
.action-panel {
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 22px 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.action-panel-title { font-size: 1rem; font-weight: 700; color: #0f172a; margin-bottom: 6px; }
.action-panel-desc  { font-size: 0.78rem; color: #64748b; line-height: 1.7; margin-bottom: 16px; }

/* 空状態 */
.empty-state {
    background: #f8fafc;
    border: 1px dashed #cbd5e1;
    border-radius: 14px;
    padding: 32px 24px;
    text-align: center;
    color: #94a3b8;
    font-size: 0.875rem;
}
.empty-state .emoji { font-size: 2rem; display: block; margin-bottom: 10px; }

/* ボタン */
.stButton button { border-radius: 8px !important; font-weight: 600 !important; transition: all 0.2s !important; }
.stButton button[kind="primary"] {
    background: linear-gradient(135deg,#4f46e5,#7c3aed) !important;
    border: none !important;
    color: white !important;
    box-shadow: 0 4px 12px rgba(79,70,229,0.25) !important;
}
.stButton button[kind="primary"]:hover {
    transform: translateY(-1px) !important;
    box-shadow: 0 6px 18px rgba(79,70,229,0.35) !important;
}

/* タブ */
.stTabs [data-baseweb="tab-list"] {
    gap: 4px; background: #f8fafc; border-radius: 10px;
    padding: 4px; border: 1px solid #e2e8f0;
}
.stTabs [data-baseweb="tab"] {
    border-radius: 8px; padding: 8px 16px;
    font-weight: 500; font-size: 0.83rem;
}
.stTabs [aria-selected="true"] {
    background: white !important;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08) !important;
    font-weight: 600 !important;
}

/* メトリクス */
[data-testid="stMetric"] {
    background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 10px; padding: 12px 16px;
}
[data-testid="stMetricLabel"] { color: #64748b !important; font-size: 0.72rem !important; }
[data-testid="stMetricValue"] { color: #0f172a !important; font-weight: 700 !important; }

/* expander */
[data-testid="stExpander"] {
    border-color: #e2e8f0 !important;
    border-radius: 12px !important;
}
[data-testid="stExpander"] summary { font-weight: 500 !important; }

/* フォーム */
[data-testid="stForm"] { border-radius: 14px !important; }

/* データフレーム */
[data-testid="stDataFrame"] { border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; }

/* ログインカード */
.login-box {
    max-width: 360px; margin: 80px auto;
    background: white; border-radius: 20px; padding: 40px 36px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.12); text-align: center;
    border: 1px solid #f1f5f9;
}
.login-logo  { font-size: 3rem; margin-bottom: 8px; display: block; }
.login-title { font-size: 1.5rem; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
.login-sub   { font-size: 0.8rem; color: #94a3b8; margin-bottom: 28px; }

hr { border-color: #f1f5f9 !important; }
</style>
""", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════
# DB ヘルパー
# ══════════════════════════════════════════════════════════════
def is_cloud():
    return HAS_PG and bool(DATABASE_URL)

def query(sql, params=()):
    try:
        if is_cloud():
            conn = psycopg2.connect(DATABASE_URL, sslmode='require')
            df = pd.read_sql_query(sql.replace("?", "%s"), conn,
                                   params=params if params else None)
            conn.close()
            return df
        else:
            conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
            df = pd.read_sql_query(sql, conn, params=params)
            conn.close()
            return df
    except Exception:
        return pd.DataFrame()

def execute(sql, params=()):
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

# ══════════════════════════════════════════════════════════════
# データ取得
# ══════════════════════════════════════════════════════════════
@st.cache_data(ttl=300)
def get_current_price(symbol: str):
    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{symbol}.T")
        return float(ticker.fast_info.last_price)
    except:
        return None

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

@st.cache_data(ttl=30)
def get_analysis_logs(limit=50):
    return query(f"SELECT * FROM analysis_log ORDER BY timestamp DESC LIMIT {limit}")

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

# ══════════════════════════════════════════════════════════════
# ユーティリティ
# ══════════════════════════════════════════════════════════════
def to_jst(ts_str):
    try:
        ts_str = str(ts_str).strip().replace('Z', '+00:00')
        dt = datetime.fromisoformat(ts_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(JST)
    except:
        return None

def get_recent_buy_signals():
    """直近の BUY シグナルを返す（購入フォームへの自動入力用）"""
    logs = get_analysis_logs(100)
    if logs.empty:
        return []
    buy = logs[logs['decision'] == 'BUY'].copy()
    if buy.empty:
        return []
    signals = []
    seen = set()
    for _, row in buy.iterrows():
        sym = row.get('symbol', '')
        if sym in seen:
            continue
        seen.add(sym)
        dt = to_jst(row.get('timestamp', ''))
        date_str = dt.strftime('%m/%d %H:%M') if dt else '—'
        signals.append({
            'label':      f"{sym}　¥{float(row.get('price') or 0):,.0f}　（{date_str}）",
            'symbol':     sym,
            'price':      float(row.get('price') or 0),
            'stop_loss':  float(row.get('stop_loss') or 0),
            'take_profit':float(row.get('take_profit') or 0),
            'confidence': float(row.get('confidence') or 0),
            'risk_reward':float(row.get('risk_reward') or 0),
        })
    return signals

# ══════════════════════════════════════════════════════════════
# 認証
# ══════════════════════════════════════════════════════════════
def check_password():
    correct = st.secrets.get("PASSWORD", "")
    if not correct:
        return True
    if st.session_state.get("authenticated"):
        return True
    st.markdown("""
    <div class="login-box">
        <span class="login-logo">📈</span>
        <div class="login-title">CASATS</div>
        <div class="login-sub">Claude AI Stock Auto Trading System</div>
    </div>
    """, unsafe_allow_html=True)
    col = st.columns([1, 2, 1])[1]
    with col:
        pwd = st.text_input("パスワード", type="password",
                            label_visibility="collapsed", placeholder="パスワードを入力...")
        if st.button("ログイン", type="primary", use_container_width=True):
            if pwd == correct:
                st.session_state["authenticated"] = True
                st.rerun()
            else:
                st.error("パスワードが違います")
    return False

if not check_password():
    st.stop()

# ══════════════════════════════════════════════════════════════
# サイドバー
# ══════════════════════════════════════════════════════════════
with st.sidebar:
    st.markdown("""
    <div style='padding:6px 4px 2px 4px;'>
        <div style='font-size:1.15rem;font-weight:800;color:#f1f5f9;letter-spacing:-0.02em;'>
            📈 CASATS
        </div>
        <div style='font-size:0.62rem;color:#64748b;margin-top:2px;letter-spacing:0.06em;
                    text-transform:uppercase;'>AI Stock Trading System</div>
    </div>
    """, unsafe_allow_html=True)

    db_label = "🌐 Neon DB" if is_cloud() else "💻 SQLite"
    db_color = "#34d399" if is_cloud() else "#fbbf24"
    st.markdown(
        f"<div style='display:inline-block;background:rgba(52,211,153,0.1);border:1px solid "
        f"rgba(52,211,153,0.25);border-radius:6px;padding:2px 10px;font-size:0.67rem;"
        f"font-weight:600;color:{db_color};margin:4px 0 8px 0;'>{db_label}</div>",
        unsafe_allow_html=True
    )
    st.markdown("---")

    page = st.radio("", [
        "📊  ダッシュボード",
        "📈  売買判定",
        "📝  売買記録",
        "🤖  AI分析・銘柄選定",
        "⚙️  設定",
    ], label_visibility="collapsed")

    st.markdown("---")

    port = get_portfolio()
    if port:
        cap   = float(port.get('current_capital', 0))
        init  = float(port.get('initial_capital', cap))
        cash  = float(port.get('available_cash', 0))
        gains = float(port.get('total_gains', 0))
        ratio = (1 - cash / cap) * 100 if cap > 0 else 0
        g_sign  = "+" if gains >= 0 else ""
        g_color = "#34d399" if gains >= 0 else "#f87171"
        g_pct   = gains / init * 100 if init else 0
        st.markdown(f"""
        <div style='background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);
                    border-radius:12px;padding:15px;'>
            <div style='font-size:0.62rem;text-transform:uppercase;letter-spacing:0.08em;
                        color:#64748b;margin-bottom:4px;'>総資産</div>
            <div style='font-size:1.3rem;font-weight:800;color:#f1f5f9;
                        letter-spacing:-0.02em;'>¥{cap:,.0f}</div>
            <div style='font-size:0.75rem;font-weight:600;color:{g_color};margin-top:2px;margin-bottom:10px;'>
                {g_sign}¥{abs(gains):,.0f}　({g_sign}{g_pct:.2f}%)
            </div>
            <div style='font-size:0.65rem;color:#64748b;margin-bottom:4px;'>余力 ¥{cash:,.0f}</div>
            <div style='background:#334155;border-radius:4px;height:5px;overflow:hidden;'>
                <div style='background:linear-gradient(90deg,#4f46e5,#818cf8);
                            height:100%;width:{ratio:.0f}%;border-radius:4px;'></div>
            </div>
            <div style='font-size:0.65rem;color:#64748b;margin-top:4px;text-align:right;'>
                投資比率 {ratio:.1f}%</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("<div style='height:8px;'></div>", unsafe_allow_html=True)
    if st.button("⟳  データ更新", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

    now_jst = datetime.now(JST)
    st.markdown(
        f"<div style='text-align:center;font-size:0.63rem;color:#475569;margin-top:10px;'>"
        f"{now_jst.strftime('%Y/%m/%d %H:%M')} JST</div>",
        unsafe_allow_html=True
    )


# ══════════════════════════════════════════════════════════════
# PAGE: 📊 ダッシュボード
# ══════════════════════════════════════════════════════════════
if "ダッシュボード" in page:
    st.markdown("""
    <div class="page-header">
        <h1>📊 ダッシュボード</h1>
        <p>ポートフォリオの概要・保有ポジション・資産推移</p>
    </div>
    """, unsafe_allow_html=True)

    if not db_ok():
        st.warning("データベースに接続できません。設定を確認してください。")
        st.stop()

    port = get_portfolio()
    if port:
        cap      = float(port.get('current_capital', 0))
        init_cap = float(port.get('initial_capital', cap))
        cash     = float(port.get('available_cash', 0))
        invested = float(port.get('invested_stocks', 0))
        gains    = float(port.get('total_gains', 0))
        gain_pct = (gains / init_cap * 100) if init_cap else 0
        gain_cls = "pos" if gains >= 0 else "neg"
        g_sign   = "+" if gains >= 0 else ""
        g_arr    = "▲" if gains >= 0 else "▼"
        g_color  = "green" if gains >= 0 else "red"

        st.markdown(f"""
        <div class="kpi-grid">
            <div class="kpi-card blue">
                <span class="kpi-icon">💰</span>
                <div class="kpi-label">総資産</div>
                <div class="kpi-value">¥{cap:,.0f}</div>
                <div class="kpi-delta neu">元本 ¥{init_cap:,.0f}</div>
            </div>
            <div class="kpi-card green">
                <span class="kpi-icon">🏦</span>
                <div class="kpi-label">余力（現金）</div>
                <div class="kpi-value">¥{cash:,.0f}</div>
                <div class="kpi-delta neu">{(cash/cap*100 if cap else 0):.1f}% of portfolio</div>
            </div>
            <div class="kpi-card amber">
                <span class="kpi-icon">📦</span>
                <div class="kpi-label">株式評価額</div>
                <div class="kpi-value">¥{invested:,.0f}</div>
                <div class="kpi-delta neu">{(invested/cap*100 if cap else 0):.1f}% of portfolio</div>
            </div>
            <div class="kpi-card {g_color}">
                <span class="kpi-icon">{'📈' if gains >= 0 else '📉'}</span>
                <div class="kpi-label">累計損益</div>
                <div class="kpi-value">{g_sign}¥{abs(gains):,.0f}</div>
                <div class="kpi-delta {gain_cls}">{g_arr} {abs(gain_pct):.2f}%</div>
            </div>
        </div>
        """, unsafe_allow_html=True)
    else:
        st.markdown("""
        <div class="empty-state">
            <span class="emoji">💼</span>
            ポートフォリオデータがまだありません。<br>
            <small>⚙️ 設定 ページから軍資金を設定してください</small>
        </div>
        """, unsafe_allow_html=True)

    # ── 保有ポジション ──────────────────────────────────────
    st.markdown('<div class="sec-head">保有中ポジション</div>', unsafe_allow_html=True)
    pos_df = get_open_positions()

    if pos_df.empty:
        st.markdown("""
        <div class="empty-state">
            <span class="emoji">🔍</span>
            現在保有しているポジションはありません
        </div>
        """, unsafe_allow_html=True)
    else:
        total_unr = 0.0
        for _, row in pos_df.iterrows():
            sym     = row.get('symbol', '')
            qty     = int(row.get('quantity', 0))
            entry   = float(row.get('entry_price', 0))
            current = float(row.get('current_price') or entry)
            unr_pnl = float(row.get('unrealized_pnl') or (current - entry) * qty)
            unr_pct = float(row.get('unrealized_pnl_percent') or
                            ((current - entry) / entry * 100 if entry else 0))
            total_unr += unr_pnl
            pnl_cls = "pnl-pos" if unr_pnl >= 0 else "pnl-neg"
            sign    = "+" if unr_pnl >= 0 else ""
            arr     = "▲" if unr_pnl >= 0 else "▼"
            sl = row.get('stop_loss_price')
            tp = row.get('take_profit_price')

            st.markdown(f"""
            <div class="pos-card">
                <div>
                    <div class="pos-ticker">{sym}</div>
                    <span class="tag-hold">保有中</span>
                </div>
                <div class="pos-info">
                    <div>{qty}株　取得値 <strong>¥{entry:,.0f}</strong></div>
                    <div>現在値 <strong>¥{current:,.0f}</strong>
                        {'　🛑 ¥' + f'{float(sl):,.0f}' if sl else ''}
                        {'　🎯 ¥' + f'{float(tp):,.0f}' if tp else ''}
                    </div>
                </div>
                <div style="text-align:right;min-width:110px;">
                    <div class="{pnl_cls}">{sign}¥{abs(unr_pnl):,.0f}</div>
                    <div class="{pnl_cls}" style="font-size:0.78rem;">{arr} {abs(unr_pct):.2f}%</div>
                </div>
            </div>
            """, unsafe_allow_html=True)

        sign_t  = "+" if total_unr >= 0 else ""
        color_t = "#059669" if total_unr >= 0 else "#dc2626"
        st.markdown(
            f"<div style='text-align:right;font-size:0.78rem;color:{color_t};"
            f"font-weight:600;margin-top:4px;'>含み損益合計 {sign_t}¥{abs(total_unr):,.0f}</div>",
            unsafe_allow_html=True
        )

    # ── 資産推移 ────────────────────────────────────────────
    st.markdown('<div class="sec-head">資産推移</div>', unsafe_allow_html=True)
    hist_df = get_portfolio_history()
    if not hist_df.empty and 'current_capital' in hist_df.columns:
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=hist_df['date'], y=hist_df['current_capital'],
            mode='lines', name='総資産',
            line=dict(color='#4f46e5', width=2.5),
            fill='tozeroy', fillcolor='rgba(79,70,229,0.07)'
        ))
        if 'available_cash' in hist_df.columns:
            fig.add_trace(go.Scatter(
                x=hist_df['date'], y=hist_df['available_cash'],
                mode='lines', name='余力',
                line=dict(color='#94a3b8', width=1.5, dash='dot')
            ))
        fig.update_layout(
            height=250, margin=dict(l=0, r=0, t=8, b=0),
            legend=dict(orientation='h', y=-0.18, font=dict(size=11)),
            plot_bgcolor='rgba(0,0,0,0)', paper_bgcolor='rgba(0,0,0,0)',
            xaxis=dict(showgrid=False, color='#94a3b8', tickfont=dict(size=10)),
            yaxis=dict(showgrid=True, gridcolor='#f1f5f9', color='#94a3b8', tickfont=dict(size=10)),
            font=dict(family='Inter, sans-serif'),
            hoverlabel=dict(bgcolor='white', bordercolor='#e2e8f0'),
        )
        st.plotly_chart(fig, use_container_width=True, config={'displayModeBar': False})
    else:
        st.markdown("""
        <div class="empty-state">
            <span class="emoji">📉</span>
            資産推移データがまだありません
        </div>
        """, unsafe_allow_html=True)

    # ── 直近の決済履歴 ──────────────────────────────────────
    st.markdown('<div class="sec-head">直近の決済履歴</div>', unsafe_allow_html=True)
    closed_df = get_closed_positions(20)
    if closed_df.empty:
        st.markdown("""
        <div class="empty-state">
            <span class="emoji">📋</span>
            決済済みのポジションはありません
        </div>
        """, unsafe_allow_html=True)
    else:
        disp = closed_df[['symbol','quantity','entry_price','exit_price',
                           'realized_pnl','realized_pnl_percent','exit_date','exit_reason']].copy()
        disp.columns = ['銘柄','株数','取得値','売却値','損益(¥)','損益(%)','決済日','理由']
        disp['損益(¥)'] = disp['損益(¥)'].apply(
            lambda x: f"+¥{float(x):,.0f}" if (float(x) if x is not None else 0) >= 0
                      else f"-¥{abs(float(x)):,.0f}")
        disp['損益(%)'] = disp['損益(%)'].apply(
            lambda x: f"+{float(x):.2f}%" if (float(x) if x is not None else 0) >= 0
                      else f"{float(x):.2f}%")
        st.dataframe(disp, use_container_width=True, hide_index=True)


# ══════════════════════════════════════════════════════════════
# PAGE: 📈 売買判定
# ══════════════════════════════════════════════════════════════
elif "売買判定" in page:
    st.markdown("""
    <div class="page-header">
        <h1>📈 売買判定</h1>
        <p>最新の AI 分析による買い・売り推奨シグナル</p>
    </div>
    """, unsafe_allow_html=True)

    logs_df = get_analysis_logs(100)

    if logs_df.empty:
        st.markdown("""
        <div class="empty-state" style="padding:48px 24px;">
            <span class="emoji">🤖</span>
            まだ分析結果がありません。<br>
            <small>「🤖 AI分析・銘柄選定」ページからボットを実行してください</small>
        </div>
        """, unsafe_allow_html=True)
    else:
        latest_ts = None
        for _, row in logs_df.iterrows():
            dt = to_jst(row.get('timestamp', ''))
            if dt and (latest_ts is None or dt > latest_ts):
                latest_ts = dt

        target_date = latest_ts.date() if latest_ts else None
        latest_rows = [row for _, row in logs_df.iterrows()
                       if to_jst(row.get('timestamp', '')) and
                          to_jst(row.get('timestamp', '')).date() == target_date]

        if latest_ts:
            buy_n  = sum(1 for r in latest_rows if r.get('decision') == 'BUY')
            sell_n = sum(1 for r in latest_rows if r.get('decision') == 'SELL')
            hold_n = len(latest_rows) - buy_n - sell_n
            st.markdown(f"""
            <div style='background:white;border:1px solid #e2e8f0;border-radius:12px;
                        padding:14px 20px;display:flex;align-items:center;
                        justify-content:space-between;margin-bottom:22px;
                        box-shadow:0 1px 3px rgba(0,0,0,0.05);flex-wrap:wrap;gap:12px;'>
                <div>
                    <div style='font-size:0.67rem;text-transform:uppercase;letter-spacing:0.07em;
                                color:#94a3b8;margin-bottom:2px;'>最終分析</div>
                    <div style='font-weight:700;color:#0f172a;'>
                        {latest_ts.strftime('%Y年%m月%d日　%H:%M')} JST
                    </div>
                </div>
                <div style='display:flex;gap:20px;'>
                    <div style='text-align:center;'>
                        <div style='font-size:1.2rem;font-weight:800;color:#059669;'>{buy_n}</div>
                        <div style='font-size:0.62rem;color:#94a3b8;letter-spacing:0.05em;'>BUY</div>
                    </div>
                    <div style='width:1px;background:#f1f5f9;'></div>
                    <div style='text-align:center;'>
                        <div style='font-size:1.2rem;font-weight:800;color:#dc2626;'>{sell_n}</div>
                        <div style='font-size:0.62rem;color:#94a3b8;letter-spacing:0.05em;'>SELL</div>
                    </div>
                    <div style='width:1px;background:#f1f5f9;'></div>
                    <div style='text-align:center;'>
                        <div style='font-size:1.2rem;font-weight:800;color:#94a3b8;'>{hold_n}</div>
                        <div style='font-size:0.62rem;color:#94a3b8;letter-spacing:0.05em;'>HOLD</div>
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)

        buy_rows  = [r for r in latest_rows if r.get('decision') == 'BUY']
        sell_rows = [r for r in latest_rows if r.get('decision') == 'SELL']

        col_b, col_s = st.columns(2)

        with col_b:
            st.markdown(f"""
            <div style='display:flex;align-items:center;gap:8px;margin-bottom:14px;'>
                <span class="badge-buy">BUY</span>
                <span style='font-weight:700;color:#0f172a;'>{len(buy_rows)} 銘柄</span>
            </div>
            """, unsafe_allow_html=True)

            if buy_rows:
                for row in buy_rows:
                    sl   = row.get('stop_loss')
                    tp   = row.get('take_profit')
                    rr   = row.get('risk_reward')
                    qty  = int(row.get('quantity', 0))
                    price= float(row.get('price') or 0)
                    conf = float(row.get('confidence') or 0)
                    cost = price * qty

                    info_html = ""
                    if sl and tp and rr:
                        sl_v = float(sl); tp_v = float(tp); rr_v = float(rr)
                        # 改行なし1行で書く（Markdownのコードブロック誤認を防ぐ）
                        info_html = (
                            '<div class="info-grid">'
                            '<div class="info-cell">'
                            '<div class="info-cell-label">🛑 損切り</div>'
                            f'<div class="info-cell-value sl">¥{sl_v:,.0f}</div>'
                            '</div>'
                            '<div class="info-cell">'
                            '<div class="info-cell-label">🎯 利確</div>'
                            f'<div class="info-cell-value tp">¥{tp_v:,.0f}</div>'
                            '</div>'
                            '<div class="info-cell">'
                            '<div class="info-cell-label">R/R 比率</div>'
                            f'<div class="info-cell-value">{rr_v:.2f}</div>'
                            '</div>'
                            '</div>'
                            f'<div style="margin-top:10px;font-size:.72rem;color:#94a3b8;text-align:right;">必要金額 ¥{cost:,.0f}</div>'
                        )

                    st.markdown(f"""
                    <div class="signal-card buy">
                        <div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;'>
                            <div>
                                <div style='display:flex;align-items:center;gap:8px;'>
                                    <span class="sig-ticker">{row.get('symbol','')}</span>
                                    <span class="badge-buy">BUY</span>
                                </div>
                                <div class="sig-price">¥{price:,.0f} × {qty}株</div>
                            </div>
                            <span class="conf-pill">信頼度 {conf*100:.0f}%</span>
                        </div>
                        {info_html}
                    </div>
                    """, unsafe_allow_html=True)
            else:
                st.markdown("""
                <div class="empty-state" style="border-color:#bbf7d0;">
                    <span class="emoji">🟢</span>
                    本日の買い推奨はありません
                </div>
                """, unsafe_allow_html=True)

        with col_s:
            st.markdown(f"""
            <div style='display:flex;align-items:center;gap:8px;margin-bottom:14px;'>
                <span class="badge-sell">SELL</span>
                <span style='font-weight:700;color:#0f172a;'>{len(sell_rows)} 銘柄</span>
            </div>
            """, unsafe_allow_html=True)

            if sell_rows:
                for row in sell_rows:
                    pnl   = row.get('pnl')
                    pct   = row.get('pnl_percent')
                    reason= row.get('close_reason', '')
                    price = float(row.get('price') or 0)
                    qty   = int(row.get('quantity', 0))
                    conf  = float(row.get('confidence') or 0)
                    pnl_html = ""
                    if pnl is not None:
                        pv = float(pnl); pp = float(pct or 0)
                        sign = "+" if pv >= 0 else ""
                        clr  = "#059669" if pv >= 0 else "#dc2626"
                        pnl_html = (f"<div style='text-align:right;'>"
                                    f"<div style='font-weight:700;color:{clr};'>{sign}¥{abs(pv):,.0f}</div>"
                                    f"<div style='font-size:0.75rem;color:{clr};'>{sign}{pp:.2f}%</div>"
                                    f"</div>")
                    reason_html = (f"<div style='margin-top:10px;font-size:0.72rem;color:#94a3b8;'>"
                                   f"理由: {reason}</div>") if reason else ""

                    st.markdown(f"""
                    <div class="signal-card sell">
                        <div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;'>
                            <div>
                                <div style='display:flex;align-items:center;gap:8px;'>
                                    <span class="sig-ticker">{row.get('symbol','')}</span>
                                    <span class="badge-sell">SELL</span>
                                </div>
                                <div class="sig-price">¥{price:,.0f} × {qty}株</div>
                            </div>
                            <div style='display:flex;flex-direction:column;align-items:flex-end;gap:4px;'>
                                <span class="conf-pill">信頼度 {conf*100:.0f}%</span>
                                {pnl_html}
                            </div>
                        </div>
                        {reason_html}
                    </div>
                    """, unsafe_allow_html=True)
            else:
                st.markdown("""
                <div class="empty-state" style="border-color:#fecdd3;">
                    <span class="emoji">🔴</span>
                    本日の売り推奨はありません
                </div>
                """, unsafe_allow_html=True)

        past_rows = [row for _, row in logs_df.iterrows()
                     if to_jst(row.get('timestamp', '')) and
                        to_jst(row.get('timestamp', '')).date() != target_date] if target_date else []
        if past_rows:
            with st.expander(f"📂 過去の判定履歴（{len(past_rows)}件）"):
                for row in past_rows:
                    decision = row.get('decision', '')
                    dt   = to_jst(row.get('timestamp', ''))
                    ts   = dt.strftime('%m/%d %H:%M') if dt else '—'
                    icon = '🟢' if decision == 'BUY' else '🔴' if decision == 'SELL' else '🟡'
                    price= float(row.get('price') or 0)
                    qty  = row.get('quantity', 0)
                    sl   = row.get('stop_loss')
                    tp   = row.get('take_profit')
                    extra = f"　SL ¥{float(sl):,.0f}　TP ¥{float(tp):,.0f}" if sl and tp else ""
                    st.markdown(f"{icon} **{ts}　{row.get('symbol','')}　{decision}**"
                                f"　¥{price:,.0f}×{qty}株{extra}")


# ══════════════════════════════════════════════════════════════
# PAGE: 📝 売買記録
# ══════════════════════════════════════════════════════════════
elif "売買記録" in page:
    st.markdown("""
    <div class="page-header">
        <h1>📝 売買記録</h1>
        <p>実際に発注した内容を記録・修正してください。損益は自動計算されます。</p>
    </div>
    """, unsafe_allow_html=True)

    tab_buy, tab_sell, tab_edit, tab_update = st.tabs([
        "🟢　購入を記録",
        "🔴　売却を記録",
        "✏️　購入記録を修正",
        "🔄　現在値を更新",
    ])

    # ────────────────────────────────────────────────────────
    # タブ1: 購入を記録（AI自動入力付き）
    # ────────────────────────────────────────────────────────
    with tab_buy:

        # AI シグナルから自動入力
        signals = get_recent_buy_signals()

        # session_state で自動入力値を管理
        if "buy_auto" not in st.session_state:
            st.session_state["buy_auto"] = None

        if signals:
            st.markdown("""
            <div class="ai-autofill-box">
                <div class="ai-autofill-title">🤖 AI判定から自動入力</div>
                <div class="ai-autofill-sub">
                    AIが推奨した銘柄を選ぶと、銘柄コード・損切り・利確価格が自動でセットされます
                </div>
            </div>
            """, unsafe_allow_html=True)

            options = {"-- 手動で入力する --": None}
            for s in signals:
                options[s['label']] = s

            selected_label = st.selectbox(
                "🤖 AI推奨銘柄から選択",
                list(options.keys()),
                key="ai_signal_select"
            )
            selected_signal = options[selected_label]

            # 自動入力用のデフォルト値
            if selected_signal:
                auto_symbol = selected_signal['symbol']
                auto_price  = selected_signal['price']
                auto_sl     = selected_signal['stop_loss']
                auto_tp     = selected_signal['take_profit']

                st.markdown(f"""
                <div style='background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;
                            padding:12px 16px;margin-bottom:16px;font-size:0.82rem;'>
                    <div style='display:flex;gap:20px;flex-wrap:wrap;'>
                        <div><span style='color:#94a3b8;'>銘柄</span>
                             <strong style='color:#0f172a;margin-left:6px;'>{auto_symbol}</strong></div>
                        <div><span style='color:#94a3b8;'>価格</span>
                             <strong style='color:#0f172a;margin-left:6px;'>¥{auto_price:,.0f}</strong></div>
                        <div><span style='color:#94a3b8;'>🛑 損切り</span>
                             <strong style='color:#dc2626;margin-left:6px;'>¥{auto_sl:,.0f}</strong></div>
                        <div><span style='color:#94a3b8;'>🎯 利確</span>
                             <strong style='color:#059669;margin-left:6px;'>¥{auto_tp:,.0f}</strong></div>
                        <div><span style='color:#94a3b8;'>信頼度</span>
                             <strong style='color:#1d4ed8;margin-left:6px;'>
                             {selected_signal['confidence']*100:.0f}%</strong></div>
                    </div>
                </div>
                """, unsafe_allow_html=True)
            else:
                auto_symbol = ""
                auto_price  = 1000.0
                auto_sl     = 0.0
                auto_tp     = 0.0
        else:
            auto_symbol = ""
            auto_price  = 1000.0
            auto_sl     = 0.0
            auto_tp     = 0.0
            selected_signal = None

        st.markdown("<div style='height:4px;'></div>", unsafe_allow_html=True)

        with st.form("form_buy", clear_on_submit=True):
            c1, c2 = st.columns(2)
            symbol = c1.text_input("銘柄コード", value=auto_symbol,
                                   placeholder="例: 7203").strip()
            qty    = c2.number_input("購入株数", min_value=1, step=1, value=1)
            c3, c4 = st.columns(2)
            price  = c3.number_input("購入単価（¥）", min_value=1.0, step=1.0,
                                     value=max(auto_price, 1.0))
            edate  = c4.date_input("購入日", value=date.today())
            c5, c6 = st.columns(2)
            sl_price = c5.number_input(
                "🛑 損切り価格（¥）", min_value=0.0, step=1.0, value=auto_sl,
                help="AI判定を選ぶと自動入力されます"
            )
            tp_price = c6.number_input(
                "🎯 利確価格（¥）", min_value=0.0, step=1.0, value=auto_tp,
                help="AI判定を選ぶと自動入力されます"
            )
            note = st.text_area("メモ（任意）", height=68, placeholder="発注理由、メモなど...")
            submitted = st.form_submit_button("✅ 購入を記録する", type="primary",
                                              use_container_width=True)

        if submitted:
            if not symbol:
                st.error("銘柄コードを入力してください。")
            else:
                total = qty * price
                if is_cloud():
                    sql = """INSERT INTO positions
                        (symbol, quantity, entry_price, entry_date,
                         stop_loss_price, take_profit_price, status, current_price)
                        VALUES (?, ?, ?, ?, ?, ?, 'holding', ?) RETURNING id"""
                else:
                    sql = """INSERT INTO positions
                        (symbol, quantity, entry_price, entry_date,
                         stop_loss_price, take_profit_price, status, current_price)
                        VALUES (?, ?, ?, ?, ?, ?, 'holding', ?)"""
                execute(sql, (
                    symbol, qty, price, edate.isoformat(),
                    sl_price if sl_price > 0 else None,
                    tp_price if tp_price > 0 else None,
                    price
                ))
                execute(
                    "INSERT INTO trades (symbol, decision, entry_price, quantity, "
                    "confidence, reasoning, status, timestamp) VALUES (?, 'BUY', ?, ?, 1.0, ?, 'filled', ?)",
                    (symbol, price, qty,
                     note or f"手動購入 {qty}株 @¥{price:,.0f}",
                     datetime.now().isoformat())
                )
                st.cache_data.clear()
                st.success(f"✅ **{symbol}**　{qty}株　@¥{price:,.0f}　を記録しました（合計 ¥{total:,.0f}）")
                st.balloons()

    # ────────────────────────────────────────────────────────
    # タブ2: 売却を記録
    # ────────────────────────────────────────────────────────
    with tab_sell:
        pos_df = get_open_positions()
        if pos_df.empty:
            st.markdown("""
            <div class="empty-state">
                <span class="emoji">🔍</span>
                現在保有中のポジションがありません
            </div>
            """, unsafe_allow_html=True)
        else:
            options = {
                f"{row['symbol']}  {int(row['quantity'])}株  @¥{float(row['entry_price']):,.0f}": row
                for _, row in pos_df.iterrows()
            }
            selected_label = st.selectbox("売却するポジション", list(options.keys()))
            selected_pos   = options[selected_label]
            entry_p = float(selected_pos['entry_price'])
            qty_max = int(selected_pos['quantity'])

            with st.form("form_sell", clear_on_submit=True):
                c1, c2 = st.columns(2)
                sell_qty   = c1.number_input("売却株数", min_value=1, max_value=qty_max,
                                             step=1, value=qty_max)
                sell_price = c2.number_input("売却単価（¥）", min_value=1.0, step=1.0,
                                             value=entry_p)
                c3, c4 = st.columns(2)
                sell_date   = c3.date_input("売却日", value=date.today())
                sell_reason = c4.selectbox("売却理由", ["利益確定", "損切り", "定期見直し", "その他"])
                note = st.text_area("メモ（任意）", height=68)
                submitted_sell = st.form_submit_button("✅ 売却を記録する", type="primary",
                                                       use_container_width=True)

            if submitted_sell:
                pnl     = (sell_price - entry_p) * sell_qty
                pnl_pct = (sell_price - entry_p) / entry_p * 100 if entry_p else 0
                sign    = "+" if pnl >= 0 else ""
                pos_id  = int(selected_pos['id'])
                if sell_qty == qty_max:
                    execute(
                        "UPDATE positions SET status='closed', exit_price=?, exit_date=?, "
                        "exit_reason=?, realized_pnl=?, realized_pnl_percent=?, current_price=? WHERE id=?",
                        (sell_price, sell_date.isoformat(), sell_reason, pnl, pnl_pct, sell_price, pos_id)
                    )
                else:
                    execute("UPDATE positions SET quantity=? WHERE id=?", (qty_max - sell_qty, pos_id))
                    execute(
                        "INSERT INTO positions (symbol, quantity, entry_price, entry_date, "
                        "exit_price, exit_date, exit_reason, realized_pnl, realized_pnl_percent, status) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed')",
                        (selected_pos['symbol'], sell_qty, entry_p, selected_pos['entry_date'],
                         sell_price, sell_date.isoformat(), sell_reason, pnl, pnl_pct)
                    )
                st.cache_data.clear()
                st.success(
                    f"✅ **{selected_pos['symbol']}**　{sell_qty}株　@¥{sell_price:,.0f}\n\n"
                    f"損益: {sign}¥{abs(pnl):,.0f}（{sign}{pnl_pct:.2f}%）"
                )
                if pnl >= 0:
                    st.balloons()

    # ────────────────────────────────────────────────────────
    # タブ3: 購入記録を修正
    # ────────────────────────────────────────────────────────
    with tab_edit:
        pos_df_all = get_open_positions()
        if pos_df_all.empty:
            st.markdown("""
            <div class="empty-state">
                <span class="emoji">🔍</span>
                修正できる保有ポジションがありません
            </div>
            """, unsafe_allow_html=True)
        else:
            st.caption("修正したいポジションを選んでください。")

            # 選択中の position ID を session_state で管理
            if "edit_pos_id" not in st.session_state:
                st.session_state["edit_pos_id"] = None

            # ポジション一覧
            for _, row in pos_df_all.iterrows():
                pid    = int(row['id'])
                sym    = row.get('symbol', '')
                qty    = int(row.get('quantity', 0))
                entry  = float(row.get('entry_price', 0))
                sl     = row.get('stop_loss_price')
                tp     = row.get('take_profit_price')
                edate_str = str(row.get('entry_date', ''))[:10]

                sl_str = f"🛑 ¥{float(sl):,.0f}" if sl else "🛑 —"
                tp_str = f"🎯 ¥{float(tp):,.0f}" if tp else "🎯 —"

                col_info, col_btn = st.columns([5, 1])
                with col_info:
                    st.markdown(f"""
                    <div class="pos-card" style="margin-bottom:0;">
                        <div>
                            <div class="pos-ticker">{sym}</div>
                            <span class="tag-hold">保有中</span>
                        </div>
                        <div class="pos-info">
                            <div>{qty}株　取得値 <strong>¥{entry:,.0f}</strong>　{edate_str}</div>
                            <div>{sl_str}　{tp_str}</div>
                        </div>
                    </div>
                    """, unsafe_allow_html=True)
                with col_btn:
                    st.markdown("<div style='height:10px;'></div>", unsafe_allow_html=True)
                    if st.button("✏️ 修正", key=f"edit_btn_{pid}", use_container_width=True):
                        st.session_state["edit_pos_id"] = pid
                        st.rerun()

                st.markdown("<div style='height:4px;'></div>", unsafe_allow_html=True)

            # 選択されたポジションの編集フォーム
            edit_id = st.session_state.get("edit_pos_id")
            if edit_id is not None:
                edit_row = pos_df_all[pos_df_all['id'] == edit_id]
                if not edit_row.empty:
                    r = edit_row.iloc[0]
                    sym_e   = r.get('symbol', '')
                    qty_e   = int(r.get('quantity', 0))
                    entry_e = float(r.get('entry_price', 0))
                    sl_e    = float(r.get('stop_loss_price') or 0)
                    tp_e    = float(r.get('take_profit_price') or 0)
                    ed_str  = str(r.get('entry_date', ''))[:10]
                    try:
                        ed_val = date.fromisoformat(ed_str) if ed_str else date.today()
                    except:
                        ed_val = date.today()

                    st.markdown(f"""
                    <div style='background:linear-gradient(135deg,#eff6ff,#f0fdf4);
                                border:1px solid #bfdbfe;border-radius:14px;
                                padding:18px 20px;margin-top:16px;margin-bottom:4px;'>
                        <div style='font-size:0.85rem;font-weight:700;color:#1d4ed8;margin-bottom:2px;'>
                            ✏️ {sym_e} の購入記録を修正
                        </div>
                        <div style='font-size:0.75rem;color:#64748b;'>
                            変更したい項目だけ修正して「保存する」を押してください
                        </div>
                    </div>
                    """, unsafe_allow_html=True)

                    # AI シグナルから再選択も可能
                    signals_e = get_recent_buy_signals()
                    sig_opts_e = {"-- 変更しない --": None}
                    for s in signals_e:
                        if s['symbol'] == sym_e:
                            sig_opts_e[s['label']] = s

                    if len(sig_opts_e) > 1:
                        sel_sig_e = st.selectbox(
                            "🤖 AI判定から損切り・利確を再セット（任意）",
                            list(sig_opts_e.keys()),
                            key="edit_ai_select"
                        )
                        if sig_opts_e[sel_sig_e]:
                            sl_e = sig_opts_e[sel_sig_e]['stop_loss']
                            tp_e = sig_opts_e[sel_sig_e]['take_profit']
                            st.info(f"AI判定の値をセット: 🛑 ¥{sl_e:,.0f}　🎯 ¥{tp_e:,.0f}")

                    with st.form(f"form_edit_{edit_id}", clear_on_submit=False):
                        ec1, ec2 = st.columns(2)
                        new_qty   = ec1.number_input("購入株数", min_value=1, step=1, value=qty_e)
                        new_price = ec2.number_input("購入単価（¥）", min_value=1.0, step=1.0,
                                                     value=max(entry_e, 1.0))
                        ec3, ec4 = st.columns(2)
                        new_sl    = ec3.number_input("🛑 損切り価格（¥）", min_value=0.0, step=1.0,
                                                     value=sl_e)
                        new_tp    = ec4.number_input("🎯 利確価格（¥）", min_value=0.0, step=1.0,
                                                     value=tp_e)
                        new_edate = st.date_input("購入日", value=ed_val)

                        bc1, bc2 = st.columns(2)
                        save_btn   = bc1.form_submit_button("💾 保存する", type="primary",
                                                             use_container_width=True)
                        cancel_btn = bc2.form_submit_button("キャンセル", use_container_width=True)

                    if save_btn:
                        execute(
                            "UPDATE positions SET quantity=?, entry_price=?, entry_date=?, "
                            "stop_loss_price=?, take_profit_price=?, current_price=? WHERE id=?",
                            (
                                new_qty,
                                new_price,
                                new_edate.isoformat(),
                                new_sl if new_sl > 0 else None,
                                new_tp if new_tp > 0 else None,
                                new_price,
                                edit_id
                            )
                        )
                        st.cache_data.clear()
                        st.session_state["edit_pos_id"] = None
                        st.success(f"✅ {sym_e} の購入記録を更新しました。")
                        st.rerun()

                    if cancel_btn:
                        st.session_state["edit_pos_id"] = None
                        st.rerun()

    # ────────────────────────────────────────────────────────
    # タブ4: 現在値を更新
    # ────────────────────────────────────────────────────────
    with tab_update:
        st.caption("保有株の現在値を更新します。")
        pos_df2 = get_open_positions()
        if pos_df2.empty:
            st.markdown("""
            <div class="empty-state">
                <span class="emoji">🔍</span>
                保有中のポジションがありません
            </div>
            """, unsafe_allow_html=True)
        else:
            if st.button("🔄 Yahoo Finance から一括取得", type="primary"):
                updated = 0
                with st.spinner("株価を取得中..."):
                    for _, row in pos_df2.iterrows():
                        price = get_current_price(row['symbol'])
                        if price:
                            entry = float(row['entry_price'])
                            qty   = int(row['quantity'])
                            execute(
                                "UPDATE positions SET current_price=?, unrealized_pnl=?, "
                                "unrealized_pnl_percent=? WHERE id=?",
                                (price, (price-entry)*qty, (price-entry)/entry*100, int(row['id']))
                            )
                            updated += 1
                st.cache_data.clear()
                st.success(f"✅ {updated} 銘柄の現在値を更新しました。")

            st.markdown("<div style='height:8px;'></div>", unsafe_allow_html=True)
            for _, row in pos_df2.iterrows():
                with st.form(f"update_{row['id']}", clear_on_submit=False):
                    sym   = row['symbol']
                    entry = float(row['entry_price'])
                    cur   = float(row.get('current_price') or entry)
                    c1, c2, c3 = st.columns([2, 2, 1])
                    c1.markdown(f"**{sym}**  取得: ¥{entry:,.0f}")
                    new_price = c2.number_input("現在値（¥）", value=cur, min_value=1.0, step=1.0,
                                                key=f"np_{row['id']}", label_visibility="collapsed")
                    if c3.form_submit_button("更新"):
                        qty = int(row['quantity'])
                        execute(
                            "UPDATE positions SET current_price=?, unrealized_pnl=?, "
                            "unrealized_pnl_percent=? WHERE id=?",
                            (new_price, (new_price-entry)*qty,
                             (new_price-entry)/entry*100, int(row['id']))
                        )
                        st.cache_data.clear()
                        st.rerun()


# ══════════════════════════════════════════════════════════════
# PAGE: 🤖 AI分析・銘柄選定
# ══════════════════════════════════════════════════════════════
elif "AI分析" in page:
    st.markdown("""
    <div class="page-header">
        <h1>🤖 AI分析・銘柄選定</h1>
        <p>Claude AI による売買分析と銘柄スキャンの実行管理</p>
    </div>
    """, unsafe_allow_html=True)

    import urllib.request, json as _json

    def _github_request(method, path, payload=None):
        token = st.secrets.get("GITHUB_TOKEN", "")
        repo  = st.secrets.get("GITHUB_REPO", "")
        if not token or not repo:
            return None, "GITHUB_TOKEN / GITHUB_REPO が Secrets に未設定"
        url = f"https://api.github.com/repos/{repo}{path}"
        req = urllib.request.Request(
            url, data=_json.dumps(payload).encode() if payload else None, method=method)
        req.add_header("Authorization", f"token {token}")
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                body = r.read()
                return (_json.loads(body) if body.strip() else {}), None
        except urllib.error.HTTPError as e:
            if e.code in (204, 201):
                return {}, None
            return None, f"HTTP {e.code}: {e.reason}"
        except Exception as e:
            return None, str(e)

    def trigger_workflow(wf):
        _, err = _github_request("POST", f"/actions/workflows/{wf}/dispatches", {"ref": "main"})
        return (False, f"起動失敗: {err}") if err else (True, "✅ GitHub Actions を起動しました")

    def get_run_status(wf):
        data, err = _github_request("GET", f"/actions/workflows/{wf}/runs?per_page=1")
        if err or not data:
            return None
        runs = data.get("workflow_runs", [])
        return runs[0] if runs else None

    def render_run_status(run):
        if not run: return
        status     = run.get("status", "")
        conclusion = run.get("conclusion", "")
        dt = to_jst(run.get("updated_at", ""))
        updated = dt.strftime("%m/%d %H:%M JST") if dt else ""
        url    = run.get("html_url", "#")

        if status in ("in_progress", "queued"):
            st.markdown(f"""<div class="run-status running">
                ⏳ <strong>実行中...</strong>　{updated}
                <a href="{url}" target="_blank" style="color:#92400e;">ログを確認 →</a>
            </div>""", unsafe_allow_html=True)
        elif conclusion == "success":
            st.markdown(f"""<div class="run-status success">
                ✅ <strong>完了</strong>　{updated}
                <a href="{url}" target="_blank" style="color:#166534;">ログを確認 →</a>
            </div>""", unsafe_allow_html=True)
        elif conclusion in ("failure", "cancelled"):
            st.markdown(f"""<div class="run-status failure">
                ❌ <strong>失敗</strong>　{updated}
                <a href="{url}" target="_blank" style="color:#9f1239;">ログを確認 →</a>
            </div>""", unsafe_allow_html=True)
        else:
            st.caption(f"ステータス: {status}/{conclusion}　[ログ]({url})")

    col_left, col_right = st.columns(2)

    with col_left:
        st.markdown("""
        <div class="action-panel">
            <div class="action-panel-title">📊 売買分析</div>
            <div class="action-panel-desc">
                監視銘柄に対して Claude AI がテクニカル分析を実行。<br>
                毎営業日 <strong>15:30 JST</strong> に自動実行されます。
            </div>
        </div>
        """, unsafe_allow_html=True)
        st.markdown("<div style='height:8px;'></div>", unsafe_allow_html=True)
        if st.button("▶ 今すぐ実行", type="primary", use_container_width=True, key="run_trading"):
            ok, msg = trigger_workflow("trading-bot.yml")
            st.session_state["trading_msg"] = (ok, msg)
        if "trading_msg" in st.session_state:
            ok, msg = st.session_state["trading_msg"]
            (st.success if ok else st.error)(msg)
        render_run_status(get_run_status("trading-bot.yml"))

    with col_right:
        st.markdown("""
        <div class="action-panel">
            <div class="action-panel-title">📡 銘柄選定スキャン</div>
            <div class="action-panel-desc">
                東証上場から 200 社をサンプリングし上位 8 銘柄を選定。<br>
                <strong>月 1〜2 回</strong>の実行を推奨します。
            </div>
        </div>
        """, unsafe_allow_html=True)
        st.markdown("<div style='height:8px;'></div>", unsafe_allow_html=True)
        if st.button("▶ 今すぐ実行", type="primary", use_container_width=True, key="run_scan"):
            ok, msg = trigger_workflow("watchlist-scan.yml")
            st.session_state["scan_msg"] = (ok, msg)
        if "scan_msg" in st.session_state:
            ok, msg = st.session_state["scan_msg"]
            (st.success if ok else st.error)(msg)
        render_run_status(get_run_status("watchlist-scan.yml"))

    # ── 監視銘柄リスト ────────────────────────────────────
    st.markdown('<div class="sec-head">現在の監視銘柄</div>', unsafe_allow_html=True)
    wl = get_watchlist()
    if not wl.empty:
        for i, (_, row) in enumerate(wl.iterrows()):
            sig   = row.get('signal', 'HOLD')
            score = int(row.get('technical_score', 0) or 0)
            name  = row.get('name') or row['symbol']
            score_pct = min(score, 100)
            badge_cls = "badge-buy" if sig == "BUY" else "badge-sell" if sig == "SELL" else "badge-hold"
            st.markdown(f"""
            <div class="wl-row">
                <div style='display:flex;align-items:center;gap:12px;'>
                    <div class="wl-rank">{i+1}</div>
                    <div>
                        <div class="wl-name">{row['symbol']}　{name}</div>
                        <div class="wl-sub">
                            <span class="{badge_cls}" style="padding:1px 8px;font-size:0.65rem;">{sig}</span>
                        </div>
                    </div>
                </div>
                <div style='text-align:right;'>
                    <div style='font-size:0.72rem;color:#94a3b8;margin-bottom:4px;'>{score}pt</div>
                    <div class="score-bg">
                        <div class="score-fill" style='width:{score_pct}%;'></div>
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)
    else:
        st.markdown("""
        <div class="empty-state">
            <span class="emoji">📡</span>
            ウォッチリストはまだありません。<br>
            <small>銘柄選定スキャンを実行してください</small>
        </div>
        """, unsafe_allow_html=True)

    # ── 本日の AI 判断ログ ────────────────────────────────
    st.markdown('<div class="sec-head">本日の AI 判断ログ</div>', unsafe_allow_html=True)
    logs_df = get_analysis_logs(50)
    today_jst = datetime.now(JST).date()

    def render_log_row(row):
        decision = row.get('decision', '')
        dt   = to_jst(row.get('timestamp', ''))
        ts   = dt.strftime('%H:%M') if dt else '—'
        icon = '🟢 BUY' if decision == 'BUY' else '🔴 SELL' if decision == 'SELL' else '🟡 HOLD'
        price= float(row.get('price') or 0)
        conf = float(row.get('confidence') or 0)
        with st.expander(f"{ts}　{row.get('symbol','')}　{icon}　¥{price:,.0f}　信頼度 {conf*100:.0f}%"):
            c1, c2, c3 = st.columns(3)
            c1.metric("単価", f"¥{price:,.0f}")
            c2.metric("株数", f"{row.get('quantity', 0)}株")
            c3.metric("信頼度", f"{conf*100:.0f}%")
            if decision == 'BUY':
                sl = row.get('stop_loss')
                tp = row.get('take_profit')
                rr = row.get('risk_reward')
                sc1, sc2, sc3 = st.columns(3)
                sc1.metric("🛑 損切り", f"¥{float(sl):,.0f}" if sl else "—")
                sc2.metric("🎯 利確",   f"¥{float(tp):,.0f}" if tp else "—")
                sc3.metric("R/R",      f"{float(rr):.2f}"    if rr else "—")
            if decision == 'SELL':
                pnl = row.get('pnl')
                pct = row.get('pnl_percent')
                if pnl is not None:
                    sign = "+" if float(pnl) >= 0 else ""
                    st.metric("損益試算", f"{sign}¥{float(pnl):,.0f}",
                               delta=f"{sign}{float(pct or 0):.2f}%",
                               delta_color="normal" if float(pnl) >= 0 else "inverse")
                if row.get('close_reason'):
                    st.caption(f"理由: {row['close_reason']}")

    if logs_df.empty:
        st.markdown("""
        <div class="empty-state">
            <span class="emoji">🤖</span>
            まだ分析結果がありません
        </div>
        """, unsafe_allow_html=True)
    else:
        today_rows = [row for _, row in logs_df.iterrows()
                      if to_jst(row.get('timestamp','')) and
                         to_jst(row.get('timestamp','')).date() == today_jst]
        past_rows  = [row for _, row in logs_df.iterrows()
                      if to_jst(row.get('timestamp','')) and
                         to_jst(row.get('timestamp','')).date() != today_jst]

        if today_rows:
            for row in today_rows:
                render_log_row(row)
        else:
            st.markdown("""
            <div class="empty-state">
                <span class="emoji">📅</span>
                本日の判断ログはまだありません
            </div>
            """, unsafe_allow_html=True)

        if past_rows:
            with st.expander(f"📂 過去のログ（{len(past_rows)}件）"):
                for row in past_rows:
                    render_log_row(row)


# ══════════════════════════════════════════════════════════════
# PAGE: ⚙️ 設定
# ══════════════════════════════════════════════════════════════
elif "設定" in page:
    st.markdown("""
    <div class="page-header">
        <h1>⚙️ 設定</h1>
        <p>取引パラメータ・軍資金・データベース設定</p>
    </div>
    """, unsafe_allow_html=True)

    env = load_env()

    st.markdown('<div class="sec-head">取引パラメータ</div>', unsafe_allow_html=True)
    with st.container(border=True):
        col1, col2 = st.columns(2)
        confidence = col1.slider(
            "AI信頼度しきい値（%）", min_value=50, max_value=90,
            value=int(float(env.get('CONFIDENCE_THRESHOLD', 0.60)) * 100),
            help="この信頼度以上の銘柄のみ売買推奨を出す"
        )
        max_pos_pct = col2.slider(
            "1ポジション上限（%）", min_value=10, max_value=100, step=5,
            value=int(float(env.get('MAX_POSITION_PERCENT', 0.20)) * 100),
            help="軍資金の何%まで1銘柄に投資するか"
        )
        col3, col4 = st.columns(2)
        sl = col3.number_input("損切りライン（%）",
                               value=float(env.get('STOP_LOSS_PERCENT', 0.05)) * 100, step=0.5)
        tp = col4.number_input("利確ライン（%）",
                               value=float(env.get('TAKE_PROFIT_PERCENT', 0.10)) * 100, step=0.5)

        cap = int(env.get('PORTFOLIO_VALUE', 10000))
        st.markdown(f"""
        <div style='background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;
                    padding:10px 14px;margin:8px 0;font-size:0.82rem;color:#1d4ed8;'>
            💡 軍資金 ¥{cap:,} × {max_pos_pct}% = <strong>1ポジション最大 ¥{int(cap * max_pos_pct / 100):,}</strong>
        </div>
        """, unsafe_allow_html=True)

        if st.button("💾 取引設定を保存", type="primary"):
            save_env_key('CONFIDENCE_THRESHOLD', str(confidence / 100))
            save_env_key('MAX_POSITION_PERCENT', str(max_pos_pct / 100))
            save_env_key('STOP_LOSS_PERCENT', str(sl / 100))
            save_env_key('TAKE_PROFIT_PERCENT', str(tp / 100))
            st.success("✅ 保存しました。GitHub Secrets の `MAX_POSITION_PERCENT` も更新してください。")

    st.markdown('<div class="sec-head">軍資金を更新</div>', unsafe_allow_html=True)
    with st.container(border=True):
        st.info("💡 損益・決済履歴・保有ポジションはそのまま保持されます。")
        new_capital = st.number_input(
            "軍資金（¥）", min_value=1000, step=1000,
            value=int(env.get('PORTFOLIO_VALUE', 10000))
        )
        if st.button("💾 軍資金を更新する", type="primary"):
            today = date.today().isoformat()
            cur_port      = get_portfolio()
            total_gains   = float(cur_port.get('total_gains', 0))
            monthly_gains = float(cur_port.get('monthly_gains', 0))
            invested      = float(cur_port.get('invested_stocks', 0))
            deposits      = float(cur_port.get('deposits', 0))
            withdrawals   = float(cur_port.get('withdrawals', 0))
            # 余力 = 新軍資金 - 保有株評価額（マイナスにならないよう0以上に）
            available = max(new_capital - invested, 0)
            # 総資産 = 新軍資金 + 累計損益
            current = new_capital + total_gains
            existing = query("SELECT id FROM portfolio ORDER BY date DESC LIMIT 1")
            if not existing.empty:
                execute(
                    "UPDATE portfolio SET initial_capital=?, current_capital=?, "
                    "available_cash=?, date=? WHERE id=?",
                    (new_capital, current, available, today, int(existing.iloc[0]['id']))
                )
            else:
                execute(
                    "INSERT INTO portfolio (date, initial_capital, current_capital, "
                    "available_cash, invested_stocks, deposits, withdrawals, "
                    "total_gains, monthly_gains) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (today, new_capital, current, available, invested,
                     deposits, withdrawals, total_gains, monthly_gains)
                )
            save_env_key('PORTFOLIO_VALUE', str(int(new_capital)))
            st.cache_data.clear()
            st.success(f"✅ 軍資金を ¥{new_capital:,} に更新しました（損益・履歴は保持されています）。")

    st.markdown('<div class="sec-head">データベース</div>', unsafe_allow_html=True)
    with st.container(border=True):
        if is_cloud():
            st.success("✅ Neon PostgreSQL（クラウド）に接続中")
            masked = DATABASE_URL[:35] + "..." if len(DATABASE_URL) > 35 else DATABASE_URL
            st.caption(f"接続先: {masked}")
        else:
            if DB_PATH.exists():
                st.success(f"✅ SQLite（ローカル）: {DB_PATH}")
            else:
                st.error("❌ データベースファイルが見つかりません")
