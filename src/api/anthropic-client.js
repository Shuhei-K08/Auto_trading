/**
 * Anthropic Client Module
 * Claude API を使用した売買判定
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { formatStockDataForClaude, parseClaudeResponse } from '../utils/formatter.js';
import { APIError } from '../utils/errors.js';
import config from '../config.js';

class AnthropicClient {
  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
  }

  /**
   * 株価データを分析して売買判定を実施
   */
  async analyzeStock(symbol, stockData, indicators) {
    try {
      logger.debug(`Analyzing ${symbol} with Claude...`);

      // フォーマット変換
      const formattedData = formatStockDataForClaude(symbol, stockData, indicators);

      // プロンプト作成
      const prompt = this.createPrompt(symbol, formattedData);

      // Claude API 呼び出し
      const message = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // レスポンスをパース
      const responseText = message.content[0].text;
      logger.debug(`Claude response: ${responseText}`);

      const analysis = parseClaudeResponse(responseText);

      // 結果を返す
      return {
        decision: analysis.decision || 'HOLD',
        confidence: Math.min(Math.max(analysis.confidence || 0, 0), 1),
        reasoning: analysis.reasoning || responseText,
      };
    } catch (error) {
      logger.error(`Claude API error for ${symbol}: ${error.message}`);
      throw new APIError(
        `Failed to analyze stock ${symbol} with Claude: ${error.message}`
      );
    }
  }

  /**
   * Claude への問い合わせプロンプトを作成
   */
  createPrompt(symbol, data) {
    return `
あなたは日本株のテクニカル分析とトレンド判定を得意とするファイナンシャルアナリストです。

以下の株式データを分析して、買い（BUY）・売り（SELL）・様子見（HOLD）のいずれかを判定してください。

【企業情報】
シンボル: ${data.symbol}
現在価格: ¥${data.price.toFixed(0)}

【テクニカル指標】
- 移動平均線:
  * MA5（5日線）: ${data.technical_data.ma5.toFixed(0)}
  * MA20（20日線）: ${data.technical_data.ma20.toFixed(0)}
  * MA60（60日線）: ${data.technical_data.ma60.toFixed(0)}

- RSI（14日）: ${data.technical_data.rsi.toFixed(1)}
  * RSI < 30: 売られすぎ（買いシグナル）
  * 30 <= RSI <= 70: 中立
  * RSI > 70: 買われすぎ（売りシグナル）

- MACD:
  * MACD ライン: ${data.technical_data.macd_line.toFixed(4)}
  * シグナルライン: ${data.technical_data.macd_signal.toFixed(4)}
  * ヒストグラム: ${data.technical_data.macd_histogram.toFixed(4)}

- 出来高:
  * 平均出来高: ${data.technical_data.volume_avg.toFixed(0)}
  * 本日出来高: ${data.technical_data.volume_current.toFixed(0)}
  * 出来高比: ${(data.technical_data.volume_current / data.technical_data.volume_avg).toFixed(2)}倍

- 価格変動: ${data.technical_data.price_change_percent}%（過去60日比）

【分析基準】
1. トレンド確認: MA5 > MA20 > MA60 なら上昇トレンド、その逆なら下降トレンド
2. 買いシグナル:
   - 上昇トレンド（MA5 > MA20 > MA60）
   - かつ RSI < 70（買われすぎでない）
   - かつ MACD が positive crossover を形成
   - かつ 出来高が平均以上
3. 売りシグナル:
   - 下降トレンド（MA5 < MA20 < MA60）
   - かつ RSI > 30（売られすぎでない）
   - かつ MACD が negative crossover を形成
4. 様子見:
   - 上記の条件を満たさない
   - レンジ相場中

【回答フォーマット】
JSON形式で以下のフォーマットで回答してください：
{
  "decision": "BUY" または "SELL" または "HOLD",
  "confidence": 0.50 から 1.00 の数値（小数点第2位まで）,
  "reasoning": "判定理由の詳細説明（1-2文）"
}

必ずJSON形式で回答し、それ以外の説明は不要です。
`;
  }

  /**
   * システムプロンプトを取得
   */
  getSystemPrompt() {
    return `あなたは日本株のスイングトレード分析を専門とするAIアナリストです。
テクニカル分析とトレンド判定に基づいて、迅速かつ正確な売買判定を行います。
判定時には以下の原則に従います：
- リスク管理を最優先とする
- 確実な根拠のない売買は避ける
- 常に保守的な判定を心がける`;
  }
}

export default AnthropicClient;
