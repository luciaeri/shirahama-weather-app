# 旧南紀白浜空港局所天気予報アプリ レポート

## 1. プロジェクト概要
- **目的**: 旧南紀白浜空港（旧滑走路 15/33）に特化した、1分ごとに更新され、3時間先まで1分単位で予測できる超高性能ローカル天気予報ウェブアプリを提供する。
- **対象ユーザー**: ドローン操縦者、航空関係者、観光客、気象研究者。
- **主な機能**
  - 気温・湿度・風速・風向・瞬間最大風速・降水量・気圧・滑走路視程（RVR）等のリアルタイム表示。
  - 旧滑走路の方向（15/33）に対する**横風・向かい風**の分解表示とアクティブ滑走路自動判定。
  - **サーマル上昇気流**、**乱気流レベル**、**ドローン安全指数** の算出・可視化。
  - 3時間先（180分）までの**1分解像度**予測データをインタラクティブに閲覧できるタイムラインスライダーとChart.js グラフ。
  - 背景Canvasで**天候アニメーション**（晴天・曇り・雨・風）をリアルタイムに表現。
  - 高級感を追求した**ガラスモルフィズム**デザインとネオンカラーのUI。

## 2. アーキテクチャ構成
```
shirahama-weather-app/
├─ index.html          # アプリ全体のHTML骨格・UIレイアウト
├─ style.css           # ダークモード・ガラスモルフィズムCSSトークン
├─ canvas-weather.js   # 背景天候エフェクト（Canvas）
├─ runway-visualizer.js# 滑走路風ベクトル・windsockアニメーション
├─ app.js              # メインロジック・データ取得・シミュレーション・UI更新
└─ assets/ (optional) # 将来的に画像やアイコンを格納
```

### コンポーネント間のデータフロー
1. **データ取得**: `app.js` が Open‑Meteo API から広域実況・予測データを取得。取得失敗時は日時・季節に基づくローカルモックモデルへフォールバック。
2. **ベースライン整形**: 取得データを時間軸で線形補間し、`baselineData` として保持。
3. **1分解像度シミュレーション** (`generateMinuteResolutionForecast`):
   - カオスノイズ（複数正弦波重ね合わせ）で微細揺らぎを生成。
   - **海陸風シフト**（昼は海風、夜は陸風）を `blendAngles` で風向に誘導。
   - **標高・熱吸収**：標高90m の減温と、アスファルト熱による滑走路温度上昇を加算。
   - **サーマル**、**乱気流**、**ドローン安全指数** を物理的・経験的式で算出。
   - 180分分（0〜180）を `forecastTimeline` 配列に格納。
4. **UI 更新**:
   - `updateDashboard(offset)` が選択オフセットに応じてカード数値、滑走路ビジュアライザ、診断パネル、背景Canvasへ反映。
   - `runwayVisualizer.updateWind` が風速・風向を元に横風/向かい風、アクティブ滑走路のハイライト、windsock のなびきを更新。
   - `window.weatherCanvas.setWeather` が天候モード（clear/cloudy/rain/windy）と風速・降水量を Canvas パーティクルへ伝達。
5. **タイムラインスライダー**: ユーザーがスライダーを動かすと `selectedOffset` が変化し、`updateDashboard` が即座に呼び出される。
6. **Chart.js**: `renderForecastChart` が現在タブ (`temp`, `wind`, `precip`, `drone`) に応じたデータセットを描画。双軸・カラフルなライン、ツールチップで時刻・予測値を表示。

## 3. 主要アルゴリズムの詳細
### 3.1 カオスノイズ生成
```js
const noise1 = Math.sin(t * 0.0001) * 0.5;
const noise2 = Math.sin(t * 0.0005 + 1.2) * 0.25;
const noise3 = Math.sin(t * 0.002 + 0.5) * 0.1;
const microNoise = noise1 + noise2 + noise3; // 約 ±0.85 の微細揺らぎ
```
- 高周波・中周波・低周波を組み合わせ、自然な気象変動を再現。
- `microNoise` は温度、風速、湿度、降水量など複数パラメータにスケール変換して加算。

### 3.2 海陸風シフト (昼夜切替) 
```js
if (isDayTime) {
  // 南西寄りの海風へ誘導 (235°)
  localWindDir = blendAngles(localWindDir, 235, 0.6);
  localWindSpeed *= 1.25;
} else {
  // 北東寄りの陸風へ誘導 (55°)
  localWindDir = blendAngles(localWindDir, 55, 0.5);
  localWindSpeed *= 0.85;
}
```
- `blendAngles` が現在風向と目標風向を係数で補間し、**風向の緩やかな遷移**を実現。
- 昼は海風が強まり、夜は陸風が支配的になるように風速も変化させる。

