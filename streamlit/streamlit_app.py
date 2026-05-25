"""
Claude AI Stock Auto Trading System v3.0
Streamlit Dashboard — ターミナル不要・UI完結版

すべての操作（デモ実行・スケジューラー起動停止・銘柄スキャン・設定変更）を
このダッシュボードから行えます。
"""

import streamlit as st
import sqlite3
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from datetime import datetime, timedelta
import os
import json
import re
import time
import subprocess
import threading
from pathlib import Path

# python-dotenv は requirements.txt に含まれている前提
try:
    from dotenv import dotenv_values, set_key
    HAS_DOTENV = True
except ImportError:
    HAS_DOTENV = False

# PostgreSQL (Neon) サポート
try:
    import psycopg2
    import psycopg2.extras
    HAS_PSYCOPG2 = True
except ImportError:
    HAS_PSYCOPG2 = False

# DATABASE_URL が設定されていればクラウドDB（Neon）を使用
DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ─── パス設定 ──────────────────────────────────────────────────
PROJECT_DIR = Path(__file__).parent.parent.resolve()
DB_PATH     = PROJECT_DIR / "database" / "trades.db"
ENV_PATH    = PROJECT_DIR / ".env"
LOG_DIR     = PROJECT_DIR / "logs"

# Node.js の実行パスを探す
def find_node():
    for candidate in ["/usr/local/bin/node", "/opt/homebrew/bin/node", "node"]:
        try:
            r = subprocess.run([candidate, "--version"], capture_output=True, text=True, timeout=3)
            if r.returncode == 0:
                return candidate
        except Exception:
            pass
    return "node"

NODE_BIN = find_node()

