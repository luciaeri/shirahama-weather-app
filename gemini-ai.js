/**
 * ============================================================
 *  SOLARIS ATMOS — Gemini AI 統合モジュール
 * ============================================================
 *  ソーラーカー気象戦略AIチャットボット & 自動要約システム
 *  - Gemini 2.0 Flash API 連携
 *  - 音声入力（Web Speech API）
 *  - レートリミッター付きリクエストキュー
 * ============================================================
 */

'use strict';

class GeminiAI {
  // ─── 定数 ───────────────────────────────────────────────
  /** Gemini API エンドポイント */
  static API_ENDPOINT =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  /** localStorage に保存するキー名 */
  static STORAGE_KEY = 'solaris-gemini-key';

  /** API 呼び出しの最小間隔（ミリ秒） */
  static MIN_CALL_INTERVAL_MS = 2000;

  /** デフォルトの自動要約間隔（1 時間） */
  static DEFAULT_SUMMARY_INTERVAL_MS = 3600000;

  // ─── システムプロンプト ─────────────────────────────────
  /** チャット用システムプロンプト（日本語） */
  static SYSTEM_PROMPT = [
    'あなたは「SOLARIS AI」という名前のソーラーカー気象戦略AIアシスタントです。',
    '以下の役割を担います：',
    '1. 気象条件がソーラーカーレース／走行に与える影響を分析し、質問に回答する。',
    '2. 太陽光エネルギー収穫量を最大化するためのアドバイスを提供する。',
    '3. 気象・日射データに基づいた最適な走行速度と戦略を提案する。',
    '4. 提供されるリアルタイム気象データを参照して回答する。',
    '',
    '回答は簡潔かつ実用的に、日本語で行ってください。',
    '数値データがある場合は具体的に引用し、根拠を示してください。',
  ].join('\n');

  /** 自動要約用プロンプトテンプレート（日本語） */
  static SUMMARY_PROMPT_TEMPLATE = [
    'あなたはソーラーカーチームの気象戦略AIです。',
    '以下の気象・太陽光データを基に、3〜4文の簡潔な日本語で戦略要約を作成してください。',
    '要約には次を含めてください：',
    '- 現在の天候と走行への影響',
    '- 太陽光パネル発電量の評価と今後の見通し',
    '- 推奨する走行戦略（速度調整・休憩タイミングなど）',
    '',
    '【気象データ】',
  ].join('\n');

