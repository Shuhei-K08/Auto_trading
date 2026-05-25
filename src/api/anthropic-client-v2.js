/**
 * Anthropic Client V2
 * 高度なテクニカル指標を活用した詳細分析プロンプト
 */

import Anthropic from '@anthropic-ai/sdk';
import logger from '../utils/logger.js';
import { APIError } from '../utils/errors.js';
import config from '../config.js';

class AnthropicClientV2 {
  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  /**
   * 高度な指標付きの詳細分析を実行
   * @param {string} symbol 銘柄コード
   * @param {object} stockData DataFetcher の生データ
   * @param {object} advancedTechnical TechnicalAnalyzerV2.analyzeAdvanced() の結果
   * @returns {object}
   */
  async analyzeStockAdvanced(symbol, stockData, advancedTechnical) {
    try {
      logger.debug(`[V2] Analyzing ${symbol} with advanced Claude prompt...`);

      const prompt = this.buildAdvancedPrompt(symbol, stockData, advancedTechnical);

      const message = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = message.content[0].text;
      logger.debug(`[V2] Claude raw response: ${text}`);

      const result = this.parseAdvancedResponse(text);
      return result;
    } catch (error) {
      logger.error(`[V2] Claude API error for ${symbol}: ${error.message}`);
      throw new APIError(`Failed to analyze stock ${symbol} with Claude V2: ${error.message}`);
    }
  }

  /**
   * 詳細プロンプトを構築
   */
  buildAdvancedPrompt(symbol, stockData, adv) {
    if (!adv) {
      // フォールバック：基本プロンプトに近い形
      return this.buildFallbackPrompt(symbol, stockData);
    }

    const b = adv.basic;
    const a = adv.advanced;
    const conv = adv.convergence;
    const currentPrice = adv.currentPrice ?? stockData.currentPrice;

    // ATR ベースの SL/TP（数値として渡せるよう事前計算）
    const atrVal = a.atr?.atr ?? 0;
    const sl = atrVal > 0 ? (currentPrice - atrVal * 2).toFixed(0) : '計算不能';
    const tp = atrVal > 0 ? (currentPrice + atrVal * 3).toFixed(0) : '計算不能';
    const rrRatio = atrVal > 0 ? (3 / 2).toFixed(2) : 'N/A';

    return `
あなたは日本株のスイングトレード判定の専門家です。
以下のテクニカルデータを分析して、買い/売り/保持の判定と、
その根拠となる詳細な分析結果をJSON形式で返してください。

【銘柄情報】
銘柄コード: ${symbol}
現在価格: ¥${currentPrice}

【テクニカル指標（基本）】
移動平均線:
  - MA5: ¥${(b.ma5 ?? 0).toFixed(0)}
  - MA20: ¥${(b.ma20 ?? 0).toFixed(0)}
  - MA60: ¥${(b.ma60 ?? 0).toFixed(0)}
  - トレンド: ${b.trend}

RSI（14日）: ${(b.rsi ?? 0).toFixed(1)}
MACD ヒストグラム: ${(b.macd?.histogram ?? 0).toFixed(4)}
出来高比（対20日平均）: ${(b.volumeRatio ?? 1).toFixed(2)}倍

【テクニカル指標（拡張）】
ボリンジャーバンド:
  - 上部: ¥${a.bollinger ? a.bollinger.upperBand.toFixed(0) : 'N/A'}
  - 中心（SMA20）: ¥${a.bollinger ? a.bollinger.sma.toFixed(0) : 'N/A'}
  - 下部: ¥${a.bollinger ? a.bollinger.lowerBand.toFixed(0) : 'N/A'}
  - バンド幅: ${a.bollinger ? a.bollinger.bandwidth.toFixed(2) : 'N/A'}%
  - 価格位置: ${a.bollinger?.position ?? 'N/A'}
  - バンドウォーク: ${a.bollinger?.isWalking ? 'あり' : 'なし'}

ストキャスティクス:
  - K値: ${a.stochastic ? a.stochastic.k.toFixed(1) : 'N/A'}
  - D値: ${a.stochastic ? a.stochastic.d.toFixed(1) : 'N/A'}
  - クロス: ${a.stochastic?.crossover ?? 'N/A'}
  - 買われすぎ: ${a.stochastic?.overbought ? 'はい' : 'いいえ'}
  - 売られすぎ: ${a.stochastic?.oversold ? 'はい' : 'いいえ'}
  - ダイバージェンス: ${a.stochastic?.divergence ? '検出' : 'なし'}

一目均衡表:
  - 転換線: ¥${a.ichimoku ? a.ichimoku.conversionLine.toFixed(0) : 'N/A'}
  - 基準線: ¥${a.ichimoku ? a.ichimoku.baseLine.toFixed(0) : 'N/A'}
  - 雲の上: ¥${a.ichimoku ? a.ichimoku.cloudTop.toFixed(0) : 'N/A'}
  - 雲の下: ¥${a.ichimoku ? a.ichimoku.cloudBottom.toFixed(0) : 'N/A'}
  - シグナル: ${a.ichimoku?.signal ?? 'N/A'}
  - 雲の中: ${a.ichimoku?.inCloud ? 'はい（中立）' : 'いいえ'}

ATR（14日）:
  - ATR値: ¥${atrVal > 0 ? atrVal.toFixed(0) : 'N/A'}
  - ボラティリティ: ${a.atr?.volatilityLevel ?? 'N/A'}
  - 動的SL（ATR×2）: ¥${sl}
  - 動的TP（ATR×3）: ¥${tp}

ADX（14日）:
  - ADX値: ${a.adx ? a.adx.adx.toFixed(1) : 'N/A'}
  - DI+: ${a.adx ? a.adx.diPlus.toFixed(1) : 'N/A'}
  - DI-: ${a.adx ? a.adx.diMinus.toFixed(1) : 'N/A'}
  - トレンド強度: ${a.adx?.trendStrength ?? 'N/A'}

【相互確認結果】
強気シグナル数: ${conv.bullishSignals} / ${conv.totalSignals}
弱気シグナル数: ${conv.bearishSignals} / ${conv.totalSignals}
一致率: ${(conv.convergenceRate * 100).toFixed(0)}%
矛盾している指標: ${conv.divergences.length > 0 ? conv.divergences.join('; ') : 'なし'}
テクニカルスコア（プログラム算出）: ${adv.technicalScore}/100

【分析手順】
Step 1: トレンド判定 - MA配列・一目均衡表でトレンドを確認
Step 2: モメンタム判定 - RSI・ストキャスティクスのクロスとダイバージェンス
Step 3: トレンド強度確認 - ADX値（>20でトレンドあり、低くても他指標が揃えば判断可）・BB幅
Step 4: 複数指標の相互確認 - シグナルの一致度を確認
Step 5: リスク・リターン比の確認 - SL:¥${sl} / TP:¥${tp} / RR比:${rrRatio}

【重要な判定ルール】
✓ 6個以上の指標が一致 → 信頼度 +5〜10%
✗ 3個以上の指標が矛盾 → 信頼度 -5〜10%
✓ ADX > 30（非常に強い）→ 信頼度 +5%
△ ADX 15〜20（弱いトレンド）→ 他の指標が揃っていれば BUY/SELL 判断可（信頼度変更なし）
✗ ADX < 15（ほぼトレンドなし）→ 信頼度 -5%（ただし他指標が5個以上一致なら無視可）
✓ ダイバージェンス検出 → 転換シグナルとして重視
✗ リスク・リターン比 < 1.0 → 信頼度 -5%
✓ デモモード：積極的に BUY/SELL を出力し、HOLDは他指標が矛盾する場合のみに限定する

【出力形式】
以下のJSONのみを返してください（他の説明は不要）:
{
  "decision": "BUY" or "SELL" or "HOLD",
  "confidence": 0.55〜1.00の数値（積極的にBUY/SELLを出力し、信頼度は正直に評価すること）,
  "analysis": {
    "trendJudgment": "トレンド判定の詳細",
    "momentumSignal": "RSI/ストキャスティクスの判定",
    "convergence": "複数指標の一致度",
    "divergences": "検出されたダイバージェンス",
    "trendStrength": "ADX値に基づく強度",
    "cloudPosition": "一目均衡表での位置",
    "bollingerAnalysis": "BB幅と価格位置の意味"
  },
  "technicalScore": 0〜100の整数,
  "stopLoss": { "price": ${sl}, "reason": "ATR×2に基づく" },
  "takeProfit": { "price": ${tp}, "reason": "ATR×3に基づく" },
  "riskRewardRatio": ${rrRatio},
  "reasoning": {
    "whyBuy": "買う場合の詳細理由",
    "whySell": "売る場合の詳細理由",
    "considerations": "注意すべき点",
    "marketContext": "現在の市場環境での位置付け"
  },
  "positionSizeAdjustment": 1.0〜1.5の数値
}
`.trim();
  }