# ─── ページ設定 ────────────────────────────────────────────────
st.set_page_config(
    page_title="CASATS — Auto Trading",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ─── パスワード認証 ────────────────────────────────────────────
def check_password():
    """Streamlit Secrets の PASSWORD と照合。未設定なら認証スキップ。"""
    correct = st.secrets.get("PASSWORD", "")
    if not correct:
        return True  # Secrets 未設定時はスキップ（ローカル開発用）

    if st.session_state.get("authenticated"):
        return True

    st.title("🔐 CASATS — ログイン")
    pwd = st.text_input("パスワード", type="password", placeholder="パスワードを入力...")
    if st.button("ログイン", type="primary"):
        if pwd == correct:
            st.session_state["authenticated"] = True
            st.rerun()
        else:
            st.error("パスワードが違います")
    return False

if not check_password():
    st.stop()

st.markdown("""
<style>
  .buy-badge  { color:#00cc88; font-weight:bold; font-size:1.1em; }
  .sell-badge { color:#ff4b4b; font-weight:bold; font-size:1.1em; }
  .hold-badge { color:#ffa500; font-weight:bold; font-size:1.1em; }
  .score-bar  { height:8px; border-radius:4px; background:#2a2a40; margin:4px 0; }
  .score-fill { height:8px; border-radius:4px; }
  .divider-thin { border:none; border-top:1px solid #333; margin:6px 0; }
  .log-box { font-family:monospace; font-size:0.82em; background:#111;
             color:#ddd; padding:10px; border-radius:6px; max-height:380px;
             overflow-y:auto; white-space:pre-wrap; word-break:break-all; }
</style>
""", unsafe_allow_html=True)

# ─── グローバルプロセスストア ─────────────────────────────────
# st.cache_resource = Streamlit サーバーが生きている限り保持される。
# ブラウザをリロードしてもプロセス参照・ログが消えない。
# session_state と違いバックグラウンドスレッドから安全に書き込める。

@st.cache_resource
def _global():
    return {
        "scheduler": {"proc": None, "log": [], "start_time": None},
        "scan":      {"proc": None, "log": [], "start_time": None},
        "demo":      {"proc": None, "log": [], "start_time": None},
    }

def _store(key: str) -> dict:
    return _global()[key]

# ─── プロセス管理ヘルパー ──────────────────────────────────────

def is_running(key: str) -> bool:
    s = _store(key)
    return s["proc"] is not None and s["proc"].poll() is None

def _load_env_to_dict() -> dict:
    env = os.environ.copy()
    if ENV_PATH.exists():
        with open(ENV_PATH) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, _, v = line.partition('=')
                    env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def start_proc(key: str, cmd_args: list) -> None:
    """Node.js プロセスを起動。ログは cache_resource に書き込む（リロード後も保持）"""
    s = _store(key)
    # 既存プロセスを停止
    if s["proc"] and s["proc"].poll() is None:
        try: s["proc"].terminate(); s["proc"].wait(timeout=3)
        except Exception: pass

    proc = subprocess.Popen(
        [NODE_BIN] + cmd_args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(PROJECT_DIR),
        env=_load_env_to_dict(),
        bufsize=1,
    )
    s["proc"]       = proc
    s["log"]        = []
    s["start_time"] = time.time()

    def _reader():
        for line in iter(proc.stdout.readline, ""):
            stripped = line.rstrip()
            if stripped:
                s["log"].append(stripped)
                if len(s["log"]) > 400:
                    s["log"] = s["log"][-400:]

    threading.Thread(target=_reader, daemon=True).start()

def stop_proc(key: str) -> None:
    s = _store(key)
    if s["proc"] and s["proc"].poll() is None:
        try:
            s["proc"].terminate()
            s["proc"].wait(timeout=5)
        except Exception:
            try: s["proc"].kill()
            except Exception: pass
    s["proc"]       = None
    s["start_time"] = None

def get_log(key: str, n: int = 200) -> str:
    lines = _store(key)["log"]
    return "\n".join(lines[-n:]) or "（ログなし）"

def elapsed_str(key: str) -> str:
    """経過時間を「X分Y秒」形式で返す"""
    t = _store(key)["start_time"]
    if t is None:
        return ""
    secs = int(time.time() - t)
    m, s = divmod(secs, 60)
    return f"{m}分{s:02d}秒"

def next_run_str() -> str:
    """次回スケジューラー実行までの残り時間（平日15:05 JST）"""
    now_utc = datetime.utcnow()
    now_jst = now_utc + timedelta(hours=9)
    target  = now_jst.replace(hour=15, minute=5, second=0, microsecond=0)
    if now_jst >= target:
        target += timedelta(days=1)
    # 土日をスキップ
    while target.weekday() >= 5:
        target += timedelta(days=1)
    diff = target - now_jst
    h, rem = divmod(int(diff.total_seconds()), 3600)
    m, s   = divmod(rem, 60)
    if h > 0:
        return f"次回実行まで約 {h}時間{m}分"
    return f"次回実行まで約 {m}分{s:02d}秒"

# ─── DB ヘルパー ───────────────────────────────────────────────

def _is_cloud_db():
    """DATABASE_URL が設定されており psycopg2 が使える場合は True"""
    return bool(DATABASE_URL) and HAS_PSYCOPG2

def query(sql, params=()):
    """SQLite または PostgreSQL（Neon）から SELECT してDataFrameを返す"""
    try:
        if _is_cloud_db():
            # PostgreSQL: ? → %s に変換（psycopg2 プレースホルダ）
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
    except Exception:
        return pd.DataFrame()

def db_exists():
    if _is_cloud_db():
        try:
            conn = psycopg2.connect(DATABASE_URL, sslmode='require')
            cur = conn.cursor()
            cur.execute("SELECT 1 FROM trades LIMIT 1")
            conn.close()
            return True
        except Exception:
            return False
    return DB_PATH.exists()

@st.cache_data(ttl=30)
def get_portfolio():
    df = query("SELECT * FROM portfolio ORDER BY date DESC LIMIT 1")
    return df.iloc[0] if not df.empty else None

@st.cache_data(ttl=30)
def get_trades(limit=100):
    return query(f"SELECT * FROM trades ORDER BY timestamp DESC LIMIT {limit}")

@st.cache_data(ttl=30)
def get_positions():
    return query("SELECT * FROM positions WHERE status IN ('open','holding') ORDER BY created_at DESC")

@st.cache_data(ttl=30)
def get_daily_summary(days=30):
    df = query(f"SELECT * FROM daily_summary ORDER BY date DESC LIMIT {days}")
    return df.sort_values('date') if not df.empty else df

@st.cache_data(ttl=60)
def get_watchlist():
    return query("SELECT * FROM watchlist WHERE is_active = 1 ORDER BY rank ASC")

@st.cache_data(ttl=60)
def get_watchlist_history():
    return query("""
        SELECT DISTINCT selection_date, next_update_date, overall_market_view,
               COUNT(*) as stock_count
        FROM watchlist GROUP BY selection_date
        ORDER BY selection_date DESC LIMIT 6
    """)

# ─── .env ヘルパー ─────────────────────────────────────────────

def load_env():
    if not ENV_PATH.exists():
        return {}
    if HAS_DOTENV:
        return dotenv_values(str(ENV_PATH))
    result = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                result[k.strip()] = v.strip().strip('"').strip("'")
    return result

def save_env(updates: dict):
    """更新された値を .env に書き込む"""
    if HAS_DOTENV:
        for k, v in updates.items():
            set_key(str(ENV_PATH), k, str(v))
    else:
        # dotenv がなければ手動で書き直す
        existing = load_env()
        existing.update(updates)
        with open(ENV_PATH, 'w') as f:
            for k, v in existing.items():
                f.write(f'{k}={v}\n')

# ─── ユーティリティ ────────────────────────────────────────────

def parse_reasoning(text):
    if not text: return {}
    try:
        data = json.loads(text)
        if isinstance(data, dict): return data
    except Exception: pass
    return {"raw": str(text)}

def score_color(score):
    if score >= 70: return "#00cc88"
    if score >= 50: return "#ffa500"
    return "#ff4b4b"

def badge_html(decision):
    cls = {"BUY": "buy-badge", "SELL": "sell-badge"}.get(decision, "hold-badge")
    return f'<span class="{cls}">{decision}</span>'

# ─── サイドバー ────────────────────────────────────────────────
with st.sidebar:
    st.header("📋 メニュー")
    page = st.radio("ページ:", [
        "🎮 取引操作",
        "📊 ダッシュボード",
        "🤖 AI 判断詳細",
        "📂 保有ポジション",
        "📡 銘柄管理",
        "📈 パフォーマンス",
        "⚙️ 設定",
        "📋 ログ",
    ])
    st.divider()

    # システム状態
    sch_run  = is_running("scheduler")
    scan_run = is_running("scan")
    demo_run = is_running("demo")

    st.subheader("🔌 システム状態")
    # クラウドモード表示
    if _is_cloud_db():
        st.markdown("🌐 **クラウドモード** (Neon DB)")
        st.caption("取引エンジンは GitHub Actions で自動実行されます")
    else:
        if demo_run:
            st.markdown(f"デモ実行: 🟢 **稼働中** ({elapsed_str('demo')})")
        if sch_run:
            st.markdown(f"スケジューラー: 🟢 **稼働中** ({elapsed_str('scheduler')})")
        elif not demo_run:
            st.markdown("スケジューラー: 🔴 停止中")
        if scan_run:
            st.markdown(f"スキャン: 🔍 **実行中** ({elapsed_str('scan')})")

    st.divider()

    # ウォッチリスト
    st.subheader("📡 監視銘柄")
    wl_side = get_watchlist()
    if not wl_side.empty:
        st.caption(f"次回更新: {wl_side.iloc[0].get('next_update_date','—')}")
        for _, row in wl_side.iterrows():
            sig  = row.get('signal', 'HOLD')
            icon = "🟢" if sig=="BUY" else "🔴" if sig=="SELL" else "🟡"
            name = row.get('name') or ''
            # 長い銘柄名は省略
            short_name = name[:8] + '…' if len(name) > 8 else name
            label = f"{row['symbol']} {short_name}".strip()
            st.write(f"{icon} **{label}** `{row.get('technical_score',0)}pt`")
    else:
        ev = load_env()
        for s in ev.get('WATCHED_STOCKS','7203,6758,9984').split(','):
            st.write(f"⬜ **{s.strip()}**")

    st.divider()
    portfolio_side = get_portfolio()
    if portfolio_side is not None:
        st.write(f"**総資産:** ¥{portfolio_side['current_capital']:,.0f}")
    trades_side = get_trades(1)
    if not trades_side.empty:
        st.write(f"**最終実行:** {str(trades_side.iloc[0]['timestamp'])[:16]}")

    st.divider()
    st.caption("⏱ 自動更新間隔（手動更新ボタンも下にあります）")
    refresh_options = {
        "停止": 0,
        "1分":  60,
        "3分":  180,
        "5分":  300,
        "10分": 600,
        "30分": 1800,
    }
    refresh_label = st.selectbox(
        "自動更新間隔:",
        options=list(refresh_options.keys()),
        index=3,  # デフォルト = 5分
        label_visibility="collapsed",
    )
    refresh_interval = refresh_options[refresh_label]
    if refresh_interval == 0:
        st.caption("🔒 自動更新は停止中。下の「🔄 今すぐ更新」で手動更新できます")

# ═══════════════════════════════════════════════════════════════
# PAGE: 🎮 取引操作
# ═══════════════════════════════════════════════════════════════
if page == "🎮 取引操作":
    st.title("🎮 取引操作コントロールパネル")

    # ── クラウドモード（DATABASE_URL あり）は別 UI を表示 ──────
    if _is_cloud_db():
        st.info(
            "🌐 **クラウドモード**で動作中です。\n\n"
            "取引エンジンは **GitHub Actions** が毎朝 8:00 JST に自動実行します。  \n"
            "手動でトリガーしたい場合は GitHub の **Actions** タブ → 「自動株式売買ボット」→「Run workflow」を押してください。"
        )
        st.caption("📊 データは Neon PostgreSQL から読み込んでいます。各ページで最新の実績を確認できます。")
        st.divider()

        # 手動発注レポートファイルのダウンロード（logsディレクトリが存在する場合）
        today_str = datetime.now().strftime("%Y-%m-%d")
        report_path = LOG_DIR / f"trade-report-{today_str}.txt"
        if report_path.exists():
            with open(report_path) as f:
                report_content = f.read()
            st.subheader("📋 本日の手動発注レポート")
            st.code(report_content, language=None)
            st.download_button(
                "⬇️ レポートをダウンロード",
                data=report_content,
                file_name=f"trade-report-{today_str}.txt",
                mime="text/plain"
            )
        else:
            st.info(f"本日 ({today_str}) の発注レポートはまだありません。")
        st.stop()

    st.caption("ターミナル不要 — すべての操作をここから行えます")

    # DB 未初期化チェック
    if not db_exists():
        st.warning("⚠️ データベースが未作成です。まず初期化してください。")
        if st.button("🗄️ データベースを初期化", key="btn_db_init", type="primary"):
            with st.spinner("初期化中..."):
                r = subprocess.run(
                    [NODE_BIN, "-e",
                     "import('./src/database/db-init.js').then(m=>m.default.initialize())"
                     ".then(()=>{console.log('DB initialized');process.exit(0)})"
                     ".catch(e=>{console.error(e.message);process.exit(1)})"],
                    capture_output=True, text=True, cwd=str(PROJECT_DIR), timeout=30
                )
            if r.returncode == 0:
                st.success("✅ 初期化完了")
                st.rerun()
            else:
                st.error(f"❌ エラー: {r.stdout}\n{r.stderr}")
        st.stop()

    # ─── ⓪ デモ自動実行（停止するまで連続実行） ───────────────
    with st.container(border=True):
        st.subheader("🤖 デモ自動実行 — 停止ボタンで止まるまでずっと動きます")
        st.caption(
            "起動すると 数秒ごとに 売買サイクル（ホールド判定 → SL/TP判定 → Claude判断 → 新規BUY）"
            "を **停止するまで自動で繰り返します**。シミュレーション（仮想口座）なので実資金は動きません。"
        )

        demo_run = is_running("demo")
        col_d1, col_d2, col_d3 = st.columns([3, 1, 1])
        with col_d1:
            if demo_run:
                st.markdown(f"🟢 **稼働中** — 経過: {elapsed_str('demo')}")
            else:
                st.markdown("⚪ **停止中** — 「▶ デモ開始」で連続サイクル実行")
        with col_d2:
            if st.button("▶ デモ開始", key="btn_demo_start", disabled=demo_run, type="primary", use_container_width=True):
                start_proc("demo", ["demo-cycle.js"])
                st.toast("デモを開始しました", icon="▶")
                st.rerun()
        with col_d3:
            if st.button("⏹ 停止", key="btn_demo_stop", disabled=not demo_run, use_container_width=True):
                stop_proc("demo")
                st.toast("デモを停止しました")
                st.rerun()

        # ログエリア — 稼働中はリアルタイムで流れる
        demo_log_lines = _store("demo")["log"]
        if demo_log_lines or demo_run:
            if demo_run:
                st.info(f"⏳ デモ稼働中 — {elapsed_str('demo')} 経過 (サイクル間隔: 約3秒)")
            st.markdown(f'<div class="log-box">{get_log("demo", 120)}</div>', unsafe_allow_html=True)

        if demo_log_lines and not demo_run:
            exit_code = _store("demo")["proc"].returncode if _store("demo")["proc"] else None
            if exit_code in (0, None):
                st.success("✅ デモを停止しました。「ダッシュボード」で結果を確認できます。")
            else:
                st.error(f"❌ デモが異常終了しました（code={exit_code}）。ログを確認してください。")

    st.divider()

    # ─── ① 自動スケジューラー ──────────────────────────────────
    with st.container(border=True):
        st.subheader("① 自動スケジューラー")
        st.caption("起動しておくと毎営業日 15:05 に自動で取引分析・発注を実行します")

        sch_run = is_running("scheduler")
        col_s1, col_s2, col_s3, col_s4 = st.columns([3, 1, 1, 1])
        with col_s1:
            if sch_run:
                st.markdown(f"🟢 **稼働中** — 経過: {elapsed_str('scheduler')}　|　{next_run_str()}")
            else:
                st.markdown("🔴 **停止中**")
        with col_s2:
            if st.button("▶ 起動", key="btn_sch_start", disabled=sch_run, type="primary", use_container_width=True):
                start_proc("scheduler", ["src/index.js"])
                st.toast("スケジューラーを起動しました", icon="▶")
                st.rerun()
        with col_s3:
            if st.button("⏹ 停止", key="btn_sch_stop", disabled=not sch_run, use_container_width=True):
                stop_proc("scheduler")
                st.toast("停止しました")
                st.rerun()
        with col_s4:
            if st.button("⚡ 今すぐ1回", key="btn_sch_now", use_container_width=True, help="スケジュールを待たず即実行（テスト用）"):
                start_proc("scheduler", ["src/index.js", "--test"])
                st.toast("テスト実行を開始しました", icon="⚡")
                st.rerun()

        # ログエリア — プロセスが存在する（または過去に実行した）場合は常に表示
        sch_log = get_log("scheduler", 100)
        if _store("scheduler")["log"] or sch_run:
            if sch_run:
                st.info(f"⏳ 稼働中 — {elapsed_str('scheduler')} 経過　次回: 平日 15:05 JST")
            st.markdown(f'<div class="log-box">{sch_log}</div>', unsafe_allow_html=True)

    st.divider()

    # ─── ② ウォッチリストスキャン ──────────────────────────────
    with st.container(border=True):
        st.subheader("② 銘柄スキャン（推奨: 月2回）")
        st.caption(
            "200銘柄をランダムサンプリングし、軍資金比率フィルタ + テクニカルスコアで上位8銘柄を選定。  \n"
            "完了まで **2〜5分** かかります。実行中はログが流れます。"
        )

        scan_run = is_running("scan")
        wl_check = get_watchlist()

        col_sc1, col_sc2 = st.columns([3, 1])
        with col_sc1:
            if scan_run:
                st.info(f"🔍 スキャン実行中... {elapsed_str('scan')} 経過（完了まで最大5分）")
            elif not wl_check.empty:
                st.write(f"前回: {wl_check.iloc[0].get('selection_date','—')} → 次回推奨: {wl_check.iloc[0].get('next_update_date','—')}")
        with col_sc2:
            if st.button("🔍 スキャン実行", key="btn_scan_ctrl", disabled=scan_run, type="primary", use_container_width=True):
                start_proc("scan", ["scan-watchlist.js"])
                st.toast("スキャンを開始しました", icon="🔍")
                st.rerun()

        # ログエリア — 実行中はリアルタイムで流れる、完了後も残る
        scan_log_lines = _store("scan")["log"]
        if scan_log_lines or scan_run:
            st.markdown(f'<div class="log-box">{get_log("scan", 80)}</div>', unsafe_allow_html=True)

        if scan_log_lines and not scan_run:
            # プロセス終了コードを確認
            exit_code = _store("scan")["proc"].returncode if _store("scan")["proc"] else None
            if exit_code == 0 or exit_code is None:
                st.success("✅ スキャン完了！「銘柄管理」ページで結果を確認してください。")
            else:
                st.error(f"❌ スキャンがエラーで終了しました（code={exit_code}）。ログを確認してください。")
            st.cache_data.clear()

# ═══════════════════════════════════════════════════════════════
# PAGE: 📊 ダッシュボード
# ═══════════════════════════════════════════════════════════════
elif page == "📊 ダッシュボード":
    st.title("📊 ダッシュボード")

    if not db_exists():
        st.info("データベース未初期化。「取引操作」ページから初期化してください。")
        st.stop()

    portfolio = get_portfolio()
    if portfolio is not None:
        initial    = portfolio.get('initial_capital', 1_000_000) or 1_000_000
        current    = portfolio.get('current_capital', initial)
        available  = portfolio.get('available_cash', current)
        total_gain = current - initial
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("💴 総資産",   f"¥{current:,.0f}",  f"{total_gain:+,.0f}円")
        c2.metric("💰 利用可能", f"¥{available:,.0f}")
        c3.metric("📈 収益率",   f"{total_gain/initial*100:+.2f}%")
        c4.metric("📦 投資中",   f"¥{current-available:,.0f}")
    else:
        st.info("「取引操作」からスケジューラーを起動するとここにデータが表示されます。")

    daily = get_daily_summary(30)
    if not daily.empty:
        st.divider()
        st.subheader("資本推移（直近30日）")
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=daily['date'], y=daily['capital_end'],
            mode='lines+markers', name='総資産',
            line=dict(color='#1f77b4', width=2), fill='tozeroy',
        ))
        fig.update_layout(xaxis_title='日付', yaxis_title='¥', height=350, margin=dict(t=10))
        st.plotly_chart(fig, use_container_width=True)

        col1, col2 = st.columns(2)
        with col1:
            fig2 = go.Figure(data=[go.Bar(
                x=daily['date'],
                y=(daily['win_rate'].fillna(0)*100).where(daily['win_rate']<=1, daily['win_rate']),
                marker_color='#2ca02c',
            )])
            fig2.update_layout(title='勝率推移 (%)', height=280, margin=dict(t=40))
            st.plotly_chart(fig2, use_container_width=True)
        with col2:
            fig3 = go.Figure()
            fig3.add_trace(go.Bar(x=daily['date'], y=daily['buy_count'].fillna(0),  name='買い', marker_color='#2ca02c'))
            fig3.add_trace(go.Bar(x=daily['date'], y=daily['sell_count'].fillna(0), name='売り', marker_color='#d62728'))
            fig3.update_layout(title='日次トレード数', barmode='group', height=280, margin=dict(t=40))
            st.plotly_chart(fig3, use_container_width=True)

