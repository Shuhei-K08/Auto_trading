/**
 * Emailer Utility
 * Gmail SMTP でメール通知を送信する
 *
 * 必要な環境変数（GitHub Secrets に登録）:
 *   EMAIL_FROM     : 送信元 Gmail アドレス（例: yourname@gmail.com）
 *   EMAIL_PASSWORD : Gmail アプリパスワード（16文字）
 *   EMAIL_TO       : 送信先アドレス（例: yourname@gmail.com）
 */

import nodemailer from 'nodemailer';
import logger from './logger.js';

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
}

/**
 * メール送信
 * @param {string} subject 件名
 * @param {string} html    HTML本文
 */
async function sendEmail(subject, html) {
  const from = process.env.EMAIL_FROM;
  const to   = process.env.EMAIL_TO;

  if (!from || !to || !process.env.EMAIL_PASSWORD) {
    logger.warn('[Emailer] EMAIL_FROM / EMAIL_PASSWORD / EMAIL_TO が未設定のためスキップ');
    return;
  }

  try {
    const transporter = createTransport();
    await transporter.sendMail({ from, to, subject, html });
    logger.info(`[Emailer] メール送信完了 → ${to} : ${subject}`);
  } catch (e) {
    logger.error(`[Emailer] 送信失敗: ${e.message}`);
  }
}

/**
 * 日次レポートメール
 * @param {Array}  recommendations  [{symbol, decision, price, quantity, reasoning}]
 * @param {object} portfolio        {currentCapital, availableCash, investedStocks}
 * @param {Array}  openPositions    保有中ポジション一覧
 */
async function sendDailyReport(recommendations, portfolio, openPositions = []) {
  const today = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const buyList  = recommendations.filter(r => r.decision === 'BUY');
  const sellList = recommendations.filter(r => r.decision === 'SELL');

  const recRows = (list, color) => list.length === 0
    ? `<tr><td colspan="4" style="color:#888;padding:8px">なし</td></tr>`
    : list.map(r => `
        <tr>
          <td style="padding:6px 10px;font-weight:bold">${r.symbol}</td>
          <td style="padding:6px 10px;color:${color};font-weight:bold">${r.decision}</td>
          <td style="padding:6px 10px">¥${Math.round(r.price ?? 0).toLocaleString('ja-JP')}</td>
          <td style="padding:6px 10px;font-size:0.85em;color:#555">${(r.reasoning ?? '').slice(0, 60)}</td>
        </tr>`).join('');

  const holdRows = openPositions.length === 0
    ? `<tr><td colspan="5" style="color:#888;padding:8px">保有ポジションなし</td></tr>`
    : openPositions.map(p => {
        const pnl     = p.unrealized_pnl ?? 0;
        const pnlPct  = p.unrealized_pnl_percent ?? 0;
        const pnlColor = pnl >= 0 ? '#00aa55' : '#cc3333';
        return `
          <tr>
            <td style="padding:6px 10px;font-weight:bold">${p.symbol}</td>
            <td style="padding:6px 10px">${p.quantity}株</td>
            <td style="padding:6px 10px">¥${Math.round(p.entry_price).toLocaleString('ja-JP')}</td>
            <td style="padding:6px 10px">¥${Math.round(p.current_price ?? p.entry_price).toLocaleString('ja-JP')}</td>
            <td style="padding:6px 10px;color:${pnlColor};font-weight:bold">
              ${pnl >= 0 ? '+' : ''}¥${Math.round(pnl).toLocaleString('ja-JP')}
              (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%)
            </td>
          </tr>`;
      }).join('');

  const cap = portfolio?.currentCapital ?? 0;
  const cash = portfolio?.availableCash ?? 0;
  const invested = portfolio?.investedStocks ?? 0;

  const html = `
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><style>
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #222; margin: 0; padding: 0; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 24px; }
  h2 { color: #1a1a2e; border-left: 4px solid #4f8ef7; padding-left: 12px; }
  h3 { color: #333; margin-top: 28px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #f0f4ff; padding: 8px 10px; text-align: left; font-size: 0.85em; color: #555; }
  tr:nth-child(even) { background: #fafafa; }
  .summary { display: flex; gap: 16px; margin: 16px 0; }
  .card { flex: 1; background: #f5f8ff; border-radius: 8px; padding: 12px 16px; }
  .card .label { font-size: 0.78em; color: #888; }
  .card .value { font-size: 1.3em; font-weight: bold; color: #1a1a2e; }
  .footer { margin-top: 32px; font-size: 0.78em; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
</style></head>
<body>
<div class="wrap">
  <h2>📈 CASATS 日次レポート</h2>
  <p style="color:#666">${today}</p>

  <div class="summary">
    <div class="card">
      <div class="label">総資産</div>
      <div class="value">¥${Math.round(cap).toLocaleString('ja-JP')}</div>
    </div>
    <div class="card">
      <div class="label">余力（現金）</div>
      <div class="value">¥${Math.round(cash).toLocaleString('ja-JP')}</div>
    </div>
    <div class="card">
      <div class="label">株式評価額</div>
      <div class="value">¥${Math.round(invested).toLocaleString('ja-JP')}</div>
    </div>
  </div>

  <h3>🟢 本日の買い推奨</h3>
  <table>
    <thead><tr><th>銘柄</th><th>判断</th><th>現在値</th><th>理由</th></tr></thead>
    <tbody>${recRows(buyList, '#00aa55')}</tbody>
  </table>

  <h3>🔴 本日の売り推奨</h3>
  <table>
    <thead><tr><th>銘柄</th><th>判断</th><th>現在値</th><th>理由</th></tr></thead>
    <tbody>${recRows(sellList, '#cc3333')}</tbody>
  </table>

  <h3>📂 保有ポジション</h3>
  <table>
    <thead><tr><th>銘柄</th><th>株数</th><th>取得値</th><th>現在値</th><th>含み損益</th></tr></thead>
    <tbody>${holdRows}</tbody>
  </table>

  <div class="footer">
    このメールは CASATS（Claude AI 自動株式売買システム）が自動送信しました。<br>
    ※ 本システムの情報は投資助言ではありません。売買判断はご自身でお願いします。
  </div>
</div>
</body>
</html>`;

  const buyCount  = buyList.length;
  const sellCount = sellList.length;
  const subject   = `📈 CASATS ${today} — 買い${buyCount}件・売り${sellCount}件`;

  await sendEmail(subject, html);
}

export { sendEmail, sendDailyReport };
export default sendDailyReport;
