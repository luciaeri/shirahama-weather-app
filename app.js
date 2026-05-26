/* ==========================================================================
   旧南紀白浜空港 局所天気予報アプリ - メインアプリケーション制御
   Script file: app.js
   ========================================================================== */

// --- 定数定義 ---
const SHIRAHAMA_LAT = 33.6622;
const SHIRAHAMA_LON = 135.3621;
const RUNWAY_HEADING = 150; // RWY 15/33 (150度)
const FORECAST_MINUTES = 180; // 3時間 (180分)

// --- グローバル状態管理 ---
let appState = {
    currentTime: new Date(),
    baselineData: null,          // APIから取得した大まかな実況・予測値
    forecastTimeline: [],        // 1分ごとの180分シミュレーションデータ
    selectedOffset: 0,           // タイムラインスライダーの位置 (0 = 現在, 180 = 3時間後)
    currentGraphTab: 'temp',     // 'temp', 'wind', 'precip', 'drone'
    autoUpdateInterval: null,
    modelUpdatedTime: null
};

// --- ビジュアライザ・グラフオブジェクトの参照 ---
let runwayVisualizer = null;
let forecastChart = null;

// --- 読み込み完了時の処理 ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. 各種コンポーネントの初期化
    runwayVisualizer = new RunwayVisualizer('runway-canvas');
    initAppClock();
    initEventListeners();
    
    // 2. 初回データロード
    fetchWeatherAndSimulate();
    
    // 3. 1分ごとの自動更新タイマー始動
    appState.autoUpdateInterval = setInterval(() => {
        appState.currentTime = new Date();
        updateClockDisplay();
        
        // 0分(現在)を表示している場合は、データを再計算してリアルタイム更新する
        if (appState.selectedOffset === 0) {
            fetchWeatherAndSimulate();
        } else {
            // スライダーが動いていてもバックグラウンドでベースラインだけ更新
            fetchWeatherAndSimulate(false);
        }
    }, 60000);
});

// --- 時計の初期化と表示 ---
function initAppClock() {
    updateClockDisplay();
    // 秒単位の表示更新用 (時計の見た目のため)
    setInterval(() => {
        if (appState.selectedOffset === 0) {
            const now = new Date();
            document.getElementById('current-time-display').textContent = formatDate(now);
        }
    }, 1000);
}

function updateClockDisplay() {
    if (appState.selectedOffset === 0) {
        document.getElementById('current-time-display').textContent = formatDate(appState.currentTime);
        document.getElementById('update-mode-text').textContent = "1分自動更新中";
        document.getElementById('update-mode-text').parentElement.className = "status-badge live";
    } else {
        const targetTime = new Date(appState.currentTime.getTime() + appState.selectedOffset * 60000);
        document.getElementById('current-time-display').textContent = formatDate(targetTime);
        document.getElementById('update-mode-text').textContent = `予測: +${appState.selectedOffset}分先`;
        document.getElementById('update-mode-text').parentElement.className = "status-badge caution";
    }
}

function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