# ═══════════════════════════════════════════════════════════════
# PAGE: 🤖 AI 判断詳細
# ═══════════════════════════════════════════════════════════════
elif page == "🤖 AI 判断詳細":
    st.title("🤖 AI 判断詳細")
    st.caption("各銘柄の判断理由・テクニカルスコア・SL/TP を確認できます")

    trades_df = get_trades(200)
    if trades_df.empty:
        st.info("まだ判断データがありません。「取引操作」からスケジューラーを起動してください。")
    else:
        fc1, fc2, fc3 = st.columns([2, 2, 2])
        with fc1:
            dec_filter = st.multiselect("判断", ["BUY","SELL","HOLD"], default=["BUY","SELL","HOLD"])
        with fc2:
            sym_opts = ["全銘柄"] + sorted(trades_df["symbol"].unique().tolist())
            sym_filter = st.selectbox("銘柄", sym_opts)
        with fc3:
            min_conf = st.slider("最低信頼度 (%)", 0, 100, 0)

        filtered = trades_df[trades_df["decision"].isin(dec_filter)]
        if sym_filter != "全銘柄":
            filtered = filtered[filtered["symbol"] == sym_filter]
        conf_s = filtered["confidence"].apply(lambda v: (v*100 if v is not None and v<=1 else (v or 0)))
        filtered = filtered[conf_s >= min_conf]
        st.caption(f"{len(filtered)} 件表示")

        for _, row in filtered.iterrows():
            r = parse_reasoning(row.get("reasoning",""))
            decision  = row.get("decision","HOLD")
            conf      = row.get("confidence",0.5) or 0.5
            conf_pct  = conf*100 if conf<=1 else conf
            tech_score= r.get("technicalScore") or r.get("technical_score")
            sl_data   = r.get("stopLoss") or {}
            tp_data   = r.get("takeProfit") or {}
            rr        = r.get("riskRewardRatio")
            analysis  = r.get("analysis") or {}
            rea_det   = r.get("reasoning") or {}

            with st.expander(
                f"**{str(row['timestamp'])[:16]}** | **{row['symbol']}** | {decision} | 信頼度 {conf_pct:.1f}%"
                + (f" | スコア {tech_score}/100" if tech_score else ""),
                expanded=False,
            ):
                left, right = st.columns(2)
                with left:
                    st.markdown(f"#### {badge_html(decision)}&nbsp; {conf_pct:.1f}%", unsafe_allow_html=True)
                    st.write(f"**銘柄:** {row['symbol']} **価格:** ¥{row['entry_price']:,.0f} **数量:** {int(row['quantity'])}株")
                    if tech_score is not None:
                        color = score_color(int(tech_score))
                        st.markdown(
                            f"**テクニカルスコア: {tech_score}/100**<br>"
                            f'<div class="score-bar"><div class="score-fill" style="width:{int(tech_score)}%;background:{color}"></div></div>',
                            unsafe_allow_html=True,
                        )
                    sl_p = sl_data.get("price") if isinstance(sl_data, dict) else None
                    tp_p = tp_data.get("price") if isinstance(tp_data, dict) else None
                    if sl_p or tp_p:
                        st.write(f"🔴 SL ¥{sl_p:,.0f}　🟢 TP ¥{tp_p:,.0f}" + (f"　⚖️ RR:{rr}" if rr else ""))
                with right:
                    if analysis:
                        st.markdown("**📊 指標分析**")
                        for k, label in [("trendJudgment","トレンド"),("momentumSignal","モメンタム"),
                                         ("trendStrength","ADX強度"),("cloudPosition","一目"),
                                         ("bollingerAnalysis","BB"),("convergence","一致度")]:
                            v = analysis.get(k)
                            if v: st.write(f"**{label}:** {v}")
                if rea_det and isinstance(rea_det, dict):
                    rc1, rc2 = st.columns(2)
                    if rea_det.get("whyBuy"):   rc1.info(f"🟢 {rea_det['whyBuy']}")
                    if rea_det.get("whySell"):  rc2.error(f"🔴 {rea_det['whySell']}")
                    if rea_det.get("considerations"): st.warning(rea_det['considerations'])
            st.markdown('<hr class="divider-thin">', unsafe_allow_html=True)

