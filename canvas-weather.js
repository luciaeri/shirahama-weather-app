/**
 * ============================================================
 *  SOLARIS ATMOS — Weather Particle Effect Engine
 *  canvas-weather.js
 * ============================================================
 *  フルスクリーンCanvasに天候パーティクルを描画するエンジン。
 *  太陽光強度（ソーラーインテンシティ）に応じてゴールド⇔ブルーに
 *  グラデーション変化し、風速・風向に反応するパーティクルシステム。
 * ============================================================
 */

'use strict';

/* ─── 定数 ─── */
const WC_PARTICLE_COUNT_MIN = 100;
const WC_PARTICLE_COUNT_MAX = 200;
const WC_SOLAR_GOLD  = { r: 255, g: 200, b: 50  };  // #ffc832
const WC_NEON_BLUE   = { r: 0,   g: 229, b: 255 };  // #00e5ff
const WC_NIGHT_BLUE  = { r: 30,  g: 60,  b: 120 };
const WC_CLOUD_GRAY  = { r: 160, g: 170, b: 185 };
const WC_WHITE       = { r: 255, g: 255, b: 255 };

/**
 * 2色間の線形補間（lerp）
 * @param {Object} a - { r, g, b }
 * @param {Object} b - { r, g, b }
 * @param {number} t - 0〜1
 */