// --- 気象データ取得 ＆ シミュレーションエンジン ---
async function fetchWeatherAndSimulate(shouldRedraw = true) {
    const refreshIcon = document.getElementById('refresh-icon');
    if (refreshIcon) refreshIcon.classList.add('animate-spin');

    try {
        // Open-Meteo APIより現地のリアルタイム実況値および3時間先の予測値を取得
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${SHIRAHAMA_LAT}&longitude=${SHIRAHAMA_LON}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=Asia%2FTokyo`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('API取得失敗');
        
        const data = await response.json();
        appState.baselineData = processApiData(data);
        appState.modelUpdatedTime = new Date();
        document.getElementById('val-model-updated-time').textContent = appState.modelUpdatedTime.toTimeString().split(' ')[0];
        
    } catch (error) {
        console.warn('天気API接続エラー。ローカルシミュレーションに移行します:', error);
        // API取得失敗時はローカルで現実的なダミーモデルを生成（スタンドアロン動作用）
        appState.baselineData = generateMockBaseline();
        appState.modelUpdatedTime = new Date();
        document.getElementById('val-model-updated-time').textContent = appState.modelUpdatedTime.toTimeString().split(' ')[0] + " (ローカル)";
    }

    // 1分ごとの高解像度シミュレーションデータ（180点）を生成
    generateMinuteResolutionForecast();

    if (shouldRedraw) {
        // UI更新
        updateDashboard(appState.selectedOffset);
        renderForecastChart();
    }

    if (refreshIcon) {
        setTimeout(() => {
            refreshIcon.classList.remove('animate-spin');
        }, 600);
    }
}

// --- APIレスポンスデータの整形 ---
function processApiData(apiData) {
    // 必要な時刻配列を取り出し、現在の時制に合うものを検索
    const hourly = apiData.hourly;
    const nowEpoch = appState.currentTime.getTime();
    
    // 3時間分の hourly データを配列化
    let hourlyPoints = [];
    const timeStrings = hourly.time;
    
    for (let i = 0; i < timeStrings.length; i++) {
        const pointTime = new Date(timeStrings[i]).getTime();
        // 過去3時間から未来6時間程度の範囲を抽出
        if (pointTime >= nowEpoch - 3600000 && pointTime <= nowEpoch + 14400000) {
            hourlyPoints.push({
                time: pointTime,
                temp: hourly.temperature_2m[i],
                humidity: hourly.relative_humidity_2m[i],
                windSpeed: hourly.wind_speed_10m[i] / 3.6, // km/h -> m/s
                windDir: hourly.wind_direction_10m[i],
                windGust: hourly.wind_gusts_10m[i] / 3.6,   // km/h -> m/s
                precip: hourly.precipitation[i] / 60         // mm/h -> mm/min
            });
        }
    }
    
    // APIデータが存在しない場合のフォールバック
    if (hourlyPoints.length === 0) {
        return generateMockBaseline();
    }

    return {
        current: {
            temp: apiData.current.temperature_2m,
            humidity: apiData.current.relative_humidity_2m,
            windSpeed: apiData.current.wind_speed_10m / 3.6, // m/s
            windDir: apiData.current.wind_direction_10m,
            windGust: apiData.current.wind_gusts_10m / 3.6,
            precip: apiData.current.precipitation / 60, // mm/min
            pressure: apiData.current.pressure_msl,
            weatherCode: apiData.current.weather_code
        },
        hourly: hourlyPoints
    };
}

// --- APIオフライン時の気象ベースライン生成 ---
function generateMockBaseline() {
    const hours = appState.currentTime.getHours();
    
    // 昼間は暖かく風が強い、夜間は冷え込み風が穏やかというベース
    const isDay = hours >= 6 && hours <= 18;
    const baseTemp = isDay ? 22 + Math.sin((hours - 12) * Math.PI / 12) * 5 : 16 + Math.cos((hours - 24) * Math.PI / 12) * 3;
    const baseHumidity = isDay ? 60 - Math.sin((hours - 12) * Math.PI / 12) * 15 : 85 + Math.cos((hours - 24) * Math.PI / 12) * 10;
    
    // 昼間は海風（南西寄り220度）、夜間は陸風（北東寄り60度）
    const baseWindDir = isDay ? 225 : 45;
    const baseWindSpeed = isDay ? 4.5 : 1.8;
    
    const current = {
        temp: baseTemp,
        humidity: baseHumidity,
        windSpeed: baseWindSpeed,
        windDir: baseWindDir,
        windGust: baseWindSpeed * 1.4,
        precip: 0.0, // 晴れ
        pressure: 1013.2,
        weatherCode: 0 // 快晴
    };

    // 1時間おきの変位データを作成（3時間分）
    let hourly = [];
    const nowEpoch = appState.currentTime.getTime();
    for (let i = -1; i <= 4; i++) {
        const offsetMs = i * 3600000;
        const targetHour = (hours + i + 24) % 24;
        const tDay = targetHour >= 6 && targetHour <= 18;
        const tTemp = tDay ? 22 + Math.sin((targetHour - 12) * Math.PI / 12) * 5 : 16 + Math.cos((targetHour - 24) * Math.PI / 12) * 3;
        
        hourly.push({
            time: nowEpoch + offsetMs,
            temp: tTemp,
            humidity: tDay ? 60 - Math.sin((targetHour - 12) * Math.PI / 12) * 15 : 85,
            windSpeed: tDay ? 4.5 + Math.sin(i) : 1.8,
            windDir: tDay ? 225 + (i * 10) : 45,
            windGust: (tDay ? 4.5 : 1.8) * 1.4,
            precip: 0.0
        });
    }

    return { current, hourly };
}

// --- 局所的1分解像度シミュレーションエンジン ---
function generateMinuteResolutionForecast() {
    appState.forecastTimeline = [];
    const startMs = appState.currentTime.getTime();
    const base = appState.baselineData;
    
    for (let m = 0; m <= FORECAST_MINUTES; m++) {
        const targetMs = startMs + m * 60000;
        const targetDate = new Date(targetMs);
        const hourFloat = targetDate.getHours() + targetDate.getMinutes() / 60;
        
        // 1. 時系列ベースライン（線形補間）の取得
        const interpolated = interpolateHourly(targetMs, base.hourly);
        
        // 2. カオス・カオスノイズ（1分単位の微小ゆらぎ）の適用
        // 複数の周波数の正弦波を重ね合わせてカオス的な風・気温の揺らぎを作成
        const noise1 = Math.sin(targetMs * 0.0001) * 0.5;
        const noise2 = Math.sin(targetMs * 0.0005 + 1.2) * 0.25;
        const noise3 = Math.sin(targetMs * 0.002 + 0.5) * 0.1;
        const microNoise = noise1 + noise2 + noise3; // -0.85 〜 +0.85 のレンジ

        // 3. 地形効果：旧南紀白浜空港のマイクロクライメート効果
        // A. 標高90mの丘陵地効果：標高による気温減率 (通常100mで-0.65°C、平地APIとの補正)
        let localTemp = interpolated.temp - 0.3 + (microNoise * 0.35);
        
        // B. 海陸風シミュレーション（海からの湿った風の入り込み）
        // 昼間（10:00〜17:00）は日射で陸が温まり、海（南〜西）からの海風が発達
        // 夜間は陸が冷えて、内陸山側（北東）からの冷たい陸風が吹き出す
        let localWindDir = interpolated.windDir;
        let localWindSpeed = interpolated.windSpeed;
        
        const isDayTime = hourFloat >= 10 && hourFloat <= 17;
        const isTransition = (hourFloat >= 8 && hourFloat < 10) || (hourFloat > 17 && hourFloat <= 19);
        
        if (isDayTime) {
            // 海風方向（220度〜250度付近）に風向を引き寄せる
            // 風速も海風流入により局所的に強化 (API基本値の1.2倍程度)
            localWindDir = blendAngles(localWindDir, 235, 0.6);
            localWindSpeed = localWindSpeed * 1.25 + Math.max(0, microNoise * 0.8);
        } else if (!isTransition) {
            // 陸風方向（40度〜70度付近）に引き寄せ
            localWindDir = blendAngles(localWindDir, 55, 0.5);
            localWindSpeed = Math.max(0.8, localWindSpeed * 0.85 + microNoise * 0.3);
        }

        // 風速ゆらぎから突風（Gust）を計算
        // 丘陵地のため、地表摩擦で突風率が高くなりやすい
        const gustFactor = 1.35 + (Math.sin(targetMs * 0.001) * 0.15) + (localWindSpeed > 5 ? 0.1 : 0);
        let localGust = localWindSpeed * gustFactor;

        // C. 滑走路の「日射熱サーマル（上昇気流）」シミュレーション
        // 晴天の昼間、アスファルト滑走路面は周囲の森林や海より急激に熱せられる
        const isSunny = interpolated.precip < 0.01;
        let runwayTemp = localTemp;
        let thermalUpdraft = 0.0;
        let thermalHeight = 0;
        
        if (isSunny && hourFloat >= 9 && hourFloat <= 16) {
            const solarIntensity = Math.sin((hourFloat - 7) * Math.PI / 10); // 12時にピーク
            runwayTemp += solarIntensity * 7.5; // 滑走路温度は気温より最大7.5度高くなる
            
            // 熱上昇気流 (m/s) ＝ 滑走路と周囲の温度差に基づくシミュレーション
            thermalUpdraft = Math.max(0, solarIntensity * 2.8 + (microNoise * 0.4));
            thermalHeight = Math.round(solarIntensity * 400 + (microNoise * 50) + 100); // サーマルが到達する高度 (m)
        } else if (!isSunny) {
            // 雨の日はアスファルトが気化熱で冷やされ、気温より低くなる
            runwayTemp -= Math.min(1.5, interpolated.precip * 30);
        }

        // D. 乱気流レベル (Turbulence Index) の決定
        // 風速、突風率、滑走路サーマル、および海陸風の境界（ウインドシア）から算出
        let turbulenceScore = (localWindSpeed * 0.4) + (thermalUpdraft * 0.8) + (localGust - localWindSpeed) * 0.5;
        let turbulenceLevel = "LOW";
        if (turbulenceScore > 6.0) turbulenceLevel = "SEVERE";
        else if (turbulenceScore > 3.0) turbulenceLevel = "MODERATE";

        // E. 降水量と滑走路視程 (RVR: Runway Visual Range)
        let localPrecip = interpolated.precip;
        // 1分単位でスコール（一時的な土砂降り）や雨の切れ間を生成
        if (localPrecip > 0.001) {
            const rainFluctuation = Math.max(0, 1 + Math.sin(targetMs * 0.003) * 0.7 + microNoise * 0.5);
            localPrecip = localPrecip * rainFluctuation;
        }

        // 湿度
        let localHumidity = Math.min(100, Math.max(10, interpolated.humidity + (microNoise * 4)));
        
        // 視程計算 (通常10,000m以上、湿度95%以上で霧霧による低下、雨量による著しい低下)
        let localRVR = 12000;
        if (localPrecip > 0) {
            // 雨滴による光の散乱（実験式に基づく簡易RVR低下モデル）
            localRVR = Math.max(600, 12000 - (localPrecip * 120 * 80));
        } else if (localHumidity > 92) {
            // 湿潤空気による霧のシミュレーション
            const fogFactor = (localHumidity - 92) / 8; // 0 to 1
            localRVR = Math.round(12000 - fogFactor * 10500);
        }
        localRVR = Math.round(localRVR + (microNoise * 200));

        // 滑走路表面状態 (Dry, Damp, Wet, Flooded)
        let surfaceCond = "DRY";
        if (localPrecip > 0.08) surfaceCond = "FLOODED"; // 豪雨
        else if (localPrecip > 0.01) surfaceCond = "WET";
        else if (localPrecip > 0 || localHumidity > 95) surfaceCond = "DAMP";

        // F. ドローン・航空機安全性スコア (0〜100)
        // 風速8m/s以上、突風11m/s以上、降雨あり、乱気流SEVEREでスコア低下
        let droneScore = 100;
        droneScore -= Math.min(60, (localWindSpeed * 6)); // 風速ペナルティ
        droneScore -= Math.min(20, (localGust - localWindSpeed) * 3); // 突風ペナルティ
        if (localPrecip > 0) droneScore -= Math.min(50, localPrecip * 2000); // 雨ペナルティ
        if (turbulenceLevel === "SEVERE") droneScore -= 30;
        else if (turbulenceLevel === "MODERATE") droneScore -= 15;
        if (localRVR < 1500) droneScore -= 25; // 視界不良ペナルティ
        
        droneScore = Math.max(0, Math.round(droneScore));

        let droneStatus = "SAFE";
        if (droneScore < 45) droneStatus = "DANGER";
        else if (droneScore < 75) droneStatus = "CAUTION";

        // 露点の計算 (Magnus-Tetens近似式)
        const a = 17.27;
        const b = 237.7;
        const alpha = ((a * localTemp) / (b + localTemp)) + Math.log(localHumidity / 100.0);
        const dewPoint = (b * alpha) / (a - alpha);

        // データ保存
        appState.forecastTimeline.push({
            minuteOffset: m,
            time: targetDate,
            temp: localTemp,
            runwayTemp: runwayTemp,
            humidity: localHumidity,
            dewPoint: dewPoint,
            windSpeed: localWindSpeed,
            windDir: localWindDir,
            windGust: localGust,
            precip: localPrecip,
            pressure: interpolated.pressure + (microNoise * 0.15),
            rvr: localRVR,
            surfaceCond: surfaceCond,
            thermalUpdraft: thermalUpdraft,
            thermalHeight: thermalHeight,
            turbulenceLevel: turbulenceLevel,
            droneScore: droneScore,
            droneStatus: droneStatus,
            breezeType: isDayTime ? "海風" : (!isTransition ? "陸風" : "穏やか")
        });
    }
}

// 時系列データ補間関数
function interpolateHourly(targetMs, hourlyPoints) {
    // 時間順に並んだ配列から、targetMsを挟む前後2点を探す
    let prev = hourlyPoints[0];
    let next = hourlyPoints[hourlyPoints.length - 1];

    if (targetMs <= prev.time) return prev;
    if (targetMs >= next.time) return next;

    for (let i = 0; i < hourlyPoints.length - 1; i++) {
        if (targetMs >= hourlyPoints[i].time && targetMs <= hourlyPoints[i+1].time) {
            prev = hourlyPoints[i];
            next = hourlyPoints[i+1];
            break;
        }
    }

    const fraction = (targetMs - prev.time) / (next.time - prev.time);

    return {
        temp: prev.temp + (next.temp - prev.temp) * fraction,
        humidity: prev.humidity + (next.humidity - prev.humidity) * fraction,
        windSpeed: prev.windSpeed + (next.windSpeed - prev.windSpeed) * fraction,
        windDir: interpolateAngles(prev.windDir, next.windDir, fraction),
        windGust: prev.windGust + (next.windGust - prev.windGust) * fraction,
        precip: prev.precip + (next.precip - prev.precip) * fraction,
        pressure: 1013.2 // 気圧は一定とする
    };
}

// 角度の補間 (360度境界を考慮)
function interpolateAngles(a, b, fraction) {
    let diff = b - a;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return (a + diff * fraction + 360) % 360;
}

// 角度の結合 (吸い寄せ効果)
function blendAngles(current, target, factor) {
    let diff = target - current;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return (current + diff * factor + 360) % 360;
}

// --- ダッシュボード数値・ビジュアルの更新 ---
function updateDashboard(offset) {
    const data = appState.forecastTimeline[offset];
    if (!data) return;

    // 1. 各カードの数値更新
    document.getElementById('val-temp').textContent = data.temp.toFixed(1);
    document.getElementById('val-humidity').textContent = Math.round(data.humidity);
    document.getElementById('val-dewpoint').textContent = data.dewPoint.toFixed(1);
    
    document.getElementById('val-windspeed').textContent = data.windSpeed.toFixed(1);
    document.getElementById('val-windgust').textContent = data.windGust.toFixed(1);
    
    // 風向文字変換
    const dirText = getWindDirectionText(data.windDir);
    document.getElementById('val-winddir-text').textContent = `${dirText} (${Math.round(data.windDir)}°)`;
    
    // 風向矢印の回転
    const arrow = document.getElementById('wind-direction-arrow');
    if (arrow) {
        arrow.style.transform = `rotate(${data.windDir}deg)`;
    }

    document.getElementById('val-precip').textContent = data.precip.toFixed(2);
    document.getElementById('val-pressure').textContent = Math.round(data.pressure);
    document.getElementById('val-rvr').textContent = data.rvr;

    // フライト指数表示
    const safetyBadge = document.getElementById('val-drone-status-badge');
    const safetyText = document.getElementById('val-drone-status');
    const safetyIcon = document.getElementById('icon-drone-safety');
    
    safetyText.textContent = `${data.droneStatus} (Score: ${data.droneScore})`;
    
    if (data.droneStatus === 'SAFE') {
        safetyBadge.className = 'drone-safety-badge safe';
        if (safetyIcon) {
            safetyIcon.setAttribute('data-lucide', 'shield-check');
            safetyIcon.className = 'icon-drone text-neon-green';
        }
    } else if (data.droneStatus === 'CAUTION') {
        safetyBadge.className = 'drone-safety-badge caution';
        if (safetyIcon) {
            safetyIcon.setAttribute('data-lucide', 'shield-alert');
            safetyIcon.className = 'icon-drone text-neon-amber';
        }
    } else {
        safetyBadge.className = 'drone-safety-badge danger';
        if (safetyIcon) {
            safetyIcon.setAttribute('data-lucide', 'shield-x');
            safetyIcon.className = 'icon-drone text-neon-red';
        }
    }
    // lucide再描画
    lucide.createIcons();

    document.getElementById('val-thermal').textContent = data.thermalUpdraft.toFixed(1);
    document.getElementById('val-turbulence').textContent = data.turbulenceLevel;

    // 2. 滑走路ビジュアライザの更新
    runwayVisualizer.updateWind(data.windSpeed, data.windDir);
    
    // 滑走路表面状態表示
    const sCondEl = document.getElementById('val-surface-condition');
    sCondEl.textContent = data.surfaceCond;
    if (data.surfaceCond === 'DRY') sCondEl.className = 'badge';
    else if (data.surfaceCond === 'DAMP') sCondEl.className = 'badge wet';
    else if (data.surfaceCond === 'WET') sCondEl.className = 'badge wet';
    else sCondEl.className = 'badge wet'; // flooded

    // 横風・向かい風の分解計算
    // 滑走路方位: activeRunwayが'15'なら150度、'33'なら330度
    const rwyHeading = runwayVisualizer.activeRunway === '15' ? 150 : 330;
    const radDiff = ((data.windDir - rwyHeading) * Math.PI) / 180;
    
    const headwindVal = data.windSpeed * Math.cos(radDiff);
    const crosswindVal = data.windSpeed * Math.sin(radDiff);

    // テキスト表示
    document.getElementById('val-headwind').textContent = Math.abs(headwindVal).toFixed(1);
    document.getElementById('val-crosswind').textContent = Math.abs(crosswindVal).toFixed(1);
    
    document.getElementById('val-headwind-dir').textContent = headwindVal >= 0 ? "向かい風 (Head)" : "追い風 (Tail)";
    document.getElementById('val-crosswind-side').textContent = crosswindVal >= 0 ? "右側からの横風" : "左側からの横風";

    // 3. 気象診断・解析の更新
    document.getElementById('val-runway-temp').textContent = data.runwayTemp.toFixed(1) + " °C";
    document.getElementById('val-breeze-type').textContent = data.breezeType + "循環";
    
    let gustRisk = "低";
    if (data.windGust > 12) gustRisk = "高 (強風突風)";
    else if (data.windGust > 7) gustRisk = "中 (突風注意)";
    document.getElementById('val-gust-risk').textContent = gustRisk;
    
    document.getElementById('val-thermal-height').textContent = data.thermalHeight + " m";

    // 診断メッセージの決定
    const diagAlertBox = document.getElementById('diag-alert-level-box');
    const diagTitle = document.getElementById('diag-title');
    const diagDesc = document.getElementById('diag-desc');
    const diagIcon = document.getElementById('diag-alert-icon');

    // 天候に応じた自動診断
    let alertLevel = 'safe';
    let titleStr = "滑走路周辺気象良好";
    let descStr = "局所的な気象じょう乱は検出されていません。旧滑走路は風速・視程ともに安定しており、フライト運用に適しています。";

    if (data.precip > 0.08) {
        alertLevel = 'danger';
        titleStr = "滑走路冠水注意・視程障害";
        descStr = `局所的な豪雨により滑走路表面が一部冠水し、滑走路視程(RVR)が ${data.rvr}m まで低下しています。強い下降気流に注意してください。`;
    } else if (data.windSpeed > 8.0) {
        alertLevel = 'danger';
        titleStr = "強風・重大なウインドシア警報";
        descStr = `風速が ${data.windSpeed.toFixed(1)}m/s に達しており、滑走路 15/33 に対し ${Math.abs(crosswindVal).toFixed(1)}m/s の強い横風が発生しています。`;
    } else if (data.thermalUpdraft > 1.8) {
        alertLevel = 'caution';
        titleStr = "サーマル対流（熱上昇気流）発生";
        descStr = `滑走路表面温度が気温に比べ最大 ${(data.runwayTemp - data.temp).toFixed(1)}℃ 高くなっており、サーマル上昇気流(${data.thermalUpdraft.toFixed(1)}m/s)が高度 ${data.thermalHeight}m まで発達しています。`;
    } else if (data.rvr < 1000) {
        alertLevel = 'danger';
        titleStr = "濃霧警報・視程極低";
        descStr = `海からの湿った空気が丘陵地に乗り上げ、濃霧が発生しています。RVRは ${data.rvr}m です。視覚飛行は極めて困難です。`;
    } else if (data.droneStatus === 'CAUTION') {
        alertLevel = 'caution';
        titleStr = "気象注意（フライト注意）";
        descStr = `突風および乱気流(${data.turbulenceLevel})の影響により、無人航空機(ドローン)の制御が不安定になる危険性があります。`;
    }

    diagAlertBox.className = `diag-icon-box level-${alertLevel}`;
    diagTitle.textContent = titleStr;
    diagDesc.textContent = descStr;
    
    if (alertLevel === 'safe') {
        diagIcon.setAttribute('data-lucide', 'info');
    } else if (alertLevel === 'caution') {
        diagIcon.setAttribute('data-lucide', 'alert-triangle');
    } else {
        diagIcon.setAttribute('data-lucide', 'alert-circle');
    }
    lucide.createIcons();

    // 4. 背景Canvasアニメーションへの天候・風速の伝達
    let canvasMode = 'clear';
    if (data.precip > 0.01) canvasMode = 'rain';
    else if (data.windSpeed > 6.0) canvasMode = 'windy';
    else if (data.humidity > 80) canvasMode = 'cloudy';
    
    if (window.weatherCanvas) {
        window.weatherCanvas.setWeather(canvasMode, data.windSpeed, data.precip, data.windDir);
    }
}

// 角度から風向文字列への変換
function getWindDirectionText(deg) {
    const directions = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
    const index = Math.round(((deg % 360) / 22.5)) % 16;
    return directions[index];
}

// --- インタラクティブ要素とイベントの登録 ---
function initEventListeners() {
    // 1. 手動更新ボタン
    const btnRefresh = document.getElementById('btn-refresh');
    btnRefresh.addEventListener('click', () => {
        appState.currentTime = new Date();
        updateClockDisplay();
        fetchWeatherAndSimulate();
    });

    // 2. タイムラインスライダー
    const slider = document.getElementById('timeline-slider');
    const timeDisplay = document.getElementById('val-timeline-time');
    const offsetDisplay = document.getElementById('val-timeline-offset');
    const ticks = document.querySelectorAll('.slider-ticks .tick');

    slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        appState.selectedOffset = val;
        
        // 表示時刻の更新
        const targetTime = new Date(appState.currentTime.getTime() + val * 60000);
        const timeStr = targetTime.toTimeString().split(' ')[0].substring(0, 5); // HH:MM
        
        if (val === 0) {
            timeDisplay.textContent = `現在 (${timeStr})`;
            offsetDisplay.textContent = `+0分先`;
        } else {
            timeDisplay.textContent = `${timeStr}`;
            offsetDisplay.textContent = `+${val}分先`;
        }
        
        // ティックのハイライト
        ticks.forEach(tick => {
            const tickVal = parseInt(tick.getAttribute('data-val'));
            // 最も近い目盛りをアクティブにする
            if (Math.abs(tickVal - val) < 15) {
                tick.classList.add('active');
            } else {
                tick.classList.remove('active');
            }
        });

        updateClockDisplay();
        updateDashboard(val);
    });

    // ティッククリックでジャンプ
    ticks.forEach(tick => {
        tick.addEventListener('click', () => {
            const val = parseInt(tick.getAttribute('data-val'));
            slider.value = val;
            // dispatch input event
            slider.dispatchEvent(new Event('input'));
        });
    });

    // 3. グラフ切り替えタブ
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            appState.currentGraphTab = btn.getAttribute('data-graph');
            renderForecastChart();
        });
    });

    // 4. キャンバスループ（アニメーションフレーム用）
    function canvasLoop(timestamp) {
        if (runwayVisualizer) {
            runwayVisualizer.draw(timestamp);
        }
        requestAnimationFrame(canvasLoop);
    }
    requestAnimationFrame(canvasLoop);
}

// --- Chart.jsによる予測グラフ描画 ---
function renderForecastChart() {
    const ctx = document.getElementById('forecast-chart').getContext('2d');
    const timeline = appState.forecastTimeline;
    if (timeline.length === 0) return;

    // グラフ表示用の1分単位ラベル（0分〜180分、15分おきに表示など）
    const labels = timeline.map(d => {
        const timeStr = d.time.toTimeString().split(' ')[0].substring(0, 5);
        return d.minuteOffset % 20 === 0 ? `${timeStr} (${d.minuteOffset}分)` : '';
    });

    // 選択されたタブに応じたデータセットの設定
    let datasets = [];
    let yAxesConfig = {};

    // グラフ全体のカラー設定
    const neonBlue = '#00f0ff';
    const neonAmber = '#ffaa00';
    const neonGreen = '#39ff14';
    const neonRed = '#ff3366';
    const softWhite = 'rgba(255, 255, 255, 0.7)';

    if (appState.currentGraphTab === 'temp') {
        datasets = [
            {
                label: '空気気温 (°C)',
                data: timeline.map(d => d.temp),
                borderColor: neonAmber,
                backgroundColor: 'rgba(255, 170, 0, 0.05)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            },
            {
                label: '滑走路表面温度 (°C)',
                data: timeline.map(d => d.runwayTemp),
                borderColor: neonRed,
                backgroundColor: 'rgba(255, 51, 102, 0.03)',
                borderWidth: 1.5,
                borderDash: [5, 5],
                fill: false,
                tension: 0.4,
                pointRadius: 0
            },
            {
                label: '相対湿度 (%)',
                data: timeline.map(d => d.humidity),
                borderColor: neonBlue,
                borderWidth: 1.5,
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                yAxisID: 'y1'
            }
        ];

        yAxesConfig = {
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: softWhite },
                title: { display: true, text: '温度 (°C)', color: softWhite }
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: { color: softWhite },
                title: { display: true, text: '湿度 (%)', color: softWhite },
                min: 0,
                max: 100
            }
        };
    } else if (appState.currentGraphTab === 'wind') {
        datasets = [
            {
                label: '平均風速 (m/s)',
                data: timeline.map(d => d.windSpeed),
                borderColor: neonBlue,
                backgroundColor: 'rgba(0, 240, 255, 0.05)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.3,
                pointRadius: 0
            },
            {
                label: '瞬間最大風速 (m/s)',
                data: timeline.map(d => d.windGust),
                borderColor: neonAmber,
                borderWidth: 1.5,
                fill: false,
                tension: 0.3,
                pointRadius: 0
            },
            {
                label: '横風成分 (m/s)',
                data: timeline.map(d => {
                    const rwyH = runwayVisualizer.activeRunway === '15' ? 150 : 330;
                    return Math.abs(d.windSpeed * Math.sin(((d.windDir - rwyH) * Math.PI) / 180));
                }),
                borderColor: neonRed,
                borderWidth: 1.5,
                borderDash: [3, 3],
                fill: false,
                tension: 0.3,
                pointRadius: 0
            }
        ];

        yAxesConfig = {
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: softWhite },
                title: { display: true, text: '風速 (m/s)', color: softWhite },
                min: 0
            }
        };
    } else if (appState.currentGraphTab === 'precip') {
        datasets = [
            {
                label: '降水量 (mm/分)',
                data: timeline.map(d => d.precip),
                borderColor: '#00aaff',
                backgroundColor: 'rgba(0, 170, 255, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: 0
            },
            {
                label: '滑走路視程 (RVR) (m)',
                data: timeline.map(d => d.rvr),
                borderColor: neonGreen,
                borderWidth: 1.5,
                fill: false,
                tension: 0.2,
                pointRadius: 0,
                yAxisID: 'y1'
            }
        ];

        yAxesConfig = {
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: softWhite },
                title: { display: true, text: '降水量 (mm/分)', color: softWhite },
                min: 0
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: { color: softWhite },
                title: { display: true, text: '滑走路視程 (m)', color: softWhite },
                min: 0,
                max: 12000
            }
        };
    } else if (appState.currentGraphTab === 'drone') {
        datasets = [
            {
                label: '安全フライト指数 (0-100)',
                data: timeline.map(d => d.droneScore),
                borderColor: neonGreen,
                backgroundColor: 'rgba(57, 255, 20, 0.05)',
                borderWidth: 2.5,
                fill: true,
                tension: 0.3,
                pointRadius: 0
            },
            {
                label: 'サーマル上昇気流 (m/s)',
                data: timeline.map(d => d.thermalUpdraft),
                borderColor: neonAmber,
                borderWidth: 1.5,
                fill: false,
                tension: 0.3,
                pointRadius: 0,
                yAxisID: 'y1'
            }
        ];

        yAxesConfig = {
            y: {
                type: 'linear',
                display: true,
                position: 'left',
                grid: { color: 'rgba(255, 255, 255, 0.05)' },
                ticks: { color: softWhite },
                title: { display: true, text: 'フライト指数 (Score)', color: softWhite },
                min: 0,
                max: 100
            },
            y1: {
                type: 'linear',
                display: true,
                position: 'right',
                grid: { drawOnChartArea: false },
                ticks: { color: softWhite },
                title: { display: true, text: '上昇気流速度 (m/s)', color: softWhite },
                min: 0,
                max: 5
            }
        };
    }

    // 既にグラフがある場合は破壊して再構築
    if (forecastChart) {
        forecastChart.destroy();
    }

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    labels: {
                        color: softWhite,
                        font: { family: 'var(--font-primary)', size: 10 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 20, 40, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#ddd',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    titleFont: { family: 'var(--font-heading)' },
                    bodyFont: { family: 'var(--font-primary)' },
                    callbacks: {
                        title: function(context) {
                            const offset = context[0].dataIndex;
                            const target = timeline[offset];
                            return `${formatDate(target.time).substring(11, 16)} (${offset}分先)`;
                        }
                    }
                }
            },
            scales: yAxesConfig
        }
    });
}