# ═══════════════════════════════════════════════════════════════
# PAGE: 📂 保有ポジション
# ═══════════════════════════════════════════════════════════════
elif page == "📂 保有ポジション":
    st.title("📂 保有ポジション")

    def fetch_live_prices(symbols: list) -> dict:
        """
        Node.js ヘルパースクリプト (get-prices.js) 経由で価格を取得。
        バックエンド (yahoo-finance2) と完全に同一ソース。
        Yahoo Finance v8 chart API → Stooq CSV の順でフォールバック。
        JSON parse エラー ("Expecting value: line 1 column 1") は発生しない。
        """
        import subprocess as _sp
        import json as _json

        if not symbols:
            return {}

        try:
            r = _sp.run(
                [NODE_BIN, "get-prices.js", *[str(s) for s in symbols]],
                capture_output=True,
                text=True,
                cwd=str(PROJECT_DIR),
                timeout=45,
            )
            stdout = (r.stdout or "").strip()
            if not stdout:
                st.caption(f"⚠️ 価格取得スクリプトが空応答を返しました (stderr: {r.stderr[:200] if r.stderr else 'なし'})")
                return {sym: None for sym in symbols}

            # 最後の {...} の行のみを JSON として解釈（先頭に警告が出ても安全）
            json_line = None
            for line in stdout.splitlines()[::-1]:
                ls = line.strip()
                if ls.startswith("{") and ls.endswith("}"):
                    json_line = ls
                    break
            if not json_line:
                json_line = stdout

            try:
                data = _json.loads(json_line)
            except Exception as je:
                st.caption(f"⚠️ JSON解析失敗: {je} / 出力: {stdout[:150]}")
                return {sym: None for sym in symbols}

            # 正規化
            result = {}
            for sym in symbols:
                v = data.get(str(sym))
                if v and v.get("price"):
                    result[sym] = {
                        "price":        float(v["price"]),
                        "real":         True,
                        "name":         v.get("name", str(sym)),
                        "source":       v.get("source", "node"),
                        "marketState":  v.get("marketState"),
                        "tradingDay":   v.get("tradingDay"),
                        "previousClose": v.get("previousClose"),
                    }
                else:
                    result[sym] = None
            return result

        except _sp.TimeoutExpired:
            st.caption("⚠️ 価格取得タイムアウト (45秒)")
            return {sym: None for sym in symbols}
        except FileNotFoundError:
            st.caption(f"⚠️ Node.js が見つかりません: {NODE_BIN}")
            return {sym: None for sym in symbols}
        except Exception as e:
            st.caption(f"⚠️ 価格取得エラー: {type(e).__name__}: {e}")
            return {sym: None for sym in symbols}

    pos_df = get_positions()
    if pos_df.empty:
        st.info("現在、保有ポジションはありません。")
    else:
        col_ph1, col_ph2 = st.columns([3, 1])
        with col_ph1:
            st.caption("「現在価格を更新」で Yahoo Finance からリアルタイム取得します")
        with col_ph2:
            update_prices = st.button("🔄 現在価格を更新", key="btn_update_prices", type="primary", use_container_width=True)

        # session_stateに保存して rerun 後も保持
        if "live_prices" not in st.session_state:
            st.session_state["live_prices"] = {}

        if update_prices:
            with st.spinner("Yahoo Finance から価格を取得中..."):
                syms = pos_df["symbol"].tolist()
                fetched = fetch_live_prices(syms)
            st.session_state["live_prices"] = fetched
            # 取得結果を表示
            ok  = [s for s, v in fetched.items() if v and v.get("price")]
            ng  = [s for s, v in fetched.items() if not v or not v.get("price")]
            if ok:
                st.success(f"✅ 取得成功: {', '.join(ok)}")
            if ng:
                st.warning(f"⚠️ 取得失敗（Entry価格を表示）: {', '.join(ng)}")

        live_prices = st.session_state.get("live_prices", {})

        for _, row in pos_df.iterrows():
            sym      = row["symbol"]
            entry    = float(row.get("entry_price") or 0)
            qty      = int(row.get("quantity") or 0)

            # 約定直後判定（同日エントリー）
            entry_date_str = str(row.get("entry_date", ""))[:10]
            today_str      = datetime.now().strftime("%Y-%m-%d")
            just_entered   = (entry_date_str == today_str)

            # ライブ価格 > DB保存価格 > エントリー価格 の順で優先
            live_info = live_prices.get(sym)
            source_note = ""
            if live_info and live_info.get("price"):
                curr_p    = float(live_info["price"])
                src       = (live_info.get("source") or "").lower()
                mstate    = (live_info.get("marketState") or "").upper()
                if src == "yahoo-live" or mstate == "REGULAR":
                    price_src   = "🟢 Live"
                    source_note = "Yahoo Finance（リアルタイム）"
                elif src.startswith("yahoo"):
                    price_src   = "🟡 Yahoo"
                    state_jp = {"PRE":"プリマーケット","POST":"アフターマーケット",
                                "POSTPOST":"市場閉鎖","CLOSED":"市場閉鎖"}.get(mstate, "")
                    source_note = f"Yahoo Finance（{state_jp or '直近値'}）"
                elif src == "stooq":
                    price_src   = "📅 前日終値"
                    td          = live_info.get("tradingDay") or "—"
                    source_note = f"Stooq（{td} の終値 — Yahooがレート制限のため）"
                else:
                    price_src   = "🟢 Live"
                    source_note = src or "Node"
            elif row.get("current_price"):
                curr_p    = float(row["current_price"])
                price_src = "🔵 DB"
                source_note = "前回サイクル時の価格"
            else:
                curr_p    = entry
                price_src = "⬜ Entry"
                source_note = "取得不可 — エントリー価格を表示"

            upnl     = (curr_p - entry) * qty
            upnl_pct = ((curr_p - entry) / entry * 100) if entry else 0

            with st.expander(
                f"**{sym}** — {qty}株 @ エントリー¥{entry:,.0f} | 含み損益 {upnl:+,.0f}円",
                expanded=True
            ):
                c1, c2, c3, c4 = st.columns(4)
                c1.metric("エントリー", f"¥{entry:,.0f}")
                c2.metric(f"現在価格 {price_src}", f"¥{curr_p:,.0f}",
                          delta=f"{curr_p - entry:+,.0f}円")
                c3.metric("含み損益", f"{upnl:+,.0f}円", f"{upnl_pct:+.2f}%")
                c4.metric("開始日", entry_date_str if entry_date_str else "—")

                if just_entered:
                    st.info(
                        "🆕 **本日約定** — 15:05 取得時の Yahoo 終値と、後から反映される"
                        "東証大引けオークション値には数分のラグがあるため、エントリー直後でも"
                        "数百円〜数千円の含み損益が出る場合があります。"
                        "翌営業日以降に値動きが反映されると正しく増減します。"
                    )
                if source_note:
                    st.caption(f"💡 価格ソース: {source_note}")

                sl = row.get("stop_loss_price")
                tp = row.get("take_profit_price")
                if sl and tp and float(tp) > float(sl):
                    sl, tp = float(sl), float(tp)
                    ratio = min(1.0, max(0.0, (curr_p - sl) / (tp - sl)))
                    st.write(f"🔴 SL ¥{sl:,.0f}  ──────  🟢 TP ¥{tp:,.0f}")
                    st.progress(ratio, text=f"SL〜TP 内の現在位置 {ratio*100:.0f}%")

        if len(pos_df) > 1:
            fig = px.pie(pos_df, values="quantity", names="symbol", title="銘柄別ポジション比率")
            st.plotly_chart(fig, use_container_width=True)