### 3.3 滑走路熱・サーマル計算
```js
if (isSunny && hourFloat >= 9 && hourFloat <= 16) {
  const solarIntensity = Math.sin((hourFloat - 7) * Math.PI / 10); // 12時ピーク
  runwayTemp += solarIntensity * 7.5; // 最大7.5°C 上昇
  thermalUpdraft = Math.max(0, solarIntensity * 2.8 + microNoise * 0.4);
  thermalHeight = Math.round(solarIntensity * 400 + microNoise * 50 + 100);
}
```
- 晴天時の **太陽光強度** を正弦波で近似し、滑走路表面温度に加算。
- 温度差から **上昇気流速度** と **到達高度** を算出。

### 3.4 横風・向かい風分解
```js
const radDiff = ((windDir - runwayHeading) * Math.PI) / 180;
const headwind = windSpeed * Math.cos(radDiff);
const crosswind = windSpeed * Math.sin(radDiff);
```
- 風向と滑走路方位の角度差から、**Headwind**（向かい風）と **Crosswind**（横風）を即座に算出。
- アクティブ滑走路は **向かい風が正** になる方を自動選択し、UI にハイライト表示。

### 3.5 ドローン安全指数
```js
let score = 100;
score -= Math.min(60, windSpeed * 6);
score -= Math.min(20, (windGust - windSpeed) * 3);
if (precip > 0) score -= Math.min(50, precip * 2000);
if (turbulenceLevel === 'SEVERE') score -= 30;
if (rvr < 1500) score -= 25;
score = Math.max(0, Math.round(score));
```
- 風速、突風、降水、乱気流、視程を重み付けし、0‑100 のスコアに変換。
- スコアに応じて **SAFE / CAUTION / DANGER** を判定し、カードの色・アイコンが自動切替。

## 4. UI / デザインのポイント
| 要素 | デザイン手法 | 効果 |
|------|--------------|------|
| 背景 | `backdrop-filter: blur(16px)` の **Glassmorphism** | 透明感と奥行きを演出。 |
| カラーパレット | ネオンブルー・グリーン・アンバー・レッドの4色系統 | 重要情報を視覚的に強調。 |
| フォント | Google Fonts **Outfit**（見出し）・**Inter**（本文） | モダンで読みやすい。 |
| ボタン | グラデーション＋光沢エフェクト | インタラクティブ感とクリック誘導。 |
| スライダー | カスタム `range`、滑らかなトラックと 1分刻みのティック | 微調整がしやすく、現在位置が一目で分かる。 |
| グラフ | Chart.js の **ライン**＋**エリア塗り**、多軸表示 | 多変数データを同時に比較可能。 |
| 診断パネル | カラーリングとアイコンで **SAFE / CAUTION / DANGER** を即時認識 | 短時間で危険度を把握できる。 |

## 5. 動作確認手順（walkthrough.md 参照）
1. `index.html` をブラウザで開く（ローカルファイルのまま OK）。
2. 画面左上の時計が現在時刻を表示し、**1分ごとに自動更新**されることを確認。
3. タイムラインスライダーをドラッグし、カード・滑走路・グラフ・診断が **1分単位で滑らかに変化** することを確認。
4. 「風速・突風」タブで横風・向かい風の値が滑走路ビジュアライザと一致するかチェック。
5. 雨が降っているシナリオ（スライダーで降水量が >0 の時間帯）に切り替え、**背景の雨粒パーティクル**と **視程（RVR）低下** が適切に表現されているか確認。
6. 予測グラフのツールチップで、時刻・予測値が正確に表示されるか検証。
7. 予測が更新されたときに **診断パネル** が `SAFE / CAUTION / DANGER` に自動切り替わることを確認。

## 6. 今後の拡張アイデア
- **ドローン機体別プロファイル**（最大許容横風・風速）を設定し、機体ごとの安全判定を行う。
- **ローカル CSV/SQLite 保存** で過去データを蓄積し、統計的トレンド分析機能を追加。
- **音声アラート**（突風・視程低下時）を Web Audio API で実装し、リアルタイム警告を提供。
- **モバイルアプリ化**（PWA）でオフラインキャッシュとプッシュ通知を実装し、現場での使用性を向上。

---

以上が、今回作成した **旧南紀白浜空港局所天気予報アプリ** の全体像・仕組み・実装詳細です。ご質問や追加要望がございましたら遠慮なくお知らせください。
