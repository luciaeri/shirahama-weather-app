/**
 * ============================================================
 *  SOLARIS ATMOS — Runway Wind Visualizer
 *  runway-visualizer.js
 * ============================================================
 *  滑走路の俯瞰ビューに風向・風速を可視化するCanvasコンポーネント。
 *  各インスタンスが1本の滑走路を担当し、風速・風向・突風に応じて
 *  アニメーションする風ストリークと成分分解バーを描画する。
 *
 *  使い方:
 *    const viz = new RunwayVisualizer('canvas-id', {
 *      heading: 150,          // 滑走路方位（度）
 *      name:    '15/33',      // 滑走路番号
 *      label:   'SHIRAHAMA'   // 空港ラベル
 *    });
 * ============================================================
 */

'use strict';

/* ─── 定数 ─── */
const RV_BG_COLOR       = '#0a0f1e';
const RV_RUNWAY_COLOR   = '#2a3040';
const RV_RUNWAY_STRIPE  = '#3a4560';
const RV_SOLAR_GOLD     = '#ffc832';
const RV_CROSSWIND_RED  = '#ff3366';
const RV_HEADWIND_GREEN = '#39ff14';
const RV_TEXT_COLOR     = '#8090b0';
const RV_LABEL_COLOR    = '#c0c8d8';
const RV_WIND_STREAK    = 'rgba(255, 200, 50, 0.25)';

/** 度→ラジアン */
function degToRad(deg) {
  return deg * Math.PI / 180;
}

/** 角度を0-360に正規化 */
function normAngle(deg) {
  return ((deg % 360) + 360) % 360;
}

/* ─── 風ストリーク（アニメ用） ─── */
class WindStreak {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.length = 20;
    this.speed = 1;
    this.alpha = 0.3;
    this.offset = 0;  // 進行方向のオフセット
  }
}