  // ─── コンストラクタ ────────────────────────────────────
  constructor() {
    /** @type {number} 最後の API 呼び出しタイムスタンプ */
    this._lastCallTimestamp = 0;

    /** @type {Promise<void>} リクエストキュー（直列化用） */
    this._requestQueue = Promise.resolve();

    /** @type {number|null} 自動要約タイマー ID */
    this._summaryTimerId = null;

    /** @type {SpeechRecognition|null} 音声認識インスタンス */
    this._recognition = null;

    /** @type {boolean} 音声認識中フラグ */
    this._listening = false;

    console.log('[SOLARIS AI] Gemini AI モジュール初期化完了');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  API キー管理
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 保存済みの API キーを取得する
   * @returns {string|null}
   */
  getApiKey() {
    return localStorage.getItem(GeminiAI.STORAGE_KEY);
  }

  /**
   * API キーを localStorage に保存する
   * @param {string} key - Gemini API キー
   */
  setApiKey(key) {
    if (typeof key !== 'string' || key.trim() === '') {
      console.warn('[SOLARIS AI] 無効な API キーが渡されました');
      return;
    }
    localStorage.setItem(GeminiAI.STORAGE_KEY, key.trim());
    console.log('[SOLARIS AI] API キーを保存しました');
  }

  /**
   * API キーが設定済みかどうか判定する
   * @returns {boolean}
   */
  hasApiKey() {
    const key = this.getApiKey();
    return typeof key === 'string' && key.trim().length > 0;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  レートリミッター
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * レートリミットを守りつつ API を呼び出す
   * 前回呼び出しから MIN_CALL_INTERVAL_MS 経過するまで待機する
   * @param {Function} apiCallFn - 実行する非同期関数
   * @returns {Promise<string>} API レスポンステキスト
   */
  _enqueue(apiCallFn) {
    // キューに直列で追加し、前のリクエスト完了後に実行する
    this._requestQueue = this._requestQueue
      .then(() => this._waitForRateLimit())
      .then(() => {
        this._lastCallTimestamp = Date.now();
        return apiCallFn();
      })
      .catch((err) => {
        // キュー内エラーは呼び出し元へ伝搬させる
        throw err;
      });

    return this._requestQueue;
  }

  /**
   * レートリミット待機
   * @returns {Promise<void>}
   */
  _waitForRateLimit() {
    const elapsed = Date.now() - this._lastCallTimestamp;
    const remaining = GeminiAI.MIN_CALL_INTERVAL_MS - elapsed;

    if (remaining > 0) {
      console.log(`[SOLARIS AI] レートリミット: ${remaining}ms 待機中...`);
      return new Promise((resolve) => setTimeout(resolve, remaining));
    }
    return Promise.resolve();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Gemini API 呼び出し（内部）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Gemini API へ POST リクエストを送信する
   * @param {string} promptText - 送信するプロンプト全文
   * @param {object}  [config]  - generationConfig の上書き
   * @returns {Promise<string>} 生成テキスト
   */
  async _callGeminiAPI(promptText, config = {}) {
    // API キー確認
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return 'エラー：API キーが設定されていません。設定画面から Gemini API キーを登録してください。';
    }

    const url = `${GeminiAI.API_ENDPOINT}?key=${apiKey}`;

    const body = {
      contents: [
        {
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature: config.temperature ?? 0.7,
        maxOutputTokens: config.maxOutputTokens ?? 1024,
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // HTTP エラーハンドリング
      if (!response.ok) {
        return this._handleHttpError(response.status);
      }

      const data = await response.json();

      // レスポンス構造の検証と抽出
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        console.warn('[SOLARIS AI] 空のレスポンスを受信:', data);
        return 'AIからの応答を取得できませんでした。しばらくしてからもう一度お試しください。';
      }

      return text;
    } catch (err) {
      console.error('[SOLARIS AI] API 通信エラー:', err);
      return this._handleNetworkError(err);
    }
  }

  /**
   * HTTP ステータスコードに応じたエラーメッセージを返す
   * @param {number} status
   * @returns {string}
   */
  _handleHttpError(status) {
    switch (status) {
      case 400:
        return 'エラー：リクエスト形式に問題があります。入力内容を確認してください。';
      case 401:
      case 403:
        return 'エラー：API キーが無効か、権限がありません。設定画面でキーを確認してください。';
      case 404:
        return 'エラー：APIエンドポイントが見つかりません。設定を確認してください。';
      case 429:
        return 'エラー：APIの利用制限に達しました。しばらく待ってから再度お試しください。';
      case 500:
      case 503:
        return 'エラー：Gemini サーバーに問題が発生しています。時間をおいてお試しください。';
      default:
        return `エラー：予期しないHTTPステータス (${status}) が返されました。`;
    }
  }

  /**
   * ネットワーク系エラーのメッセージを返す
   * @param {Error} err
   * @returns {string}
   */
  _handleNetworkError(err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      return 'エラー：ネットワーク接続に問題があります。インターネット接続を確認してください。';
    }
    if (err.name === 'AbortError') {
      return 'リクエストがタイムアウトしました。再度お試しください。';
    }
    return `通信エラーが発生しました：${err.message || '不明なエラー'}`;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  気象コンテキストの構築
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * weatherContext オブジェクトから可読テキストを生成する
   * @param {object} ctx - 気象データコンテキスト
   * @returns {string}
   */
  _buildContextString(ctx) {
    if (!ctx || typeof ctx !== 'object') {
      return '（気象データなし）';
    }

    const lines = [];

    if (ctx.city)           lines.push(`都市: ${ctx.city}`);
    if (ctx.temp != null)   lines.push(`気温: ${ctx.temp}°C`);
    if (ctx.humidity != null) lines.push(`湿度: ${ctx.humidity}%`);
    if (ctx.windSpeed != null) {
      const dir = ctx.windDir ? `${ctx.windDir} ` : '';
      lines.push(`風速: ${dir}${ctx.windSpeed} m/s`);
    }
    if (ctx.solarGHI != null) lines.push(`全天日射量 (GHI): ${ctx.solarGHI} W/m²`);
    if (ctx.solarDNI != null) lines.push(`直達日射量 (DNI): ${ctx.solarDNI} W/m²`);
    if (ctx.panelOutput != null) lines.push(`パネル推定出力: ${ctx.panelOutput} W`);
    if (ctx.optimalSpeed != null) lines.push(`推奨走行速度: ${ctx.optimalSpeed} km/h`);
    if (ctx.energyBalance != null) lines.push(`エネルギー収支: ${ctx.energyBalance} W`);
    if (ctx.forecast)       lines.push(`予報トレンド: ${ctx.forecast}`);

    return lines.length > 0 ? lines.join('\n') : '（気象データなし）';
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  チャット機能
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * AI チャットボットにメッセージを送信する
   * @param {string} userMessage   - ユーザーの入力テキスト
   * @param {object} weatherContext - 現在の気象データオブジェクト
   * @returns {Promise<string>} AI の応答テキスト
   */
  async chat(userMessage, weatherContext = null) {
    if (!userMessage || typeof userMessage !== 'string' || userMessage.trim() === '') {
      return 'メッセージを入力してください。';
    }

    const contextStr = this._buildContextString(weatherContext);

    // システムプロンプト + 気象コンテキスト + ユーザーメッセージを一つにまとめる
    const fullPrompt = [
      GeminiAI.SYSTEM_PROMPT,
      '',
      '【現在の気象データ】',
      contextStr,
      '',
      `【ユーザーの質問】`,
      userMessage.trim(),
    ].join('\n');

    try {
      return await this._enqueue(() => this._callGeminiAPI(fullPrompt));
    } catch (err) {
      console.error('[SOLARIS AI] チャットエラー:', err);
      return '予期しないエラーが発生しました。もう一度お試しください。';
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  自動要約生成
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 気象データから AI 要約を生成する
   * @param {object} weatherData - 気象データ（chat と同じ形式）
   * @returns {Promise<string>} 要約テキスト
   */
  async generateSummary(weatherData) {
    const contextStr = this._buildContextString(weatherData);

    const prompt = [
      GeminiAI.SUMMARY_PROMPT_TEMPLATE,
      contextStr,
    ].join('\n');

    try {
      return await this._enqueue(() =>
        this._callGeminiAPI(prompt, {
          temperature: 0.5,       // 要約はやや低めの温度で安定させる
          maxOutputTokens: 512,   // 簡潔な出力に制限
        })
      );
    } catch (err) {
      console.error('[SOLARIS AI] 要約生成エラー:', err);
      return '要約の生成に失敗しました。';
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  自動要約スケジューラー
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 定期自動要約を開始する
   * 初回は即座に実行し、以降は intervalMs ごとに繰り返す
   * @param {Function} callback     - 要約テキストを受け取るコールバック (summary: string) => void
   * @param {number}   [intervalMs] - 繰り返し間隔（デフォルト: 1 時間）
   */
  startAutoSummary(callback, intervalMs = GeminiAI.DEFAULT_SUMMARY_INTERVAL_MS) {
    if (typeof callback !== 'function') {
      console.error('[SOLARIS AI] startAutoSummary: callback は関数である必要があります');
      return;
    }

    // 既存のタイマーを停止してから再開する
    this.stopAutoSummary();

    console.log(
      `[SOLARIS AI] 自動要約スケジューラー開始 (間隔: ${(intervalMs / 60000).toFixed(1)} 分)`
    );

    /**
     * 要約を生成してコールバックに渡す内部関数
     * weatherData は window.solarisWeatherData から取得する想定
     */
    const runSummary = async () => {
      try {
        // アプリ側がグローバルに気象データを公開している前提
        const weatherData = window.solarisWeatherData || null;
        const summary = await this.generateSummary(weatherData);
        callback(summary);
      } catch (err) {
        console.error('[SOLARIS AI] 自動要約実行エラー:', err);
        callback('自動要約の生成に失敗しました。');
      }
    };

    // 初回は即座に実行
    runSummary();

    // 定期実行タイマーを設定
    this._summaryTimerId = setInterval(runSummary, intervalMs);
  }

  /**
   * 自動要約スケジューラーを停止する
   */
  stopAutoSummary() {
    if (this._summaryTimerId !== null) {
      clearInterval(this._summaryTimerId);
      this._summaryTimerId = null;
      console.log('[SOLARIS AI] 自動要約スケジューラー停止');
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  音声入力（Web Speech API）
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * 音声認識を開始する（日本語ロケール）
   * @param {Function} callback - 認識結果テキストを受け取るコールバック (transcript: string) => void
   */
  startVoiceInput(callback) {
    if (typeof callback !== 'function') {
      console.error('[SOLARIS AI] startVoiceInput: callback は関数である必要があります');
      return;
    }

    // ブラウザ互換性チェック
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('[SOLARIS AI] Web Speech API はこのブラウザでサポートされていません');
      callback(null, 'お使いのブラウザは音声入力に対応していません。');
      return;
    }

    // 既に認識中なら停止してから再開する
    if (this._listening) {
      this.stopVoiceInput();
    }

    const recognition = new SpeechRecognition();

    // ─── 認識設定 ───
    recognition.lang = 'ja-JP';           // 日本語
    recognition.continuous = false;        // 単発認識
    recognition.interimResults = false;    // 確定結果のみ
    recognition.maxAlternatives = 1;       // 最上位候補のみ

    // ─── イベントハンドラー ───
    recognition.onstart = () => {
      this._listening = true;
      console.log('[SOLARIS AI] 音声認識開始');
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || '';
      const confidence = event.results[0]?.[0]?.confidence || 0;
      console.log(
        `[SOLARIS AI] 音声認識結果: "${transcript}" (信頼度: ${(confidence * 100).toFixed(1)}%)`
      );
      callback(transcript);
    };

    recognition.onerror = (event) => {
      console.error('[SOLARIS AI] 音声認識エラー:', event.error);

      const errorMessages = {
        'no-speech':       '音声が検出されませんでした。もう一度お試しください。',
        'audio-capture':   'マイクにアクセスできません。マイクの接続を確認してください。',
        'not-allowed':     'マイクの使用が許可されていません。ブラウザの設定を確認してください。',
        'network':         'ネットワークエラーが発生しました。',
        'aborted':         '音声認識が中断されました。',
        'service-not-available': '音声認識サービスが利用できません。',
      };

      const message = errorMessages[event.error] || `音声認識エラー: ${event.error}`;
      callback(null, message);
    };

    recognition.onend = () => {
      this._listening = false;
      this._recognition = null;
      console.log('[SOLARIS AI] 音声認識終了');
    };

    // 認識を開始
    this._recognition = recognition;
    try {
      recognition.start();
    } catch (err) {
      console.error('[SOLARIS AI] 音声認識の開始に失敗:', err);
      this._listening = false;
      this._recognition = null;
      callback(null, '音声認識の開始に失敗しました。');
    }
  }

  /**
   * 音声認識を停止する
   */
  stopVoiceInput() {
    if (this._recognition) {
      try {
        this._recognition.stop();
      } catch (_) {
        // 既に停止している場合のエラーを無視
      }
      this._recognition = null;
      this._listening = false;
      console.log('[SOLARIS AI] 音声認識を手動停止');
    }
  }

  /**
   * 現在音声認識中かどうかを返す
   * @returns {boolean}
   */
  isListening() {
    return this._listening;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  ユーティリティ
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * モジュールの状態を取得する（デバッグ用）
   * @returns {object}
   */
  getStatus() {
    return {
      hasApiKey: this.hasApiKey(),
      isListening: this._listening,
      isSummaryActive: this._summaryTimerId !== null,
      lastCallTimestamp: this._lastCallTimestamp,
      queuePending: this._requestQueue !== Promise.resolve(),
    };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  初期化
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

document.addEventListener('DOMContentLoaded', () => {
  window.geminiAI = new GeminiAI();
});