# ═══════════════════════════════════════════════════════════════
# PAGE: 📡 銘柄管理
# ═══════════════════════════════════════════════════════════════
elif page == "📡 銘柄管理":
    st.title("📡 ウォッチリスト銘柄管理")
    st.caption("軍資金比率フィルタ + テクニカルスコアで自動選定")

    wl      = get_watchlist()
    history = get_watchlist_history()
    scan_run = is_running("scan")

    col_btn1, col_btn2 = st.columns([3, 1])
    with col_btn2:
        if st.button("🔍 今すぐスキャン", key="btn_scan_watchlist", disabled=scan_run, type="primary", use_container_width=True):
            start_proc("scan", ["scan-watchlist.js"])
            st.toast("スキャン開始", icon="🔍")
            st.rerun()
    with col_btn1:
        if scan_run:
            st.info(f"🔍 スキャン実行中... {elapsed_str('scan')} 経過")
        elif not wl.empty:
            st.write(f"前回: {wl.iloc[0].get('selection_date','—')} → 次回: {wl.iloc[0].get('next_update_date','—')}")

    if _store("scan")["log"] and not scan_run:
        st.success("✅ スキャン完了")
        st.cache_data.clear()

    st.divider()

    if wl.empty:
        st.info("まだスキャン結果がありません。「今すぐスキャン」ボタンで実行してください。")
    else:
        mv = wl.iloc[0].get('overall_market_view','')
        if mv: st.info(f"📌 **Claude の相場観:** {mv}")

        col_b1,col_b2,col_b3 = st.columns(3)
        col_b1.metric("選定日",   wl.iloc[0].get('selection_date','—'))
        col_b2.metric("次回更新", wl.iloc[0].get('next_update_date','—'))
        col_b3.metric("銘柄数",   len(wl))

        st.subheader("🎯 現在の監視銘柄")
        for _, row in wl.iterrows():
            sym    = row.get('symbol','?')
            name   = row.get('name', sym)
            sector = row.get('sector','—')
            score  = row.get('technical_score',0)
            comp   = row.get('composite_score',0)
            sig    = row.get('signal','HOLD')
            conf   = row.get('confidence',0.5) or 0.5
            adx    = row.get('adx',0) or 0
            trend  = row.get('trend','—')
            conv   = row.get('convergence_rate',0) or 0
            reason = row.get('selection_reason','')
            exp    = row.get('expected_behavior','')
            risk   = row.get('risk_note','')
            rank   = row.get('rank','—')
            lot_r  = row.get('lot_ratio', None)
            icon   = "🟢" if sig=="BUY" else "🔴" if sig=="SELL" else "🟡"
            conf_p = conf*100 if conf<=1 else conf

            with st.expander(
                f"#{rank} {icon} **{sym}** {name}  [{sector}]  {score}/100"
                + (f"  1単元={lot_r*100:.0f}%" if lot_r else ""),
                expanded=(rank==1),
            ):
                mc1,mc2,mc3,mc4,mc5 = st.columns(5)
                mc1.metric("テクニカル",  f"{score}/100")
                mc2.metric("複合スコア",  f"{comp}/100")
                mc3.metric("シグナル",    sig)
                mc4.metric("信頼度",      f"{conf_p:.1f}%")
                mc5.metric("ADX",         f"{adx:.1f}")
                bar_c = score_color(score)
                st.markdown(
                    f'<div style="background:#2a2a40;border-radius:4px;height:8px;">'
                    f'<div style="width:{score}%;background:{bar_c};height:8px;border-radius:4px;"></div></div>',
                    unsafe_allow_html=True,
                )
                st.write(f"**トレンド:** {trend} | **一致率:** {conv*100:.0f}%")
                if reason: st.success(f"✅ {reason}")
                if exp:    st.info(f"📈 {exp}")
                if risk:   st.warning(f"⚠️ {risk}")

        col_c1, col_c2 = st.columns(2)
        with col_c1:
            if 'sector' in wl.columns:
                sec = wl['sector'].value_counts()
                fig_sec = px.pie(values=sec.values, names=sec.index, title="セクター分布")
                fig_sec.update_layout(height=280)
                st.plotly_chart(fig_sec, use_container_width=True)
        with col_c2:
            sdf = wl[['symbol','technical_score','composite_score']].copy()
            fig_sc = go.Figure()
            fig_sc.add_trace(go.Bar(x=sdf['symbol'], y=sdf['technical_score'], name='テクニカル', marker_color='#1f77b4'))
            fig_sc.add_trace(go.Bar(x=sdf['symbol'], y=sdf['composite_score'], name='複合',       marker_color='#ff7f0e'))
            fig_sc.update_layout(barmode='group', height=280, margin=dict(t=10))
            st.plotly_chart(fig_sc, use_container_width=True)

    if not history.empty:
        st.divider()
        st.subheader("📜 スキャン履歴")
        history.columns = ['選定日','次回更新','相場観','銘柄数']
        history['相場観'] = history['相場観'].apply(lambda v: (str(v or '')[:60]+'…') if len(str(v or ''))>60 else str(v or ''))
        st.dataframe(history, use_container_width=True, hide_index=True)