function lerpColor(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** RGBA文字列を生成 */
function rgba(c, alpha = 1) {
  return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${alpha})`;
}

/* ─── パーティクルクラス ─── */
class Particle {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.size = 1;
    this.alpha = 1;
    this.life = 1;       // 1→0 で寿命管理
    this.maxLife = 1;
    this.color = { ...WC_SOLAR_GOLD };
    this.trail = 0;      // 雨モード用のトレイル長
  }
}

/* ─── メインクラス ─── */
class WeatherCanvas {
  /**
   * @param {string} canvasId - Canvas要素のID
   */
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.error(`[WeatherCanvas] Canvas "#${canvasId}" が見つかりません`);
      return;
    }
    this.ctx = this.canvas.getContext('2d');

    // デバイスピクセル比（Retina対応）
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // ─── 天候パラメータ ───
    this.mode       = 'clear';   // 'clear' | 'rain' | 'windy' | 'cloudy' | 'night'
    this.windSpeed  = 0;         // m/s
    this.windDir    = 0;         // 度 (0=北, 90=東)
    this.precip     = 0;         // 降水量 mm/h
    this.solarIntensity = 0.5;   // 0（夜）〜 1（日中ピーク）

    // ─── 補間用ターゲット ───
    this._targetWindSpeed = 0;
    this._targetWindDir   = 0;
    this._currentWindSpeed = 0;
    this._currentWindDir   = 0;

    // ─── パーティクルプール ───
    this.particles = [];
    this._initParticles(WC_PARTICLE_COUNT_MAX);

    // ─── 背景グラデーション（キャッシュ） ───
    this._bgGradientDirty = true;
    this._bgGradient = null;

    // ─── リサイズ対応 ───
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._handleResize();

    // ─── アニメーション開始 ───
    this._rafId = null;
    this._lastTime = 0;
    this._start();
  }

  /* ─────────────────── Public API ─────────────────── */

  /**
   * 天候モードを変更する
   * @param {string} mode     - 'clear' | 'rain' | 'windy' | 'cloudy' | 'night'
   * @param {number} windSpeed - 風速 m/s
   * @param {number} precip    - 降水量 mm/h
   * @param {number} windDir   - 風向（度）
   */
  setWeather(mode, windSpeed = 0, precip = 0, windDir = 0) {
    const prevMode = this.mode;
    this.mode   = mode;
    this.precip = precip;
    this._targetWindSpeed = windSpeed;
    this._targetWindDir   = windDir;

    // モード変更時にパーティクルをリセット（自然な遷移のため段階的に）
    if (prevMode !== mode) {
      this._bgGradientDirty = true;
      this._softResetParticles();
    }
  }

  /**
   * ソーラーインテンシティを設定する（0＝夜、1＝日中ピーク）
   * パーティクルカラーがブルー⇔ゴールドに変化
   * @param {number} value - 0〜1
   */
  setSolarIntensity(value) {
    this.solarIntensity = Math.max(0, Math.min(1, value));
    this._bgGradientDirty = true;
  }

  /** アニメーション停止 */
  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
  }

  /* ─────────────────── Internal: Init ─────────────────── */

  _initParticles(count) {
    this.particles = [];
    for (let i = 0; i < count; i++) {
      const p = new Particle();
      this._respawnParticle(p);
      // ランダムな初期寿命で一斉スタートを防ぐ
      p.life = Math.random() * p.maxLife;
      this.particles.push(p);
    }
  }

  /** モード切替時のソフトリセット — 寿命を短縮して自然にフェードアウト */
  _softResetParticles() {
    for (const p of this.particles) {
      p.life = Math.min(p.life, 0.3 + Math.random() * 0.4);
    }
  }

  /* ─────────────────── Internal: Resize ─────────────────── */

  _handleResize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width  = rect.width;
    this.height = rect.height;
    this.canvas.width  = this.width  * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._bgGradientDirty = true;
  }

  /* ─────────────────── Internal: Animation Loop ─────────────────── */

  _start() {
    const tick = (timestamp) => {
      const dt = Math.min((timestamp - this._lastTime) / 1000, 0.1); // 秒単位、最大100ms
      this._lastTime = timestamp;
      this._update(dt);
      this._render();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame((t) => {
      this._lastTime = t;
      this._rafId = requestAnimationFrame(tick);
    });
  }

  /* ─────────────────── Internal: Update ─────────────────── */

  _update(dt) {
    // 風パラメータの補間（急激な変化を防ぐ）
    const lerpFactor = 1 - Math.pow(0.05, dt);
    this._currentWindSpeed += (this._targetWindSpeed - this._currentWindSpeed) * lerpFactor;
    this._currentWindDir   += this._shortAngleDiff(this._currentWindDir, this._targetWindDir) * lerpFactor;

    // 風向をラジアンに変換（Canvasの座標系に合わせる）
    const windRad = (this._currentWindDir - 90) * Math.PI / 180;
    const windVx = Math.cos(windRad) * this._currentWindSpeed;
    const windVy = Math.sin(windRad) * this._currentWindSpeed;

    // アクティブパーティクル数を天候モードに応じて決定
    const activeCount = this._getActiveCount();

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // 非アクティブなパーティクルはスキップ
      if (i >= activeCount) {
        p.alpha = 0;
        continue;
      }

      // 寿命の消費
      p.life -= dt / p.maxLife;

      if (p.life <= 0) {
        this._respawnParticle(p);
        continue;
      }

      // フェードイン/アウト
      const lifeFrac = p.life;  // 1→0
      if (lifeFrac > 0.8) {
        p.alpha = (1 - lifeFrac) / 0.2;  // フェードイン
      } else if (lifeFrac < 0.2) {
        p.alpha = lifeFrac / 0.2;         // フェードアウト
      } else {
        p.alpha = 1;
      }

      // モード別の物理演算
      this._updateParticleByMode(p, dt, windVx, windVy);

      // 画面外チェック（パディング付き）
      const pad = 60;
      if (p.x < -pad || p.x > this.width + pad ||
          p.y < -pad || p.y > this.height + pad) {
        this._respawnParticle(p);
      }
    }
  }

  /** 各天候モード固有のパーティクル更新 */
  _updateParticleByMode(p, dt, windVx, windVy) {
    const speed = this._currentWindSpeed;

    switch (this.mode) {
      case 'clear': {
        // ゴールデンソーラーダスト — 緩やかに浮遊
        const drift = 8 + speed * 2;
        p.x += (p.vx + windVx * 0.3) * dt * drift;
        p.y += (p.vy + Math.sin(p.life * 6) * 0.3) * dt * drift;
        // ソーラーインテンシティに応じてカラー補間
        p.color = lerpColor(WC_NEON_BLUE, WC_SOLAR_GOLD, this.solarIntensity);
        break;
      }

      case 'rain': {
        // 雨滴 — 風に流されながら落下
        const fallSpeed = 300 + speed * 20;
        p.x += windVx * 3 * dt;
        p.y += fallSpeed * dt;
        p.trail = 8 + speed * 1.5;  // ストリーク長
        // 雨はブルー系
        const rainBase = lerpColor(WC_NEON_BLUE, WC_WHITE, 0.3);
        p.color = lerpColor(rainBase, WC_SOLAR_GOLD, this.solarIntensity * 0.2);
        break;
      }

      case 'windy': {
        // 風に高速で流されるパーティクル
        const gustFactor = 1 + Math.sin(p.life * 12) * 0.3; // 突風の揺れ
        p.x += (windVx * 6 + p.vx * 40) * dt * gustFactor;
        p.y += (windVy * 6 + p.vy * 20) * dt * gustFactor;
        p.color = lerpColor(WC_NEON_BLUE, WC_SOLAR_GOLD, this.solarIntensity * 0.7);
        break;
      }

      case 'cloudy': {
        // 灰色の浮遊パーティクル — 緩やかにドリフト
        const cloudDrift = 15 + speed * 3;
        p.x += (p.vx + windVx * 0.5) * dt * cloudDrift;
        p.y += (p.vy + Math.sin(p.life * 4) * 0.15) * dt * cloudDrift;
        p.color = lerpColor(WC_CLOUD_GRAY, WC_SOLAR_GOLD, this.solarIntensity * 0.3);
        break;
      }

      case 'night': {
        // 星空風パーティクル — ほぼ静止、ゆっくり瞬き
        p.x += p.vx * dt * 3;
        p.y += p.vy * dt * 3;
        // 瞬きエフェクト
        p.alpha *= 0.6 + Math.sin(p.life * 15 + p.x * 0.01) * 0.4;
        p.color = lerpColor(WC_NIGHT_BLUE, WC_WHITE, 0.3 + Math.random() * 0.15);
        break;
      }
    }
  }

  /** パーティクルをリスポーン（モードに応じた初期値を設定） */
  _respawnParticle(p) {
    const w = this.width  || 1;
    const h = this.height || 1;

    p.life    = 1;
    p.alpha   = 0;
    p.trail   = 0;

    switch (this.mode) {
      case 'rain':
        // 画面上部＋ランダムなX位置からスポーン
        p.x = Math.random() * w * 1.4 - w * 0.2;
        p.y = -10 - Math.random() * 60;
        p.vx = (Math.random() - 0.5) * 0.5;
        p.vy = 1;
        p.size = 1 + Math.random() * 1.5;
        p.maxLife = 1.5 + Math.random() * 2;
        break;

      case 'windy':
        // 左側からスポーン（風向に関わらず見栄え重視）
        p.x = -20;
        p.y = Math.random() * h;
        p.vx = 0.5 + Math.random() * 0.5;
        p.vy = (Math.random() - 0.5) * 0.3;
        p.size = 1 + Math.random() * 2;
        p.maxLife = 2 + Math.random() * 3;
        break;

      case 'night':
        // 画面全体にランダム配置
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.vx = (Math.random() - 0.5) * 0.2;
        p.vy = (Math.random() - 0.5) * 0.2;
        p.size = 0.5 + Math.random() * 2;
        p.maxLife = 4 + Math.random() * 6;
        break;

      case 'cloudy':
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.vx = (Math.random() - 0.5) * 0.6;
        p.vy = (Math.random() - 0.5) * 0.2;
        p.size = 2 + Math.random() * 4;
        p.maxLife = 4 + Math.random() * 5;
        break;

      case 'clear':
      default:
        // ゴールデンソーラーダスト — 画面全体
        p.x = Math.random() * w;
        p.y = Math.random() * h;
        p.vx = (Math.random() - 0.5) * 0.8;
        p.vy = -0.1 + Math.random() * 0.2;  // やや上昇気流
        p.size = 1 + Math.random() * 3;
        p.maxLife = 3 + Math.random() * 5;
        break;
    }
  }

  /** モード別のアクティブパーティクル数 */
  _getActiveCount() {
    switch (this.mode) {
      case 'rain':   return WC_PARTICLE_COUNT_MAX;
      case 'windy':  return 160;
      case 'cloudy': return 120;
      case 'night':  return 150;
      case 'clear':
      default:       return WC_PARTICLE_COUNT_MIN + 20;
    }
  }

  /* ─────────────────── Internal: Render ─────────────────── */

  _render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // ─── 背景クリア＋グラデーション描画 ───
    this._drawBackground(ctx, w, h);

    // ─── パーティクル描画 ───
    const activeCount = this._getActiveCount();
    for (let i = 0; i < activeCount && i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.alpha <= 0.01) continue;
      this._drawParticle(ctx, p);
    }
  }

  /** 背景グラデーション描画 */
  _drawBackground(ctx, w, h) {
    // 完全クリア（高速）
    ctx.clearRect(0, 0, w, h);

    // グラデーションはモード変更時のみ再生成（キャッシュ）
    if (this._bgGradientDirty || !this._bgGradient) {
      this._bgGradient = this._createBgGradient(ctx, w, h);
      this._bgGradientDirty = false;
    }

    ctx.fillStyle = this._bgGradient;
    ctx.fillRect(0, 0, w, h);
  }

  /** モード＋ソーラーインテンシティに基づく放射グラデーション生成 */
  _createBgGradient(ctx, w, h) {
    const cx = w * 0.5;
    const cy = h * 0.4;
    const radius = Math.max(w, h) * 0.8;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);

    // ソーラーインテンシティでウォーム⇔クール補間
    const solar = this.solarIntensity;

    switch (this.mode) {
      case 'clear': {
        // 暖かいゴールド系
        const inner = lerpColor({ r: 10, g: 20, b: 50 }, { r: 40, g: 30, b: 10 }, solar * 0.5);
        const outer = { r: 5, g: 8, b: 20 };
        grad.addColorStop(0, rgba(inner, 0.15));
        grad.addColorStop(1, rgba(outer, 0.05));
        break;
      }
      case 'rain': {
        // クールブルー系
        const inner = lerpColor({ r: 5, g: 30, b: 80 }, { r: 10, g: 20, b: 50 }, solar * 0.3);
        grad.addColorStop(0, rgba(inner, 0.2));
        grad.addColorStop(1, rgba({ r: 3, g: 5, b: 15 }, 0.08));
        break;
      }
      case 'windy': {
        const inner = lerpColor({ r: 10, g: 25, b: 60 }, { r: 30, g: 25, b: 10 }, solar * 0.4);
        grad.addColorStop(0, rgba(inner, 0.15));
        grad.addColorStop(1, rgba({ r: 5, g: 8, b: 18 }, 0.05));
        break;
      }
      case 'cloudy': {
        grad.addColorStop(0, rgba({ r: 20, g: 22, b: 30 }, 0.12));
        grad.addColorStop(1, rgba({ r: 8, g: 10, b: 18 }, 0.05));
        break;
      }
      case 'night': {
        grad.addColorStop(0, rgba({ r: 5, g: 10, b: 35 }, 0.15));
        grad.addColorStop(1, rgba({ r: 2, g: 3, b: 10 }, 0.03));
        break;
      }
    }

    return grad;
  }

  /** 個々のパーティクル描画 */
  _drawParticle(ctx, p) {
    const alpha = p.alpha;

    if (this.mode === 'rain' && p.trail > 0) {
      // ─── 雨ストリーク描画 ───
      const windRad = (this._currentWindDir - 90) * Math.PI / 180;
      const trailX = -Math.cos(windRad) * p.trail;
      const trailY = -p.trail * 2;

      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + trailX, p.y + trailY);
      ctx.strokeStyle = rgba(p.color, alpha * 0.6);
      ctx.lineWidth = p.size * 0.5;
      ctx.lineCap = 'round';
      ctx.stroke();
    } else if (this.mode === 'night') {
      // ─── 星の描画（十字グロー） ───
      const s = p.size;
      ctx.globalAlpha = alpha * 0.8;

      // コアドット
      ctx.beginPath();
      ctx.arc(p.x, p.y, s * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(p.color, 1);
      ctx.fill();

      // グローハロ
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 2);
      glow.addColorStop(0, rgba(p.color, 0.3));
      glow.addColorStop(1, rgba(p.color, 0));
      ctx.beginPath();
      ctx.arc(p.x, p.y, s * 2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      ctx.globalAlpha = 1;
    } else {
      // ─── 通常パーティクル（グロー付き円） ───
      const s = p.size;

      // グローエフェクト（ソーラーモード時に強化）
      const glowRadius = s * (1.5 + this.solarIntensity * 1.5);
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowRadius);
      glow.addColorStop(0, rgba(p.color, alpha * 0.5));
      glow.addColorStop(0.5, rgba(p.color, alpha * 0.15));
      glow.addColorStop(1, rgba(p.color, 0));

      ctx.beginPath();
      ctx.arc(p.x, p.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // コア
      ctx.beginPath();
      ctx.arc(p.x, p.y, s * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(p.color, alpha * 0.9);
      ctx.fill();
    }
  }

  /* ─────────────────── Utility ─────────────────── */

  /** 角度差の最短経路を計算（-180〜180） */
  _shortAngleDiff(from, to) {
    let diff = ((to - from + 180) % 360 + 360) % 360 - 180;
    return diff;
  }
}

/* ─── DOMContentLoaded で自動初期化 ─── */
document.addEventListener('DOMContentLoaded', () => {
  window.weatherCanvas = new WeatherCanvas('weather-effect-canvas');
});