/* ─── メインクラス ─── */
class RunwayVisualizer {
  /**
   * @param {string} canvasId - Canvas要素のID
   * @param {Object} config
   * @param {number} config.heading - 滑走路の磁方位（度、小さい方の番号側）
   * @param {string} config.name   - 滑走路番号 例: '15/33'
   * @param {string} config.label  - 空港名ラベル
   */
  constructor(canvasId, config = {}) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.error(`[RunwayVisualizer] Canvas "#${canvasId}" が見つかりません`);
      return;
    }
    this.ctx = this.canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // 滑走路設定
    this.heading    = config.heading || 0;    // 低い方の番号側の方位
    this.runwayName = config.name    || '';
    this.label      = config.label   || '';

    // 滑走路番号の分解 (例: '15/33' → ['15', '33'])
    this._runwayNumbers = this.runwayName.split('/').map(s => s.trim());
    if (this._runwayNumbers.length < 2) {
      this._runwayNumbers = [
        String(Math.round(this.heading / 10)).padStart(2, '0'),
        String(Math.round(normAngle(this.heading + 180) / 10)).padStart(2, '0'),
      ];
    }

    // 風パラメータ（現在値）
    this._windSpeed = 0;
    this._windDir   = 0;
    this._windGust  = 0;

    // 風パラメータ（補間ターゲット）
    this._targetWindSpeed = 0;
    this._targetWindDir   = 0;
    this._targetWindGust  = 0;

    // 風成分（向かい風・横風）— 描画用にキャッシュ
    this._headwindComponent  = 0;
    this._crosswindComponent = 0;

    // アクティブ滑走路端（風上側）
    this._activeRunwayEnd = 0;  // 0 = 低番号側, 1 = 高番号側

    // 風ストリークプール
    this._streaks = [];
    this._initStreaks(24);

    // リサイズ
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._handleResize();

    // 描画は外部から draw(timestamp) を呼ぶ、またはstartで自走
    this._rafId = null;
  }

  /* ─────────────────── Public API ─────────────────── */

  /**
   * 風データを更新する
   * @param {number} speed     - 風速 (kt or m/s)
   * @param {number} direction - 風向（度、北=0, 気象学的「風が吹いてくる方向」）
   * @param {number} gust      - 突風 (kt or m/s)
   */
  updateWind(speed, direction, gust = 0) {
    this._targetWindSpeed = speed;
    this._targetWindDir   = normAngle(direction);
    this._targetWindGust  = gust;
  }

  /**
   * アクティブ滑走路端を返す（風上側、つまり着陸方向）
   * @returns {string} 滑走路番号 例: '15' or '33'
   */
  get activeRunway() {
    return this._runwayNumbers[this._activeRunwayEnd] || '';
  }

  /**
   * 描画フレーム（requestAnimationFrameコールバックから呼ぶ）
   * @param {number} timestamp - performance.now()
   */
  draw(timestamp) {
    this._update(timestamp);
    this._render();
  }

  /**
   * 自走アニメーションを開始（外部で管理しない場合）
   */
  startAnimation() {
    const tick = (ts) => {
      this.draw(ts);
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  /** アニメーション停止 */
  stopAnimation() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  /** リソース解放 */
  destroy() {
    this.stopAnimation();
    window.removeEventListener('resize', this._onResize);
  }

  /* ─────────────────── Internal: Init ─────────────────── */

  _initStreaks(count) {
    this._streaks = [];
    for (let i = 0; i < count; i++) {
      const s = new WindStreak();
      this._respawnStreak(s);
      s.offset = Math.random() * 200;  // 初期オフセットをばらけさせる
      this._streaks.push(s);
    }
  }

  _respawnStreak(s) {
    // 滑走路ローカル座標系で配置（後で回転する）
    s.x = (Math.random() - 0.5) * 0.8;   // -0.4〜0.4 （幅方向の正規化座標）
    s.y = (Math.random() - 0.5) * 1.2;    // 長さ方向
    s.length = 12 + Math.random() * 20;
    s.speed = 0.5 + Math.random() * 1.5;
    s.alpha = 0.1 + Math.random() * 0.25;
    s.offset = 0;
  }

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width  = rect.width;
    this.height = rect.height;
    this.canvas.width  = this.width  * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /* ─────────────────── Internal: Update ─────────────────── */

  _update(timestamp) {
    const dt = 0.016; // ~60fps固定ステップ（簡易）

    // 風パラメータの滑らか補間
    const lf = 1 - Math.pow(0.02, dt);
    this._windSpeed += (this._targetWindSpeed - this._windSpeed) * lf;
    this._windGust  += (this._targetWindGust  - this._windGust)  * lf;

    // 角度の最短経路補間
    let dirDiff = this._targetWindDir - this._windDir;
    if (dirDiff > 180) dirDiff -= 360;
    if (dirDiff < -180) dirDiff += 360;
    this._windDir = normAngle(this._windDir + dirDiff * lf);

    // ─── 風成分の計算 ───
    // 滑走路方位に対する風の角度差を求める
    this._computeWindComponents();

    // ─── ストリーク更新 ───
    const streakSpeed = this._windSpeed * 0.3 + 0.5;
    for (const s of this._streaks) {
      s.offset += streakSpeed * s.speed * dt * 60;
      if (s.offset > 200) {
        this._respawnStreak(s);
      }
    }
  }

  /**
   * 風を滑走路成分に分解する
   * 向かい風（headwind）: 正＝向かい風（良い）、負＝追い風（悪い）
   * 横風（crosswind）: 絶対値で表示
   */
  _computeWindComponents() {
    // 風向は「吹いてくる方向」なので、風の進行方向は +180
    const windFlowDir = normAngle(this._windDir + 180);
    const heading1 = this.heading;
    const heading2 = normAngle(this.heading + 180);

    // heading1 に対する角度差
    let angleDiff1 = windFlowDir - heading1;
    if (angleDiff1 > 180) angleDiff1 -= 360;
    if (angleDiff1 < -180) angleDiff1 += 360;

    const angleDiffRad = degToRad(angleDiff1);

    // 成分分解
    const headwind1 = this._windSpeed * Math.cos(angleDiffRad);
    const crosswind = this._windSpeed * Math.sin(angleDiffRad);

    // アクティブ滑走路端を決定（向かい風が正の方を選ぶ）
    // headwind1 > 0 → heading1 方向に着陸（風が heading1 から吹いてくる）
    if (headwind1 >= 0) {
      this._activeRunwayEnd = 0;
      this._headwindComponent = headwind1;
    } else {
      this._activeRunwayEnd = 1;
      this._headwindComponent = -headwind1;
    }
    this._crosswindComponent = crosswind;
  }

  /* ─────────────────── Internal: Render ─────────────────── */

  _render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    const cx = w / 2;
    const cy = h / 2;

    // ─── 背景クリア ───
    ctx.fillStyle = RV_BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // 描画スケール（キャンバスサイズに応じて自動調整）
    const scale = Math.min(w, h) * 0.0038;
    const rw = 24 * scale;    // 滑走路幅
    const rh = 160 * scale;   // 滑走路長

    ctx.save();
    ctx.translate(cx, cy);

    // ─── 滑走路を方位に合わせて回転 ───
    const runwayRotRad = degToRad(this.heading);
    ctx.save();
    ctx.rotate(runwayRotRad);

    this._drawRunway(ctx, rw, rh, scale);
    this._drawWindStreaks(ctx, rw, rh, scale);

    ctx.restore(); // 回転解除

    // ─── コンパス「N」インジケーター ───
    this._drawCompass(ctx, w, h, cx, cy, scale);

    // ─── 風矢印（絶対座標系） ───
    this._drawWindArrow(ctx, rw, rh, scale);

    // ─── 風成分バー ───
    this._drawComponentBars(ctx, w, h, rw, rh, scale);

    // ─── ラベル ───
    this._drawLabels(ctx, w, h, scale);

    ctx.restore(); // translate解除
  }

  /** 滑走路本体の描画 */
  _drawRunway(ctx, rw, rh, scale) {
    // メインの滑走路矩形
    ctx.fillStyle = RV_RUNWAY_COLOR;
    ctx.fillRect(-rw / 2, -rh / 2, rw, rh);

    // 中央ライン（破線）
    ctx.save();
    ctx.strokeStyle = RV_RUNWAY_STRIPE;
    ctx.lineWidth = 1.5 * scale;
    ctx.setLineDash([8 * scale, 8 * scale]);
    ctx.beginPath();
    ctx.moveTo(0, -rh / 2 + 15 * scale);
    ctx.lineTo(0,  rh / 2 - 15 * scale);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // スレッショルドマーキング（各端に4本の短い白線）
    ctx.fillStyle = RV_RUNWAY_STRIPE;
    for (let end = -1; end <= 1; end += 2) {
      const yBase = end * (rh / 2 - 12 * scale);
      for (let i = -1.5; i <= 1.5; i += 1) {
        const xPos = i * (rw / 5);
        ctx.fillRect(xPos - 1 * scale, yBase - 4 * scale * end, 2 * scale, 8 * scale);
      }
    }

    // 滑走路番号の描画
    ctx.save();
    ctx.font = `bold ${10 * scale}px "SF Pro Display", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = RV_LABEL_COLOR;

    // 低番号側（heading方向 = 上端）
    const num1 = this._runwayNumbers[0];
    const num2 = this._runwayNumbers[1];

    // 上端: heading方向の番号
    ctx.save();
    ctx.translate(0, -rh / 2 + 22 * scale);
    ctx.fillText(num1, 0, 0);
    ctx.restore();

    // 下端: 反対方向の番号
    ctx.save();
    ctx.translate(0, rh / 2 - 22 * scale);
    ctx.rotate(Math.PI); // 180度回転して読めるようにする
    ctx.fillText(num2, 0, 0);
    ctx.restore();

    ctx.restore();

    // アクティブ端のハイライト
    const activeY = this._activeRunwayEnd === 0 ? -rh / 2 : rh / 2;
    const highlightGrad = ctx.createLinearGradient(0, activeY, 0, activeY + (this._activeRunwayEnd === 0 ? 30 * scale : -30 * scale));
    highlightGrad.addColorStop(0, 'rgba(57, 255, 20, 0.15)');
    highlightGrad.addColorStop(1, 'rgba(57, 255, 20, 0)');
    ctx.fillStyle = highlightGrad;
    ctx.fillRect(-rw / 2, this._activeRunwayEnd === 0 ? -rh / 2 : rh / 2 - 30 * scale, rw, 30 * scale);
  }

  /** 風ストリークのアニメーション描画 */
  _drawWindStreaks(ctx, rw, rh, scale) {
    if (this._windSpeed < 0.5) return; // 無風時は表示しない

    // 風の滑走路相対角度を計算
    const windFlowRad = degToRad(normAngle(this._windDir + 180) - this.heading);

    ctx.save();

    const alphaFactor = Math.min(this._windSpeed / 20, 1);

    for (const s of this._streaks) {
      const sx = s.x * rw * 2;
      const sy = s.y * rh;

      // ストリークのオフセットを風向に沿って適用
      const ox = sx + Math.sin(windFlowRad) * s.offset * scale;
      const oy = sy + Math.cos(windFlowRad) * s.offset * scale;

      // 滑走路内のクリッピング判定（簡易）
      const localX = ox;
      const localY = oy;
      if (Math.abs(localX) > rw * 1.5 || Math.abs(localY) > rh * 0.7) continue;

      const endX = ox + Math.sin(windFlowRad) * s.length * scale;
      const endY = oy + Math.cos(windFlowRad) * s.length * scale;

      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = `rgba(255, 200, 50, ${s.alpha * alphaFactor})`;
      ctx.lineWidth = 1 * scale;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    ctx.restore();
  }

  /** コンパス「N」インジケーター */
  _drawCompass(ctx, w, h, cx, cy, scale) {
    const radius = Math.min(w, h) * 0.42;
    // 北方向の角度（滑走路回転の逆）
    const northRad = -degToRad(this.heading) - Math.PI / 2;
    const nx = Math.cos(northRad) * radius;
    const ny = Math.sin(northRad) * radius;

    // 「N」テキスト
    ctx.font = `bold ${10 * scale}px "SF Pro Display", "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = RV_TEXT_COLOR;
    ctx.fillText('N', nx, ny);

    // 北方向へのドット
    ctx.beginPath();
    ctx.arc(nx, ny - 8 * scale, 2 * scale, 0, Math.PI * 2);
    ctx.fillStyle = RV_SOLAR_GOLD;
    ctx.fill();
  }

  /** 風向矢印の描画 */
  _drawWindArrow(ctx, rw, rh, scale) {
    if (this._windSpeed < 0.3) return;

    // 風は「吹いてくる方向」なので、矢印は反対方向を指す
    const windFlowRad = degToRad(this._windDir + 180) - degToRad(this.heading);
    const arrowLen = 35 * scale + this._windSpeed * 1.2 * scale;
    const arrowOffset = rh * 0.55 + 15 * scale; // 滑走路の外側

    // 風源の位置（滑走路回転座標系）
    ctx.save();
    ctx.rotate(degToRad(this.heading)); // 滑走路座標系に戻す

    const sourceX = -Math.sin(windFlowRad) * arrowOffset;
    const sourceY = -Math.cos(windFlowRad) * arrowOffset;
    const tipX = Math.sin(windFlowRad) * arrowLen + sourceX;
    const tipY = Math.cos(windFlowRad) * arrowLen + sourceY;

    // 矢印のシャフト
    ctx.beginPath();
    ctx.moveTo(sourceX, sourceY);
    ctx.lineTo(tipX, tipY);
    ctx.strokeStyle = RV_SOLAR_GOLD;
    ctx.lineWidth = 2.5 * scale;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 矢じり
    const headLen = 8 * scale;
    const headAngle = Math.atan2(tipY - sourceY, tipX - sourceX);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - Math.cos(headAngle - 0.4) * headLen,
      tipY - Math.sin(headAngle - 0.4) * headLen
    );
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX - Math.cos(headAngle + 0.4) * headLen,
      tipY - Math.sin(headAngle + 0.4) * headLen
    );
    ctx.strokeStyle = RV_SOLAR_GOLD;
    ctx.lineWidth = 2.5 * scale;
    ctx.stroke();

    // 風速テキスト
    ctx.save();
    ctx.rotate(-degToRad(this.heading)); // 絶対座標に戻す
    const labelX = (sourceX * Math.cos(degToRad(this.heading)) - sourceY * Math.sin(degToRad(this.heading)));
    const labelY = (sourceX * Math.sin(degToRad(this.heading)) + sourceY * Math.cos(degToRad(this.heading)));
    ctx.font = `bold ${8 * scale}px "SF Pro Display", "Segoe UI", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = RV_SOLAR_GOLD;
    ctx.fillText(`${this._windSpeed.toFixed(0)}kt`, labelX, labelY - 10 * scale);
    if (this._windGust > this._windSpeed + 2) {
      ctx.fillStyle = RV_CROSSWIND_RED;
      ctx.font = `${7 * scale}px "SF Pro Display", "Segoe UI", monospace`;
      ctx.fillText(`G${this._windGust.toFixed(0)}`, labelX, labelY + 4 * scale);
    }
    ctx.restore();

    ctx.restore();
  }

  /** 向かい風/横風 成分バー */
  _drawComponentBars(ctx, w, h, rw, rh, scale) {
    const barW = 6 * scale;
    const maxBarH = 50 * scale;
    const barX = w / 2 - 25 * scale;
    const barY = -h / 2 + 15 * scale;

    // ─── 向かい風バー（緑） ───
    const hwFrac = Math.min(Math.abs(this._headwindComponent) / 30, 1);
    const hwBarH = hwFrac * maxBarH;

    // バー背景
    ctx.fillStyle = 'rgba(57, 255, 20, 0.08)';
    ctx.fillRect(barX, barY, barW, maxBarH);

    // バー本体
    ctx.fillStyle = RV_HEADWIND_GREEN;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(barX, barY + maxBarH - hwBarH, barW, hwBarH);
    ctx.globalAlpha = 1;

    // ラベル
    ctx.font = `${6 * scale}px "SF Pro Display", "Segoe UI", monospace`;
    ctx.textAlign = 'center';
    ctx.fillStyle = RV_HEADWIND_GREEN;
    ctx.fillText('HW', barX + barW / 2, barY - 5 * scale);
    ctx.fillText(`${Math.abs(this._headwindComponent).toFixed(0)}`, barX + barW / 2, barY + maxBarH + 10 * scale);

    // ─── 横風バー（赤） ───
    const cwX = barX - 15 * scale;
    const cwFrac = Math.min(Math.abs(this._crosswindComponent) / 30, 1);
    const cwBarH = cwFrac * maxBarH;

    ctx.fillStyle = 'rgba(255, 51, 102, 0.08)';
    ctx.fillRect(cwX, barY, barW, maxBarH);

    ctx.fillStyle = RV_CROSSWIND_RED;
    ctx.globalAlpha = 0.7;
    ctx.fillRect(cwX, barY + maxBarH - cwBarH, barW, cwBarH);
    ctx.globalAlpha = 1;

    ctx.fillStyle = RV_CROSSWIND_RED;
    ctx.fillText('XW', cwX + barW / 2, barY - 5 * scale);
    ctx.fillText(`${Math.abs(this._crosswindComponent).toFixed(0)}`, cwX + barW / 2, barY + maxBarH + 10 * scale);
  }

  /** ラベル描画（空港名、アクティブ滑走路） */
  _drawLabels(ctx, w, h, scale) {
    const leftX = -w / 2 + 10 * scale;
    const topY  = -h / 2 + 12 * scale;

    // 空港ラベル
    ctx.font = `bold ${8 * scale}px "SF Pro Display", "Segoe UI", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = RV_LABEL_COLOR;
    ctx.fillText(this.label, leftX, topY);

    // 滑走路名
    ctx.font = `${7 * scale}px "SF Pro Display", "Segoe UI", monospace`;
    ctx.fillStyle = RV_TEXT_COLOR;
    ctx.fillText(`RWY ${this.runwayName}`, leftX, topY + 12 * scale);

    // アクティブ滑走路端
    ctx.fillStyle = RV_HEADWIND_GREEN;
    ctx.fillText(`▸ ACTIVE: ${this.activeRunway}`, leftX, topY + 24 * scale);

    // 風向テキスト
    ctx.fillStyle = RV_TEXT_COLOR;
    ctx.fillText(`WIND: ${Math.round(this._windDir)}° / ${this._windSpeed.toFixed(0)}kt`, leftX, topY + 36 * scale);
  }
}

// RunwayVisualizerをグローバルに公開（app.jsからインスタンス化する想定）
window.RunwayVisualizer = RunwayVisualizer;