# ═══════════════════════════════════════════════════════════════
# PAGE: 📈 パフォーマンス
# ═══════════════════════════════════════════════════════════════
elif page == "📈 パフォーマンス":
    st.title("📈 パフォーマンス分析")
    all_trades = get_trades(500)
    if all_trades.empty:
        st.info("取引データがありません。「取引操作」からスケジューラーを起動してください。")
    else:
        c1,c2,c3,c4 = st.columns(4)
        c1.metric("総判断回数",    len(all_trades))
        c2.metric("BUY シグナル",  int((all_trades["decision"]=="BUY").sum()))
        c3.metric("SELL シグナル", int((all_trades["decision"]=="SELL").sum()))
        c4.metric("HOLD シグナル", int((all_trades["decision"]=="HOLD").sum()))

        col_p1, col_p2 = st.columns(2)
        with col_p1:
            sig_counts = all_trades["decision"].value_counts()
            fig_pie = px.pie(
                values=sig_counts.values, names=sig_counts.index,
                color=sig_counts.index,
                color_discrete_map={"BUY":"#00cc88","SELL":"#ff4b4b","HOLD":"#ffa500"},
                title="判断分布",
            )
            fig_pie.update_layout(height=280)
            st.plotly_chart(fig_pie, use_container_width=True)
        with col_p2:
            conf_vals = all_trades["confidence"].dropna()
            conf_pct  = conf_vals.apply(lambda v: v*100 if v<=1 else v)
            fig_hist  = px.histogram(conf_pct, nbins=20, labels={"value":"信頼度 (%)"}, title="信頼度分布", color_discrete_sequence=["#1f77b4"])
            fig_hist.update_layout(height=280, margin=dict(t=40))
            st.plotly_chart(fig_hist, use_container_width=True)

        closed = pd.DataFrame()
        if "status" in all_trades.columns:
            closed = all_trades[all_trades["status"]=="closed"].copy()
        if not closed.empty and "pnl" in closed.columns:
            st.divider()
            wins  = closed[closed["pnl"]>0]
            losses = closed[closed["pnl"]<=0]
            win_rate  = len(wins)/len(closed)*100
            total_pnl = closed["pnl"].sum()
            cc1,cc2,cc3 = st.columns(3)
            cc1.metric("勝率",   f"{win_rate:.1f}%")
            cc2.metric("総損益", f"¥{total_pnl:+,.0f}")
            cc3.metric("勝/負",  f"{len(wins)}/{len(losses)}")
            sym_pnl = closed.groupby("symbol")["pnl"].sum().sort_values()
            colors = ["#ff4b4b" if v<0 else "#00cc88" for v in sym_pnl.values]
            fig_bar = go.Figure(go.Bar(x=sym_pnl.index, y=sym_pnl.values, marker_color=colors))
            fig_bar.update_layout(title="銘柄別損益", height=260)
            st.plotly_chart(fig_bar, use_container_width=True)

