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
# CSS — ダークモード × プロ仕様トレーディングダッシュボード
# ══════════════════════════════════════════════════════════════
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

/* ── リセット & ベース ─────────────────────────────── */
html, body, [class*="css"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
}

/* ── メインエリア ─────────────────────────────────── */
.stApp { background-color: #0d1117; }
.main .block-container {
    background-color: #0d1117;
    padding-top: 1.5rem;
    padding-bottom: 3rem;
    max-width: 1280px;
}

/* テキスト全般をライトに */
.stApp p, .stApp span, .stApp div, .stApp label,
.stApp li, .stApp h1, .stApp h2, .stApp h3,
[data-testid="stText"], [data-testid="stMarkdown"] {
    color: #e6edf3;
}

/* ── サイドバー ───────────────────────────────────── */
section[data-testid="stSidebar"] {
    background: #080c18 !important;
    border-right: 1px solid #1e2d45 !important;
    min-width: 220px !important;
}
section[data-testid="stSidebar"] * { color: #c9d1d9 !important; }

/* サイドバーのラジオボタンをナビゲーションに */
section[data-testid="stSidebar"] .stRadio > div > div[data-testid="stWidgetLabel"] {
    display: none;
}
section[data-testid="stSidebar"] .stRadio div[role="radiogroup"] {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"] {
    background: transparent;
    border-radius: 10px;
    padding: 4px 8px;
    transition: background 0.15s ease;
    width: 100%;
    box-sizing: border-box;
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"]:hover {
    background: rgba(88, 166, 255, 0.08);
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"] > div:first-child {
    display: none;
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"] label {
    font-size: 0.875rem !important;
    font-weight: 500 !important;
    padding: 8px 12px;
    cursor: pointer;
    width: 100%;
    color: #8b949e !important;
    border-radius: 8px;
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"][data-checked="true"] {
    background: rgba(88, 166, 255, 0.12);
    border: 1px solid rgba(88, 166, 255, 0.2);
}
section[data-testid="stSidebar"] .stRadio div[data-baseweb="radio"][data-checked="true"] label {
    color: #58a6ff !important;
    font-weight: 600 !important;
}

/* サイドバーのボタン */
section[data-testid="stSidebar"] .stButton button {
    background: rgba(88,166,255,0.08) !important;
    border: 1px solid rgba(88,166,255,0.2) !important;
    color: #58a6ff !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    transition: all 0.2s !important;
}
section[data-testid="stSidebar"] .stButton button:hover {
    background: rgba(88,166,255,0.15) !important;
}
section[data-testid="stSidebar"] hr {
    border-color: #1e2d45 !important;
    margin: 12px 0 !important;
}

/* ── ページヘッダー ───────────────────────────────── */
.page-hero {
    background: linear-gradient(135deg, #0f2041 0%, #1a1040 50%, #0f2041 100%);
    border: 1px solid #1e3a5f;
    border-radius: 16px;
    padding: 28px 32px;
    margin-bottom: 28px;
    position: relative;
    overflow: hidden;
}
.page-hero::before {
    content: '';
    position: absolute;
    top: -80px; right: -80px;
    width: 200px; height: 200px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(88,166,255,0.12) 0%, transparent 70%);
    pointer-events: none;
}
.page-hero::after {
    content: '';
    position: absolute;
    bottom: -60px; left: 40%;
    width: 150px; height: 150px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(63,185,80,0.08) 0%, transparent 70%);
    pointer-events: none;
}
.page-hero-title {
    font-size: 1.5rem;
    font-weight: 800;
    color: #e6edf3 !important;
    margin: 0 0 4px 0;
    letter-spacing: -0.02em;
}
.page-hero-sub {
    font-size: 0.82rem;
    color: #8b949e !important;
    margin: 0;
}

/* ── KPI カード ─────────────────────────────────── */
.kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 16px;
    margin-bottom: 28px;
}
.kpi-card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 14px;
    padding: 20px 22px;
    position: relative;
    overflow: hidden;
    transition: border-color 0.2s, transform 0.15s;
}
.kpi-card:hover {
    border-color: #30363d;
    transform: translateY(-1px);
}
.kpi-card-icon {
    font-size: 1.4rem;
    margin-bottom: 10px;
    display: block;
}
.kpi-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #8b949e;
    margin-bottom: 6px;
}
.kpi-value {
    font-size: 1.55rem;
    font-weight: 800;
    color: #e6edf3;
    letter-spacing: -0.03em;
    line-height: 1.1;
}
.kpi-delta {
    font-size: 0.75rem;
    font-weight: 500;
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
}
.kpi-delta.pos { color: #3fb950; }
.kpi-delta.neg { color: #f85149; }
.kpi-delta.neu { color: #8b949e; }

/* カード左ボーダーアクセント */
.kpi-card.blue  { border-left: 3px solid #58a6ff; }
.kpi-card.green { border-left: 3px solid #3fb950; }
.kpi-card.amber { border-left: 3px solid #d29922; }
.kpi-card.red   { border-left: 3px solid #f85149; }
.kpi-card.purple{ border-left: 3px solid #bc8cff; }

/* ── ポジションカード ─────────────────────────── */
.pos-card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 14px;
    padding: 18px 22px;
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    gap: 18px;
    transition: border-color 0.2s;
}
.pos-card:hover { border-color: #30363d; }
.pos-ticker {
    font-size: 1.15rem;
    font-weight: 800;
    color: #e6edf3;
    letter-spacing: -0.01em;
    min-width: 64px;
}
.pos-info { color: #8b949e; font-size: 0.82rem; line-height: 1.6; flex: 1; }
.pos-info strong { color: #c9d1d9; font-weight: 600; }
.pnl-pos { font-weight: 700; color: #3fb950; font-size: 0.95rem; }
.pnl-neg { font-weight: 700; color: #f85149; font-size: 0.95rem; }
.pos-tag {
    background: rgba(63,185,80,0.12);
    color: #3fb950;
    border: 1px solid rgba(63,185,80,0.25);
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    white-space: nowrap;
}

/* ── 売買シグナルカード ───────────────────────── */
.signal-card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 14px;
    padding: 20px 22px;
    margin-bottom: 14px;
    transition: border-color 0.2s, transform 0.15s;
}
.signal-card:hover { transform: translateY(-2px); border-color: #30363d; }
.signal-card.buy  {
    border-top: 3px solid #3fb950;
    background: linear-gradient(180deg, rgba(63,185,80,0.05) 0%, #161b22 100%);
}
.signal-card.sell {
    border-top: 3px solid #f85149;
    background: linear-gradient(180deg, rgba(248,81,73,0.05) 0%, #161b22 100%);
}
.sig-ticker { font-size: 1.3rem; font-weight: 800; color: #e6edf3; letter-spacing: -0.02em; }
.sig-price  { font-size: 0.85rem; color: #8b949e; margin-top: 2px; }

/* バッジ */
.badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 12px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}
.badge-buy  { background: rgba(63,185,80,0.15); color: #3fb950; border: 1px solid rgba(63,185,80,0.3); }
.badge-sell { background: rgba(248,81,73,0.15); color: #f85149; border: 1px solid rgba(248,81,73,0.3); }
.badge-hold { background: rgba(139,148,158,0.15); color: #8b949e; border: 1px solid rgba(139,148,158,0.3); }
.conf-badge {
    background: rgba(88,166,255,0.12);
    color: #58a6ff;
    border: 1px solid rgba(88,166,255,0.25);
    padding: 3px 10px;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
}

/* インフォグリッド (SL/TP/RR) */
.info-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin-top: 16px;
}
.info-cell {
    background: #0d1117;
    border: 1px solid #21262d;
    border-radius: 10px;
    padding: 10px 14px;
    text-align: center;
}
.info-cell-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #8b949e;
    margin-bottom: 5px;
}
.info-cell-value { font-size: 1rem; font-weight: 700; color: #e6edf3; }
.info-cell-value.sl { color: #f85149; }
.info-cell-value.tp { color: #3fb950; }

/* ── ステータスバッジ ─────────────────────────── */
.run-status {
    border-radius: 12px;
    padding: 12px 18px;
    font-size: 0.83rem;
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
}
.run-status.running {
    background: rgba(210,153,34,0.1);
    border: 1px solid rgba(210,153,34,0.3);
    color: #d29922;
}
.run-status.success {
    background: rgba(63,185,80,0.1);
    border: 1px solid rgba(63,185,80,0.3);
    color: #3fb950;
}
.run-status.failure {
    background: rgba(248,81,73,0.1);
    border: 1px solid rgba(248,81,73,0.3);
    color: #f85149;
}

/* ── セクションヘッダー ───────────────────────── */
.sec-head {
    font-size: 0.78rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #8b949e;
    margin: 28px 0 14px 0;
    padding-bottom: 10px;
    border-bottom: 1px solid #21262d;
}

/* ── ウォッチリストアイテム ─────────────────── */
.wl-row {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 12px;
    padding: 14px 18px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: border-color 0.15s;
}
.wl-row:hover { border-color: #30363d; }
.wl-rank {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: linear-gradient(135deg, #1f3358, #1a1040);
    border: 1px solid #2d4a7a;
    color: #58a6ff;
    font-size: 0.72rem;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.wl-name { font-weight: 600; color: #e6edf3; font-size: 0.88rem; }
.wl-sub  { font-size: 0.72rem; color: #8b949e; margin-top: 2px; }
.score-bg {
    background: #21262d;
    border-radius: 4px;
    height: 5px;
    width: 72px;
    overflow: hidden;
    display: inline-block;
    vertical-align: middle;
}
.score-fill {
    height: 100%;
    border-radius: 4px;
    background: linear-gradient(90deg, #1f6feb, #58a6ff);
}

/* ── アクションパネル (AI分析) ─────────────── */
.action-panel {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 16px;
    padding: 24px;
    height: 100%;
}
.action-panel-title { font-size: 1rem; font-weight: 700; color: #e6edf3; margin-bottom: 6px; }
.action-panel-desc  { font-size: 0.78rem; color: #8b949e; line-height: 1.6; margin-bottom: 18px; }

/* ── 空状態 ──────────────────────────────────── */
.empty-state {
    background: #161b22;
    border: 1px dashed #30363d;
    border-radius: 14px;
    padding: 36px 24px;
    text-align: center;
    color: #8b949e;
    font-size: 0.875rem;
}
.empty-state .emoji { font-size: 2rem; display: block; margin-bottom: 10px; }

/* ── ボタン ──────────────────────────────────── */
.stButton button {
    border-radius: 8px !important;
    font-weight: 600 !important;
    transition: all 0.2s !important;
}
.stButton button[kind="primary"] {
    background: #1f6feb !important;
    border: 1px solid #388bfd !important;
    color: white !important;
    box-shadow: 0 0 0 0 rgba(31,111,235,0) !important;
}
.stButton button[kind="primary"]:hover {
    background: #388bfd !important;
    box-shadow: 0 4px 16px rgba(31,111,235,0.35) !important;
    transform: translateY(-1px);
}

/* ── タブ ───────────────────────────────────── */
.stTabs [data-baseweb="tab-list"] {
    background: #161b22;
    border-radius: 10px;
    padding: 4px;
    gap: 4px;
    border: 1px solid #21262d;
}
.stTabs [data-baseweb="tab"] {
    border-radius: 7px;
    padding: 8px 16px;
    font-size: 0.83rem;
    font-weight: 500;
    color: #8b949e;
}
.stTabs [aria-selected="true"] {
    background: #21262d !important;
    color: #e6edf3 !important;
    font-weight: 600 !important;
    box-shadow: none !important;
}

/* ── Plotly チャートの背景透過 ──────────────── */
.stPlotlyChart { border-radius: 14px; overflow: hidden; }
.js-plotly-plot .plotly { background: transparent !important; }

/* ── メトリクス ─────────────────────────────── */
[data-testid="stMetric"] {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 10px;
    padding: 12px 16px;
}
[data-testid="stMetricLabel"] { color: #8b949e !important; font-size: 0.72rem !important; }
[data-testid="stMetricValue"] { color: #e6edf3 !important; font-weight: 700 !important; }
[data-testid="stMetricDelta"] > div { font-size: 0.78rem !important; }

/* ── expander ───────────────────────────────── */
[data-testid="stExpander"] {
    border-color: #21262d !important;
    background: #161b22 !important;
    border-radius: 12px !important;
}
[data-testid="stExpander"] summary {
    color: #c9d1d9 !important;
    font-weight: 500 !important;
}

/* ── フォーム/入力 ────────────────────────── */
.stTextInput input, .stNumberInput input, .stTextArea textarea {
    background: #0d1117 !important;
    border-color: #30363d !important;
    color: #e6edf3 !important;
    border-radius: 8px !important;
}
.stTextInput input:focus, .stNumberInput input:focus, .stTextArea textarea:focus {
    border-color: #1f6feb !important;
    box-shadow: 0 0 0 3px rgba(31,111,235,0.2) !important;
}
.stSelectbox [data-baseweb="select"] > div {
    background: #0d1117 !important;
    border-color: #30363d !important;
    color: #e6edf3 !important;
    border-radius: 8px !important;
}
.stSlider [data-baseweb="slider"] { background: #21262d !important; }
.stDateInput input {
    background: #0d1117 !important;
    border-color: #30363d !important;
    color: #e6edf3 !important;
    border-radius: 8px !important;
}
label, .stTextInput label, .stNumberInput label,
.stSelectbox label, .stDateInput label, .stSlider label,
.stTextArea label {
    color: #8b949e !important;
    font-size: 0.78rem !important;
    font-weight: 600 !important;
    letter-spacing: 0.04em !important;
}
[data-testid="stForm"] {
    background: #161b22 !important;
    border: 1px solid #21262d !important;
    border-radius: 14px !important;
    padding: 20px !important;
}
/* ── データフレーム ──────────────────────── */
[data-testid="stDataFrame"] {
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #21262d;
}
.dvn-scroller { background: #161b22 !important; }

/* ── アラート/情報 ───────────────────────── */
.stAlert {
    border-radius: 10px !important;
    border: none !important;
    font-size: 0.83rem !important;
}

/* ── ログイン画面 ────────────────────────── */
.login-wrap {
    max-width: 360px;
    margin: 80px auto;
    text-align: center;
}
.login-card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 20px;
    padding: 40px 36px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}
.login-logo  { font-size: 3rem; margin-bottom: 8px; display: block; }
.login-title { font-size: 1.5rem; font-weight: 800; color: #e6edf3; margin-bottom: 4px; }
.login-sub   { font-size: 0.8rem; color: #8b949e; margin-bottom: 28px; }

/* ── コンテナ/ボーダー ───────────────────── */
[data-testid="stVerticalBlock"] .element-container {
    margin-bottom: 0;
}
hr { border-color: #21262d !important; }

/* スピナー */
.stSpinner > div { border-top-color: #58a6ff !important; }

/* caption */
.stCaption { color: #8b949e !important; font-size: 0.75rem !important; }

/* selectbox dropdown */
[data-baseweb="menu"] {
    background: #161b22 !important;
    border: 1px solid #21262d !important;
    border-radius: 8px !important;
}
[data-baseweb="menu"] li {
    background: #161b22 !important;
    color: #e6edf3 !important;
}
[data-baseweb="menu"] li:hover { background: #21262d !important; }
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

def fmt_pnl(v, pct=None):
    """損益を符号付き文字列にフォーマット"""
    v = float(v or 0)
    sign = "+" if v >= 0 else ""
    s = f"{sign}¥{v:,.0f}"
    if pct is not None:
        p = float(pct or 0)
        s += f" ({sign}{p:.2f}%)"
    return s

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
    <div class="login-wrap">
        <div class="login-card">
            <span class="login-logo">📈</span>
            <div class="login-title">CASATS</div>
            <div class="login-sub">Claude AI Stock Auto Trading System</div>
        </div>
    </div>
    """, unsafe_allow_html=True)
    col = st.columns([1, 2, 1])[1]
    with col:
        pwd = st.text_input("パスワード", type="password",
                            label_visibility="collapsed",
                            placeholder="パスワードを入力...")
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
    # ロゴ
    st.markdown("""
    <div style='padding: 8px 4px 4px 4px;'>
        <div style='font-size:1.2rem;font-weight:800;color:#e6edf3;letter-spacing:-0.02em;'>
            📈 CASATS
        </div>
        <div style='font-size:0.65rem;color:#8b949e;margin-top:2px;letter-spacing:0.05em;text-transform:uppercase;'>
            AI Stock Trading System
        </div>
    </div>
    """, unsafe_allow_html=True)

    # DB バッジ
    db_label = "🌐 Neon DB" if is_cloud() else "💻 SQLite"
    db_color = "#3fb950" if is_cloud() else "#d29922"
    st.markdown(
        f"<div style='display:inline-block;background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.2);"
        f"border-radius:6px;padding:3px 10px;font-size:0.68rem;font-weight:600;color:{db_color};"
        f"margin:4px 0 8px 0;'>{db_label}</div>",
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

    # ポートフォリオ要約
    port = get_portfolio()
    if port:
        cap   = float(port.get('current_capital', 0))
        init  = float(port.get('initial_capital', cap))
        cash  = float(port.get('available_cash', 0))
        gains = float(port.get('total_gains', 0))
        ratio = (1 - cash / cap) * 100 if cap > 0 else 0
        g_sign  = "+" if gains >= 0 else ""
        g_color = "#3fb950" if gains >= 0 else "#f85149"
        g_pct   = gains / init * 100 if init else 0

        st.markdown(f"""
        <div style='background:#0d1117;border:1px solid #1e2d45;border-radius:12px;padding:16px;'>
            <div style='font-size:0.62rem;text-transform:uppercase;letter-spacing:0.08em;color:#8b949e;margin-bottom:4px;'>総資産</div>
            <div style='font-size:1.4rem;font-weight:800;color:#e6edf3;letter-spacing:-0.02em;'>¥{cap:,.0f}</div>
            <div style='font-size:0.72rem;font-weight:600;color:{g_color};margin-top:2px;margin-bottom:12px;'>
                {g_sign}¥{abs(gains):,.0f} ({g_sign}{g_pct:.2f}%)
            </div>
            <div style='font-size:0.62rem;color:#8b949e;margin-bottom:4px;'>余力 ¥{cash:,.0f}</div>
            <div style='background:#1e2d45;border-radius:4px;height:5px;overflow:hidden;'>
                <div style='background:linear-gradient(90deg,#1f6feb,#58a6ff);height:100%;width:{ratio:.0f}%;border-radius:4px;'></div>
            </div>
            <div style='font-size:0.65rem;color:#8b949e;margin-top:4px;text-align:right;'>投資比率 {ratio:.1f}%</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("<div style='height:8px;'></div>", unsafe_allow_html=True)
    if st.button("⟳  データ更新", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

    # 現在時刻
    now_jst = datetime.now(JST)
    st.markdown(
        f"<div style='text-align:center;font-size:0.65rem;color:#8b949e;margin-top:12px;'>"
        f"{now_jst.strftime('%Y/%m/%d %H:%M')} JST</div>",
        unsafe_allow_html=True
    )


# ══════════════════════════════════════════════════════════════
# PAGE: 📊 ダッシュボード
# ══════════════════════════════════════════════════════════════
if "ダッシュボード" in page:
    st.markdown("""
    <div class="page-hero">
        <div class="page-hero-title">📊 ダッシュボード</div>
        <div class="page-hero-sub">ポートフォリオの概要・保有ポジション・資産推移</div>
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
        gain_arr = "▲" if gains >= 0 else "▼"
        g_sign   = "+" if gains >= 0 else ""

        st.markdown(f"""
        <div class="kpi-grid">
            <div class="kpi-card blue">
                <span class="kpi-card-icon">💰</span>
                <div class="kpi-label">総資産</div>
                <div class="kpi-value">¥{cap:,.0f}</div>
                <div class="kpi-delta neu">元本 ¥{init_cap:,.0f}</div>
            </div>
            <div class="kpi-card green">
                <span class="kpi-card-icon">🏦</span>
                <div class="kpi-label">余力（現金）</div>
                <div class="kpi-value">¥{cash:,.0f}</div>
                <div class="kpi-delta neu">{(cash/cap*100 if cap else 0):.1f}% of portfolio</div>
            </div>
            <div class="kpi-card amber">
                <span class="kpi-card-icon">📦</span>
                <div class="kpi-label">株式評価額</div>
                <div class="kpi-value">¥{invested:,.0f}</div>
                <div class="kpi-delta neu">{(invested/cap*100 if cap else 0):.1f}% of portfolio</div>
            </div>
            <div class="kpi-card {'green' if gains >= 0 else 'red'}">
                <span class="kpi-card-icon">{'📈' if gains >= 0 else '📉'}</span>
                <div class="kpi-label">累計損益</div>
                <div class="kpi-value">{g_sign}¥{abs(gains):,.0f}</div>
                <div class="kpi-delta {gain_cls}">{gain_arr} {abs(gain_pct):.2f}%</div>
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
        total_unrealized = 0.0
        for _, row in pos_df.iterrows():
            sym     = row.get('symbol', '')
            qty     = int(row.get('quantity', 0))
            entry   = float(row.get('entry_price', 0))
            current = float(row.get('current_price') or entry)
            unr_pnl = float(row.get('unrealized_pnl') or (current - entry) * qty)
            unr_pct = float(row.get('unrealized_pnl_percent') or
                            ((current - entry) / entry * 100 if entry else 0))
            total_unrealized += unr_pnl
            pnl_cls = "pnl-pos" if unr_pnl >= 0 else "pnl-neg"
            sign    = "+" if unr_pnl >= 0 else ""
            arr     = "▲" if unr_pnl >= 0 else "▼"
            sl = row.get('stop_loss_price')
            tp = row.get('take_profit_price')

            st.markdown(f"""
            <div class="pos-card">
                <div>
                    <div class="pos-ticker">{sym}</div>
                    <span class="pos-tag">保有中</span>
                </div>
                <div class="pos-info" style="flex:1;">
                    <div>{qty}株　取得値 <strong>¥{entry:,.0f}</strong></div>
                    <div>現在値 <strong>¥{current:,.0f}</strong>
                        {'　🛑 ¥' + f'{float(sl):,.0f}' if sl else ''}
                        {'　🎯 ¥' + f'{float(tp):,.0f}' if tp else ''}
                    </div>
                </div>
                <div style="text-align:right;min-width:110px;">
                    <div class="{pnl_cls}">{sign}¥{abs(unr_pnl):,.0f}</div>
                    <div class="{pnl_cls}" style="font-size:0.8rem;">{arr} {abs(unr_pct):.2f}%</div>
                </div>
            </div>
            """, unsafe_allow_html=True)

        sign_t  = "+" if total_unrealized >= 0 else ""
        color_t = "#3fb950" if total_unrealized >= 0 else "#f85149"
        st.markdown(
            f"<div style='text-align:right;font-size:0.8rem;color:{color_t};"
            f"font-weight:600;margin-top:6px;padding-right:4px;'>"
            f"含み損益合計 {sign_t}¥{abs(total_unrealized):,.0f}</div>",
            unsafe_allow_html=True
        )

    # ── 資産推移グラフ ──────────────────────────────────────
    st.markdown('<div class="sec-head">資産推移</div>', unsafe_allow_html=True)
    hist_df = get_portfolio_history()
    if not hist_df.empty and 'current_capital' in hist_df.columns:
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=hist_df['date'], y=hist_df['current_capital'],
            mode='lines', name='総資産',
            line=dict(color='#58a6ff', width=2.5),
            fill='tozeroy', fillcolor='rgba(88,166,255,0.06)'
        ))
        if 'available_cash' in hist_df.columns:
            fig.add_trace(go.Scatter(
                x=hist_df['date'], y=hist_df['available_cash'],
                mode='lines', name='余力',
                line=dict(color='#3fb950', width=1.5, dash='dot')
            ))
        fig.update_layout(
            height=240,
            margin=dict(l=0, r=0, t=8, b=0),
            legend=dict(
                orientation='h', y=-0.18,
                font=dict(size=11, color='#8b949e'),
                bgcolor='rgba(0,0,0,0)'
            ),
            plot_bgcolor='#161b22',
            paper_bgcolor='rgba(0,0,0,0)',
            xaxis=dict(showgrid=False, color='#8b949e',
                       tickfont=dict(size=10, color='#8b949e'),
                       linecolor='#21262d', zeroline=False),
            yaxis=dict(showgrid=True, gridcolor='#21262d',
                       color='#8b949e',
                       tickfont=dict(size=10, color='#8b949e'),
                       zeroline=False),
            font=dict(family='Inter, sans-serif'),
            hoverlabel=dict(bgcolor='#1c2128', bordercolor='#30363d',
                            font=dict(color='#e6edf3', size=12)),
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
    <div class="page-hero">
        <div class="page-hero-title">📈 売買判定</div>
        <div class="page-hero-sub">最新の AI 分析による買い・売り推奨シグナル</div>
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
        # 最新日付を特定
        latest_ts = None
        for _, row in logs_df.iterrows():
            dt = to_jst(row.get('timestamp', ''))
            if dt and (latest_ts is None or dt > latest_ts):
                latest_ts = dt

        target_date = latest_ts.date() if latest_ts else None
        latest_rows = [row for _, row in logs_df.iterrows()
                       if to_jst(row.get('timestamp', '')) and
                          to_jst(row.get('timestamp', '')).date() == target_date]

        # 最終分析バー
        if latest_ts:
            buy_n  = sum(1 for r in latest_rows if r.get('decision') == 'BUY')
            sell_n = sum(1 for r in latest_rows if r.get('decision') == 'SELL')
            hold_n = len(latest_rows) - buy_n - sell_n
            st.markdown(f"""
            <div style='background:#161b22;border:1px solid #21262d;border-radius:12px;
                        padding:14px 20px;display:flex;align-items:center;
                        justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;'>
                <div>
                    <div style='font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;
                                color:#8b949e;margin-bottom:2px;'>最終分析</div>
                    <div style='font-weight:700;color:#e6edf3;'>
                        {latest_ts.strftime('%Y年%m月%d日　%H:%M')} JST
                    </div>
                </div>
                <div style='display:flex;gap:12px;'>
                    <div style='text-align:center;'>
                        <div style='font-size:1.2rem;font-weight:800;color:#3fb950;'>{buy_n}</div>
                        <div style='font-size:0.65rem;color:#8b949e;letter-spacing:0.05em;'>BUY</div>
                    </div>
                    <div style='width:1px;background:#21262d;'></div>
                    <div style='text-align:center;'>
                        <div style='font-size:1.2rem;font-weight:800;color:#f85149;'>{sell_n}</div>
                        <div style='font-size:0.65rem;color:#8b949e;letter-spacing:0.05em;'>SELL</div>
                    </div>
                    <div style='width:1px;background:#21262d;'></div>
                    <div style='text-align:center;'>
                        <div style='font-size:1.2rem;font-weight:800;color:#8b949e;'>{hold_n}</div>
                        <div style='font-size:0.65rem;color:#8b949e;letter-spacing:0.05em;'>HOLD</div>
                    </div>
                </div>
            </div>
            """, unsafe_allow_html=True)

        buy_rows  = [r for r in latest_rows if r.get('decision') == 'BUY']
        sell_rows = [r for r in latest_rows if r.get('decision') == 'SELL']

        col_b, col_s = st.columns(2)

        # ─ BUY シグナル ─────────────────────────────────
        with col_b:
            st.markdown(f"""
            <div style='display:flex;align-items:center;gap:8px;margin-bottom:14px;'>
                <span class="badge badge-buy">BUY</span>
                <span style='font-weight:700;color:#e6edf3;'>{len(buy_rows)} 銘柄</span>
            </div>
            """, unsafe_allow_html=True)

            if buy_rows:
                for row in buy_rows:
                    sl    = row.get('stop_loss')
                    tp    = row.get('take_profit')
                    rr    = row.get('risk_reward')
                    qty   = int(row.get('quantity', 0))
                    price = float(row.get('price') or 0)
                    conf  = float(row.get('confidence') or 0)
                    cost  = price * qty

                    info_html = ""
                    if sl and tp and rr:
                        info_html = f"""
                        <div class="info-grid">
                            <div class="info-cell">
                                <div class="info-cell-label">🛑 損切り</div>
                                <div class="info-cell-value sl">¥{float(sl):,.0f}</div>
                            </div>
                            <div class="info-cell">
                                <div class="info-cell-label">🎯 利確</div>
                                <div class="info-cell-value tp">¥{float(tp):,.0f}</div>
                            </div>
                            <div class="info-cell">
                                <div class="info-cell-label">R/R 比率</div>
                                <div class="info-cell-value">{float(rr):.2f}</div>
                            </div>
                        </div>
                        <div style='margin-top:10px;font-size:0.72rem;color:#8b949e;
                                    text-align:right;'>必要金額 ¥{cost:,.0f}</div>
                        """

                    st.markdown(f"""
                    <div class="signal-card buy">
                        <div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;'>
                            <div>
                                <div style='display:flex;align-items:center;gap:8px;'>
                                    <span class="sig-ticker">{row.get('symbol','')}</span>
                                    <span class="badge badge-buy">BUY</span>
                                </div>
                                <div class="sig-price">¥{price:,.0f} × {qty}株</div>
                            </div>
                            <span class="conf-badge">信頼度 {conf*100:.0f}%</span>
                        </div>
                        {info_html}
                    </div>
                    """, unsafe_allow_html=True)
            else:
                st.markdown("""
                <div class="empty-state" style="border-color:rgba(63,185,80,0.15);">
                    <span class="emoji">🟢</span>
                    本日の買い推奨はありません
                </div>
                """, unsafe_allow_html=True)

        # ─ SELL シグナル ─────────────────────────────────
        with col_s:
            st.markdown(f"""
            <div style='display:flex;align-items:center;gap:8px;margin-bottom:14px;'>
                <span class="badge badge-sell">SELL</span>
                <span style='font-weight:700;color:#e6edf3;'>{len(sell_rows)} 銘柄</span>
            </div>
            """, unsafe_allow_html=True)

            if sell_rows:
                for row in sell_rows:
                    pnl    = row.get('pnl')
                    pct    = row.get('pnl_percent')
                    reason = row.get('close_reason', '')
                    price  = float(row.get('price') or 0)
                    qty    = int(row.get('quantity', 0))
                    conf   = float(row.get('confidence') or 0)
                    pnl_html = ""
                    if pnl is not None:
                        pv = float(pnl)
                        pp = float(pct or 0)
                        sign = "+" if pv >= 0 else ""
                        clr  = "#3fb950" if pv >= 0 else "#f85149"
                        pnl_html = f"""
                        <div style='text-align:right;'>
                            <div style='font-weight:700;color:{clr};'>{sign}¥{abs(pv):,.0f}</div>
                            <div style='font-size:0.75rem;color:{clr};'>{sign}{pp:.2f}%</div>
                        </div>
                        """
                    reason_html = f"<div style='margin-top:10px;font-size:0.72rem;color:#8b949e;'>理由: {reason}</div>" if reason else ""

                    st.markdown(f"""
                    <div class="signal-card sell">
                        <div style='display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;'>
                            <div>
                                <div style='display:flex;align-items:center;gap:8px;'>
                                    <span class="sig-ticker">{row.get('symbol','')}</span>
                                    <span class="badge badge-sell">SELL</span>
                                </div>
                                <div class="sig-price">¥{price:,.0f} × {qty}株</div>
                            </div>
                            <div style='display:flex;flex-direction:column;align-items:flex-end;gap:4px;'>
                                <span class="conf-badge">信頼度 {conf*100:.0f}%</span>
                                {pnl_html}
                            </div>
                        </div>
                        {reason_html}
                    </div>
                    """, unsafe_allow_html=True)
            else:
                st.markdown("""
                <div class="empty-state" style="border-color:rgba(248,81,73,0.15);">
                    <span class="emoji">🔴</span>
                    本日の売り推奨はありません
                </div>
                """, unsafe_allow_html=True)

        # ─ 過去の判定履歴 ────────────────────────────────
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
                    st.markdown(
                        f"{icon} **{ts}　{row.get('symbol','')}　{decision}**"
                        f"　¥{price:,.0f}×{qty}株{extra}"
                    )


# ══════════════════════════════════════════════════════════════
# PAGE: 📝 売買記録
# ══════════════════════════════════════════════════════════════
elif "売買記録" in page:
    st.markdown("""
    <div class="page-hero">
        <div class="page-hero-title">📝 売買記録</div>
        <div class="page-hero-sub">実際に発注した内容を記録してください。損益は自動計算されます。</div>
    </div>
    """, unsafe_allow_html=True)

    tab_buy, tab_sell, tab_update = st.tabs(["🟢　購入を記録", "🔴　売却を記録", "🔄　現在値を更新"])

    with tab_buy:
        with st.form("form_buy", clear_on_submit=True):
            c1, c2 = st.columns(2)
            symbol = c1.text_input("銘柄コード", placeholder="例: 7203").strip()
            qty    = c2.number_input("購入株数", min_value=1, step=1, value=1)
            c3, c4 = st.columns(2)
            price  = c3.number_input("購入単価（¥）", min_value=1.0, step=1.0, value=1000.0)
            edate  = c4.date_input("購入日", value=date.today())
            c5, c6 = st.columns(2)
            sl_price = c5.number_input("損切り価格（¥）", min_value=0.0, step=1.0, value=0.0,
                                       help="AIログの「🛑 損切り価格」の値を入力")
            tp_price = c6.number_input("利確価格（¥）", min_value=0.0, step=1.0, value=0.0,
                                       help="AIログの「🎯 利確価格」の値を入力")
            note = st.text_area("メモ（任意）", height=68, placeholder="発注理由、メモなど...")
            submitted = st.form_submit_button("✅ 購入を記録する", type="primary", use_container_width=True)

        if submitted:
            if not symbol:
                st.error("銘柄コードを入力してください。")
            else:
                total = qty * price
                if is_cloud():
                    sql = """INSERT INTO positions
                        (symbol, quantity, entry_price, entry_date, stop_loss_price, take_profit_price, status, current_price)
                        VALUES (?, ?, ?, ?, ?, ?, 'holding', ?) RETURNING id"""
                else:
                    sql = """INSERT INTO positions
                        (symbol, quantity, entry_price, entry_date, stop_loss_price, take_profit_price, status, current_price)
                        VALUES (?, ?, ?, ?, ?, ?, 'holding', ?)"""
                execute(sql, (symbol, qty, price, edate.isoformat(),
                              sl_price if sl_price > 0 else None,
                              tp_price if tp_price > 0 else None, price))
                execute(
                    "INSERT INTO trades (symbol, decision, entry_price, quantity, confidence, reasoning, status, timestamp) VALUES (?, 'BUY', ?, ?, 1.0, ?, 'filled', ?)",
                    (symbol, price, qty, note or f"手動購入 {qty}株 @¥{price:,.0f}", datetime.now().isoformat())
                )
                st.cache_data.clear()
                st.success(f"✅ **{symbol}**　{qty}株　@¥{price:,.0f}　を記録しました（合計 ¥{total:,.0f}）")
                st.balloons()

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
                sell_qty   = c1.number_input("売却株数", min_value=1, max_value=qty_max, step=1, value=qty_max)
                sell_price = c2.number_input("売却単価（¥）", min_value=1.0, step=1.0, value=entry_p)
                c3, c4 = st.columns(2)
                sell_date   = c3.date_input("売却日", value=date.today())
                sell_reason = c4.selectbox("売却理由", ["利益確定", "損切り", "定期見直し", "その他"])
                note = st.text_area("メモ（任意）", height=68)
                submitted_sell = st.form_submit_button("✅ 売却を記録する", type="primary", use_container_width=True)

            if submitted_sell:
                pnl     = (sell_price - entry_p) * sell_qty
                pnl_pct = (sell_price - entry_p) / entry_p * 100 if entry_p else 0
                sign    = "+" if pnl >= 0 else ""
                pos_id  = int(selected_pos['id'])
                if sell_qty == qty_max:
                    execute(
                        "UPDATE positions SET status='closed', exit_price=?, exit_date=?, exit_reason=?, realized_pnl=?, realized_pnl_percent=?, current_price=? WHERE id=?",
                        (sell_price, sell_date.isoformat(), sell_reason, pnl, pnl_pct, sell_price, pos_id)
                    )
                else:
                    execute("UPDATE positions SET quantity=? WHERE id=?", (qty_max - sell_qty, pos_id))
                    execute(
                        "INSERT INTO positions (symbol, quantity, entry_price, entry_date, exit_price, exit_date, exit_reason, realized_pnl, realized_pnl_percent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'closed')",
                        (selected_pos['symbol'], sell_qty, entry_p, selected_pos['entry_date'],
                         sell_price, sell_date.isoformat(), sell_reason, pnl, pnl_pct)
                    )
                st.cache_data.clear()
                color = "#3fb950" if pnl >= 0 else "#f85149"
                st.success(
                    f"✅ **{selected_pos['symbol']}**　{sell_qty}株　@¥{sell_price:,.0f}\n\n"
                    f"損益: {sign}¥{abs(pnl):,.0f}（{sign}{pnl_pct:.2f}%）"
                )
                if pnl >= 0:
                    st.balloons()

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
                                "UPDATE positions SET current_price=?, unrealized_pnl=?, unrealized_pnl_percent=? WHERE id=?",
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
                            "UPDATE positions SET current_price=?, unrealized_pnl=?, unrealized_pnl_percent=? WHERE id=?",
                            (new_price, (new_price-entry)*qty, (new_price-entry)/entry*100, int(row['id']))
                        )
                        st.cache_data.clear()
                        st.rerun()


# ══════════════════════════════════════════════════════════════
# PAGE: 🤖 AI分析・銘柄選定
# ══════════════════════════════════════════════════════════════
elif "AI分析" in page:
    st.markdown("""
    <div class="page-hero">
        <div class="page-hero-title">🤖 AI分析・銘柄選定</div>
        <div class="page-hero-sub">Claude AI による売買分析と銘柄スキャンの実行管理</div>
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
        updated = dt.strftime("%m/%d %H:%M JST") if dt else run.get("updated_at", "")[:16]
        url    = run.get("html_url", "#")

        if status in ("in_progress", "queued"):
            st.markdown(f"""
            <div class="run-status running">
                ⏳ <strong>実行中...</strong>　{updated}
                　<a href="{url}" target="_blank" style="color:#d29922;text-decoration:none;">
                ログを確認 →</a>
            </div>
            """, unsafe_allow_html=True)
        elif conclusion == "success":
            st.markdown(f"""
            <div class="run-status success">
                ✅ <strong>完了</strong>　{updated}
                　<a href="{url}" target="_blank" style="color:#3fb950;text-decoration:none;">
                ログを確認 →</a>
            </div>
            """, unsafe_allow_html=True)
        elif conclusion in ("failure", "cancelled"):
            st.markdown(f"""
            <div class="run-status failure">
                ❌ <strong>失敗 / キャンセル</strong>　{updated}
                　<a href="{url}" target="_blank" style="color:#f85149;text-decoration:none;">
                ログを確認 →</a>
            </div>
            """, unsafe_allow_html=True)
        else:
            st.caption(f"ステータス: {status}/{conclusion}　[ログを確認]({url})")

    col_left, col_right = st.columns(2)

    with col_left:
        st.markdown("""
        <div class="action-panel">
            <div class="action-panel-title">📊 売買分析</div>
            <div class="action-panel-desc">
                監視銘柄に対して Claude AI がテクニカル分析を実行。<br>
                毎営業日 <strong style="color:#e6edf3;">15:30 JST</strong> に自動実行されます。
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
                <strong style="color:#e6edf3;">月 1〜2 回</strong>の実行を推奨します。
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
                            <span class="badge {badge_cls}" style="padding:1px 8px;font-size:0.65rem;">{sig}</span>
                        </div>
                    </div>
                </div>
                <div style='text-align:right;'>
                    <div style='font-size:0.72rem;color:#8b949e;margin-bottom:4px;'>{score}pt</div>
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
    <div class="page-hero">
        <div class="page-hero-title">⚙️ 設定</div>
        <div class="page-hero-sub">取引パラメータ・軍資金・データベース設定</div>
    </div>
    """, unsafe_allow_html=True)

    env = load_env()

    # ── 取引パラメータ ────────────────────────────────────
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
        <div style='background:rgba(31,111,235,0.08);border:1px solid rgba(31,111,235,0.2);
                    border-radius:10px;padding:12px 16px;margin:8px 0;
                    font-size:0.82rem;color:#58a6ff;'>
            💡 軍資金 ¥{cap:,} × {max_pos_pct}% = <strong>1ポジション最大 ¥{int(cap * max_pos_pct / 100):,}</strong>
        </div>
        """, unsafe_allow_html=True)

        if st.button("💾 取引設定を保存", type="primary"):
            save_env_key('CONFIDENCE_THRESHOLD', str(confidence / 100))
            save_env_key('MAX_POSITION_PERCENT', str(max_pos_pct / 100))
            save_env_key('STOP_LOSS_PERCENT', str(sl / 100))
            save_env_key('TAKE_PROFIT_PERCENT', str(tp / 100))
            st.success("✅ 保存しました。GitHub Secrets の `MAX_POSITION_PERCENT` も更新してください。")

    # ── 軍資金リセット ────────────────────────────────────
    st.markdown('<div class="sec-head">軍資金をリセット</div>', unsafe_allow_html=True)
    with st.container(border=True):
        st.warning("⚠️ 現在の資産・損益がすべてリセットされます。")
        new_capital = st.number_input(
            "新しい軍資金（¥）", min_value=1000, step=1000,
            value=int(env.get('PORTFOLIO_VALUE', 10000))
        )
        if st.button("🔄 この金額でリセットする", type="primary"):
            today = date.today().isoformat()
            execute("DELETE FROM portfolio")
            execute(
                "INSERT INTO portfolio (date, initial_capital, current_capital, available_cash, "
                "invested_stocks, deposits, withdrawals, total_gains, monthly_gains) "
                "VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0)",
                (today, new_capital, new_capital, new_capital)
            )
            save_env_key('PORTFOLIO_VALUE', str(int(new_capital)))
            st.cache_data.clear()
            st.success(f"✅ 軍資金を ¥{new_capital:,} にリセットしました。")

    # ── データベース情報 ──────────────────────────────────
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