  /**
   * 高度指標データがない場合のフォールバックプロンプト
   */
  buildFallbackPrompt(symbol, stockData) {
    return `
銘柄コード: ${symbol}、現在価格: ¥${stockData.currentPrice}
テクニカルデータが不足しています。保守的な判断でHOLDを推奨してください。
{"decision":"HOLD","confidence":0.50,"analysis":{"trendJudgment":"データ不足","momentumSignal":"N/A","convergence":"N/A","divergences":"N/A","trendStrength":"N/A","cloudPosition":"N/A","bollingerAnalysis":"N/A"},"technicalScore":50,"stopLoss":{"price":0,"reason":"N/A"},"takeProfit":{"price":0,"reason":"N/A"},"riskRewardRatio":0,"reasoning":{"whyBuy":"","whySell":"","considerations":"データ不足のため判断不能","marketContext":""},"positionSizeAdjustment":1.0}
`.trim();
  }

  /**
   * Claude のレスポンスを JSON にパース
   */
  parseAdvancedResponse(text) {
    try {
      // JSON ブロックを抽出
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      const result = JSON.parse(jsonMatch[0]);

      // バリデーション
      if (!result.decision || !['BUY', 'SELL', 'HOLD'].includes(result.decision)) {
        result.decision = 'HOLD';
      }
      result.confidence = Math.min(1.0, Math.max(0.0, result.confidence ?? 0.5));
      result.technicalScore = Math.min(100, Math.max(0, result.technicalScore ?? 50));

      return result;
    } catch (e) {
      logger.error(`[V2] Failed to parse Claude response: ${e.message}`);
      // パース失敗時のデフォルト
      return {
        decision: 'HOLD',
        confidence: 0.5,
        analysis: { trendJudgment: 'Parse error', momentumSignal: '', convergence: '', divergences: '', trendStrength: '', cloudPosition: '', bollingerAnalysis: '' },
        technicalScore: 50,
        stopLoss: { price: 0, reason: '' },
        takeProfit: { price: 0, reason: '' },
        riskRewardRatio: 0,
        reasoning: { whyBuy: '', whySell: '', considerations: 'Response parse error', marketContext: '' },
        positionSizeAdjustment: 1.0,
      };
    }
  }
}

export default AnthropicClientV2;