# ═══════════════════════════════════════════════════════════════
# PAGE: ⚙️ 設定
# ═══════════════════════════════════════════════════════════════
elif page == "⚙️ 設定":
    st.title("⚙️ システム設定")
    st.caption("変更後は「保存」を押してください。ターミナルで .env を編集する必要はありません。")

    env_vals = load_env()

    with st.form("settings_form"):
        st.subheader("🔑 API キー")
        api_key = st.text_input(
            "Anthropic API Key（必須）",
            value=env_vals.get("ANTHROPIC_API_KEY",""),
            type="password",
            help="Anthropic のダッシュボードから取得（sk-ant-...）",
        )

        st.divider()
        st.subheader("📊 取引設定")
        col1, col2 = st.columns(2)
        with col1:
            mode = st.selectbox(
                "取引モード",
                ["demo","live_mini","live"],
                index=["demo","live_mini","live"].index(env_vals.get("TRADING_MODE","demo")),
                help="demo=擬似 / live_mini=少額実取引 / live=本番",
            )
            portfolio_value = st.number_input(
                "初期資金（円）",
                min_value=100_000, max_value=100_000_000,
                value=int(env_vals.get("PORTFOLIO_VALUE",1_000_000)),
                step=100_000,
            )
            max_positions = st.number_input(
                "最大同時ポジション数",
                min_value=1, max_value=20,
                value=int(env_vals.get("MAX_POSITIONS",5)),
            )
        with col2:
            conf_threshold = st.slider(
                "最低信頼度（%）",
                min_value=50, max_value=95,
                value=int(float(env_vals.get("CONFIDENCE_THRESHOLD",0.65))*100),
            )
            stop_loss_pct = st.slider(
                "デフォルト SL（%）",
                min_value=1, max_value=20,
                value=int(float(env_vals.get("STOP_LOSS_PERCENT",0.05))*100),
            )
            take_profit_pct = st.slider(
                "デフォルト TP（%）",
                min_value=2, max_value=50,
                value=int(float(env_vals.get("TAKE_PROFIT_PERCENT",0.10))*100),
            )

        watched = st.text_input(
            "フォールバック監視銘柄（スキャン未実行時のみ使用）",
            value=env_vals.get("WATCHED_STOCKS","7203,6758,9984,8306,2802"),
            help="銘柄スキャンを実行すると自動的にここが上書きされます。DB削除後もスキャン済み銘柄が使われます。",
        )
        st.caption("⚠️ 通常はスキャンで自動更新されます。手動変更は初回起動時やDB未作成時のみ有効です。")

        st.divider()
        st.subheader("🏦 楽天/kabu.com 証券 API（実取引時に設定）")
        col3, col4 = st.columns(2)
        with col3:
            rakuten_url = st.text_input(
                "kabu Station® API URL",
                value=env_vals.get("RAKUTEN_API_BASE_URL","http://localhost:18080"),
                help="kabu Station® を起動すると localhost:18080 で待受",
            )
        with col4:
            rakuten_pw = st.text_input(
                "API パスワード",
                value=env_vals.get("RAKUTEN_API_PASSWORD",""),
                type="password",
            )

        submitted = st.form_submit_button("💾 設定を保存", type="primary", use_container_width=True)

    if submitted:
        if not ENV_PATH.exists():
            ENV_PATH.touch()
        save_env({
            "ANTHROPIC_API_KEY":       api_key,
            "TRADING_MODE":            mode,
            "PORTFOLIO_VALUE":         str(portfolio_value),
            "MAX_POSITIONS":           str(max_positions),
            "CONFIDENCE_THRESHOLD":    str(conf_threshold / 100),
            "STOP_LOSS_PERCENT":       str(stop_loss_pct / 100),
            "TAKE_PROFIT_PERCENT":     str(take_profit_pct / 100),
            "WATCHED_STOCKS":          watched,
            "RAKUTEN_API_BASE_URL":    rakuten_url,
            "RAKUTEN_API_PASSWORD":    rakuten_pw,
        })
        st.success("✅ 設定を保存しました。")

    with st.expander("現在の設定値を確認（読み取り専用）"):
        display = {k: ("***" if any(w in k for w in ["KEY","PASSWORD","SECRET"]) else v)
                   for k, v in env_vals.items()}
        st.json(display)

# ═══════════════════════════════════════════════════════════════
# PAGE: 📋 ログ
# ═══════════════════════════════════════════════════════════════
elif page == "📋 ログ":
    st.title("📋 システムログ")

    if LOG_DIR.exists():
        log_files = sorted([f for f in os.listdir(LOG_DIR) if f.endswith('.log')], reverse=True)
        if log_files:
            selected = st.selectbox("ログファイル:", log_files)
            log_path = LOG_DIR / selected
            with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            lines       = content.split('\n')
            error_count = sum(1 for l in lines if 'error' in l.lower())
            warn_count  = sum(1 for l in lines if 'warn' in l.lower())
            mc1,mc2,mc3 = st.columns(3)
            mc1.metric("総行数",    len(lines))
            mc2.metric("⚠️ WARN",  warn_count)
            mc3.metric("❌ ERROR", error_count)
            tail = "\n".join(lines[-500:])
            st.text_area("ログ（末尾500行）", value=tail, height=500, disabled=True)
            st.download_button("⬇ ダウンロード", data=content, file_name=selected, mime="text/plain")
        else:
            st.info("ログファイルがありません。デモ実行後に作成されます。")
    else:
        st.info("ログディレクトリが見つかりません。デモを実行すると自動作成されます。")

# ─── フッター & 自動更新 ───────────────────────────────────────
st.divider()
col_f1, col_f2 = st.columns([3, 1])
col_f1.caption(
    f"**Claude AI Stock Auto Trading System v3.0** — UI-Complete Edition  \n"
    f"自動更新: {refresh_label}"
)
if col_f2.button("🔄 今すぐ更新", key="btn_refresh_footer", use_container_width=True):
    st.cache_data.clear()
    st.rerun()

# ログをリアルタイムで流すため、ジョブ実行中は短サイクルで更新
has_active = is_running("scheduler") or is_running("scan") or is_running("demo")

if has_active:
    # 実行中はログ追従のため 8 秒固定
    time.sleep(8)
    st.cache_data.clear()
    st.rerun()
elif refresh_interval > 0:
    # アイドル中はユーザー設定の間隔（デフォルト5分）
    time.sleep(refresh_interval)
    st.cache_data.clear()
    st.rerun()
# refresh_interval == 0 → 自動更新なし。手動ボタンのみで更新
