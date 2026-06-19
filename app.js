/* ==========================================================================
   SOLARIS ATMOS — メインアプリケーション制御
   天気 + ソーラー + 走行戦略 統合エンジン
   ========================================================================== */

// ===== 都市定義 =====
const CITIES = {
    shirahama: {
        name: '白浜',
        nameEn: 'SHIRAHAMA',
        lat: 33.6622,
        lon: 135.3621,
        elevation: 90,
        runway: { heading: 150, name: '15/33' },
        geoText: '北緯33.6622° 東経135.3621° / 標高90m',
        label: '白浜 — 旧南紀白浜空港 局所気象'
    },
    kobe: {
        name: '神戸',
        nameEn: 'KOBE',
        lat: 34.6304,
        lon: 135.2260,
        elevation: 5,
        runway: { heading: 90, name: '09/27' },
        geoText: '北緯34.6304° 東経135.2260° / 標高5m',
        label: '神戸 — 神戸空港 周辺気象'
    }
};

const FORECAST_MINUTES = 180;

// ===== ソーラーカー設定デフォルト =====
const DEFAULT_CONFIG = {
    panelArea: 4.0,       // m²
    panelEfficiency: 0.24, // 24%
    cd: 0.11,             // 空気抵抗係数
    frontalArea: 1.2,     // m²
    weight: 250,          // kg
    crr: 0.006,           // 転がり抵抗係数
    targetSpeed: 80       // km/h
};

// ===== グローバル状態管理 =====
let appState = {
    currentCity: 'shirahama',
    currentTime: new Date(),
    cities: {
        shirahama: { baselineData: null, forecastTimeline: [], solarData: null },
        kobe: { baselineData: null, forecastTimeline: [], solarData: null }
    },
    selectedOffset: 0,
    currentGraphTab: 'solar',
    autoUpdateInterval: null,
    modelUpdatedTime: null,
    config: { ...DEFAULT_CONFIG }
};

let runwayVisualizer = null;
let forecastChart = null;
let solarHarvestChart = null;

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    initNavScroll();
    initScrollReveal();
    initRunwayVisualizer();
    initAppClock();
    initEventListeners();
    initSunPathCanvas();

    // 初回データロード（両都市）
    fetchAllCities();

    // 1分ごとの自動更新
    appState.autoUpdateInterval = setInterval(() => {
        appState.currentTime = new Date();
        updateClockDisplay();
        fetchAllCities();
    }, 60000);

    // Gemini AI自動サマリー（1時間ごと）
    setTimeout(() => {
        if (window.geminiAI && window.geminiAI.hasApiKey()) {
            generateAISummaries();
            setInterval(generateAISummaries, 3600000);
        }
    }, 3000);
});

// ===== ナビゲーション =====
function initNavScroll() {
    const nav = document.getElementById('nav-bar');
    window.addEventListener('scroll', () => {
        nav.classList.toggle('scrolled', window.scrollY > 50);
    });
}

function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Update active nav
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[data-section="${id.replace('-section', '')}"]`);
    if (activeLink) activeLink.classList.add('active');
}

// ===== Intersection Observer for scroll-reveal =====
function initScrollReveal() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
}

// ===== 都市切り替え =====
function switchCity(cityId) {
    appState.currentCity = cityId;
    const city = CITIES[cityId];

    // タブUI更新
    document.querySelectorAll('.city-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.city-tab[data-city="${cityId}"]`).classList.add('active');

    // ステータスバー更新
    document.getElementById('geo-info-text').textContent = city.geoText;
    document.getElementById('weather-city-label').textContent = city.label;
    document.getElementById('runway-title').textContent = `滑走路 ${city.runway.name} 風況`;

    // 滑走路ビジュアライザーの再初期化
    initRunwayVisualizer();

    // 表示更新
    const data = appState.cities[cityId];
    if (data.forecastTimeline.length > 0) {
        updateDashboard(appState.selectedOffset);
        renderForecastChart();
        updateSolarDashboard(appState.selectedOffset);
        renderSolarHarvestChart();
        updateSunPathCanvas();
    }
}

// ===== 滑走路ビジュアライザー =====
function initRunwayVisualizer() {
    const city = CITIES[appState.currentCity];
    if (typeof RunwayVisualizer !== 'undefined') {
        runwayVisualizer = new RunwayVisualizer('runway-canvas', {
            heading: city.runway.heading,
            name: city.runway.name,
            label: city.nameEn
        });
    }
}

// ===== 時計 =====
function initAppClock() {
    updateClockDisplay();
    setInterval(() => {
        if (appState.selectedOffset === 0) {
            document.getElementById('current-time-display').textContent = formatDate(new Date());
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

// ===== データ取得 =====
async function fetchAllCities() {
    for (const cityId of Object.keys(CITIES)) {
        await fetchWeatherAndSimulate(cityId);
    }
    // 表示更新（アクティブな都市のみ）
    updateDashboard(appState.selectedOffset);
    renderForecastChart();
    updateSolarDashboard(appState.selectedOffset);
    renderSolarHarvestChart();
    updateSunPathCanvas();
    updateHeroValue();
}

async function fetchWeatherAndSimulate(cityId) {
    const city = CITIES[cityId];
    const refreshIcon = document.getElementById('refresh-icon');
    if (refreshIcon && cityId === appState.currentCity) refreshIcon.classList.add('animate-spin');

    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}`
            + `&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m`
            + `&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,shortwave_radiation,direct_radiation,diffuse_radiation,direct_normal_irradiance,cloud_cover`
            + `&timezone=Asia%2FTokyo`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('API取得失敗');
        const data = await response.json();

        appState.cities[cityId].baselineData = processApiData(data);
        appState.cities[cityId].solarData = processSolarData(data);
        appState.modelUpdatedTime = new Date();

        if (document.getElementById('val-model-updated-time')) {
            document.getElementById('val-model-updated-time').textContent = appState.modelUpdatedTime.toTimeString().split(' ')[0];
        }

        document.getElementById('solar-status-text').textContent = `日射データ取得済 (${CITIES[cityId].name})`;

    } catch (error) {
        console.warn(`${city.name} 天気API接続エラー:`, error);
        appState.cities[cityId].baselineData = generateMockBaseline(cityId);
        appState.cities[cityId].solarData = generateMockSolarData();
        document.getElementById('solar-status-text').textContent = 'ローカルシミュレーション中';
    }

    generateMinuteResolutionForecast(cityId);

    if (refreshIcon && cityId === appState.currentCity) {
        setTimeout(() => refreshIcon.classList.remove('animate-spin'), 600);
    }
}

// ===== APIデータ整形 =====
function processApiData(apiData) {
    const hourly = apiData.hourly;
    const nowEpoch = appState.currentTime.getTime();
    let hourlyPoints = [];

    for (let i = 0; i < hourly.time.length; i++) {
        const pointTime = new Date(hourly.time[i]).getTime();
        if (pointTime >= nowEpoch - 3600000 && pointTime <= nowEpoch + 14400000) {
            hourlyPoints.push({
                time: pointTime,
                temp: hourly.temperature_2m[i],
                humidity: hourly.relative_humidity_2m[i],
                windSpeed: hourly.wind_speed_10m[i] / 3.6,
                windDir: hourly.wind_direction_10m[i],
                windGust: hourly.wind_gusts_10m[i] / 3.6,
                precip: hourly.precipitation[i] / 60,
                cloudCover: hourly.cloud_cover ? hourly.cloud_cover[i] : 50
            });
        }
    }

    if (hourlyPoints.length === 0) return generateMockBaseline('shirahama');

    return {
        current: {
            temp: apiData.current.temperature_2m,
            humidity: apiData.current.relative_humidity_2m,
            windSpeed: apiData.current.wind_speed_10m / 3.6,
            windDir: apiData.current.wind_direction_10m,
            windGust: apiData.current.wind_gusts_10m / 3.6,
            precip: apiData.current.precipitation / 60,
            pressure: apiData.current.pressure_msl,
            weatherCode: apiData.current.weather_code
        },
        hourly: hourlyPoints
    };
}

function processSolarData(apiData) {
    const hourly = apiData.hourly;
    const nowEpoch = appState.currentTime.getTime();
    let solarPoints = [];

    for (let i = 0; i < hourly.time.length; i++) {
        const pointTime = new Date(hourly.time[i]).getTime();
        if (pointTime >= nowEpoch - 3600000 && pointTime <= nowEpoch + 14400000) {
            solarPoints.push({
                time: pointTime,
                ghi: hourly.shortwave_radiation ? hourly.shortwave_radiation[i] : 0,
                dni: hourly.direct_normal_irradiance ? hourly.direct_normal_irradiance[i] : 0,
                dhi: hourly.diffuse_radiation ? hourly.diffuse_radiation[i] : 0,
                directRad: hourly.direct_radiation ? hourly.direct_radiation[i] : 0,
                cloudCover: hourly.cloud_cover ? hourly.cloud_cover[i] : 50
            });
        }
    }

    return solarPoints;
}

// ===== モックデータ =====
function generateMockBaseline(cityId) {
    const hours = appState.currentTime.getHours();
    const isDay = hours >= 6 && hours <= 18;
    const baseTemp = isDay ? 22 + Math.sin((hours - 12) * Math.PI / 12) * 5 : 16;
    const baseHumidity = isDay ? 60 : 85;
    const baseWindDir = isDay ? 225 : 45;
    const baseWindSpeed = isDay ? 4.5 : 1.8;

    const current = {
        temp: baseTemp, humidity: baseHumidity, windSpeed: baseWindSpeed,
        windDir: baseWindDir, windGust: baseWindSpeed * 1.4, precip: 0.0,
        pressure: 1013.2, weatherCode: 0
    };

    let hourly = [];
    const nowEpoch = appState.currentTime.getTime();
    for (let i = -1; i <= 4; i++) {
        const h = (hours + i + 24) % 24;
        const d = h >= 6 && h <= 18;
        hourly.push({
            time: nowEpoch + i * 3600000,
            temp: d ? 22 + Math.sin((h - 12) * Math.PI / 12) * 5 : 16,
            humidity: d ? 60 : 85,
            windSpeed: d ? 4.5 : 1.8,
            windDir: d ? 225 : 45,
            windGust: (d ? 4.5 : 1.8) * 1.4,
            precip: 0.0,
            cloudCover: d ? 20 : 80
        });
    }

    return { current, hourly };
}

function generateMockSolarData() {
    const nowEpoch = appState.currentTime.getTime();
    const hours = appState.currentTime.getHours();
    let points = [];

    for (let i = -1; i <= 4; i++) {
        const h = (hours + i + 24) % 24;
        const solarFactor = Math.max(0, Math.sin((h - 6) * Math.PI / 12));
        points.push({
            time: nowEpoch + i * 3600000,
            ghi: solarFactor * 800,
            dni: solarFactor * 600,
            dhi: solarFactor * 200,
            directRad: solarFactor * 500,
            cloudCover: 20
        });
    }

    return points;
}

// ===== 1分解像度シミュレーション =====
function generateMinuteResolutionForecast(cityId) {
    const cityState = appState.cities[cityId];
    cityState.forecastTimeline = [];
    const startMs = appState.currentTime.getTime();
    const base = cityState.baselineData;
    const solarBase = cityState.solarData;
    const city = CITIES[cityId];

    for (let m = 0; m <= FORECAST_MINUTES; m++) {
        const targetMs = startMs + m * 60000;
        const targetDate = new Date(targetMs);
        const hourFloat = targetDate.getHours() + targetDate.getMinutes() / 60;

        // 気象補間
        const interpolated = interpolateHourly(targetMs, base.hourly);
        const solarInterp = solarBase ? interpolateSolar(targetMs, solarBase) : { ghi: 0, dni: 0, dhi: 0, cloudCover: 50 };

        // カオスノイズ
        const noise1 = Math.sin(targetMs * 0.0001) * 0.5;
        const noise2 = Math.sin(targetMs * 0.0005 + 1.2) * 0.25;
        const noise3 = Math.sin(targetMs * 0.002 + 0.5) * 0.1;
        const microNoise = noise1 + noise2 + noise3;

        // 気温
        let localTemp = interpolated.temp - (city.elevation * 0.0065) + (microNoise * 0.35);

        // 風
        let localWindDir = interpolated.windDir;
        let localWindSpeed = interpolated.windSpeed;
        const isDayTime = hourFloat >= 10 && hourFloat <= 17;
        const isTransition = (hourFloat >= 8 && hourFloat < 10) || (hourFloat > 17 && hourFloat <= 19);

        if (isDayTime) {
            localWindDir = blendAngles(localWindDir, 235, 0.6);
            localWindSpeed = localWindSpeed * 1.25 + Math.max(0, microNoise * 0.8);
        } else if (!isTransition) {
            localWindDir = blendAngles(localWindDir, 55, 0.5);
            localWindSpeed = Math.max(0.8, localWindSpeed * 0.85 + microNoise * 0.3);
        }

        const gustFactor = 1.35 + (Math.sin(targetMs * 0.001) * 0.15);
        let localGust = localWindSpeed * gustFactor;

        // 日射量（ノイズ付き）
        let localGHI = Math.max(0, solarInterp.ghi + microNoise * 15);
        let localDNI = Math.max(0, solarInterp.dni + microNoise * 10);
        let localDHI = Math.max(0, solarInterp.dhi + microNoise * 8);
        let localCloudCover = Math.min(100, Math.max(0, solarInterp.cloudCover + microNoise * 5));

        // ===== ソーラーパネル発電計算 =====
        const cfg = appState.config;
        const cellTemp = localTemp + (localGHI / 800) * 25;
        const tempCorrection = Math.max(0.5, 1 - 0.004 * Math.max(0, cellTemp - 25));
        const panelOutput = localGHI * cfg.panelArea * cfg.panelEfficiency * tempCorrection;

        // ===== 走行エネルギー計算 =====
        const airTempK = localTemp + 273.15;
        const pressurePa = (interpolated.pressure || 1013.2) * 100;
        const airDensity = pressurePa / (287.05 * airTempK);

        // 向かい風/追い風成分（走行方向を南北道路=180度と仮定）
        const travelHeading = 180; // 基本走行方向
        const windAngleRad = ((localWindDir - travelHeading) * Math.PI) / 180;
        const headwindComponent = localWindSpeed * Math.cos(windAngleRad);
        const crosswindComponent = localWindSpeed * Math.sin(windAngleRad);

        const targetSpeedMs = cfg.targetSpeed / 3.6;
        const effectiveSpeed = targetSpeedMs + headwindComponent;

        const aeroDrag = 0.5 * airDensity * cfg.cd * cfg.frontalArea * effectiveSpeed * effectiveSpeed;
        const rollingResistance = cfg.crr * cfg.weight * 9.81;
        const totalResistanceForce = aeroDrag + rollingResistance + Math.abs(crosswindComponent) * 0.5;
        const consumptionWatts = totalResistanceForce * targetSpeedMs;

        const energyBalance = panelOutput - consumptionWatts;

        // 最適速度計算（収支ゼロ速度）
        let optimalSpeed = 0;
        if (panelOutput > 0) {
            // 二分探索で収支=0となる速度を求める
            let lo = 0, hi = 150 / 3.6;
            for (let iter = 0; iter < 30; iter++) {
                const mid = (lo + hi) / 2;
                const eff = mid + headwindComponent;
                const drag = 0.5 * airDensity * cfg.cd * cfg.frontalArea * eff * eff;
                const roll = cfg.crr * cfg.weight * 9.81;
                const consumption = (drag + roll) * mid;
                if (consumption < panelOutput) lo = mid;
                else hi = mid;
            }
            optimalSpeed = Math.round(lo * 3.6);
        }

        // 滑走路温度
        const isSunny = localGHI > 50;
        let runwayTemp = localTemp;
        let thermalUpdraft = 0, thermalHeight = 0;

        if (isSunny && hourFloat >= 9 && hourFloat <= 16) {
            const solarIntensity = Math.sin((hourFloat - 7) * Math.PI / 10);
            runwayTemp += solarIntensity * 7.5;
            thermalUpdraft = Math.max(0, solarIntensity * 2.8 + microNoise * 0.4);
            thermalHeight = Math.round(solarIntensity * 400 + microNoise * 50 + 100);
        }

        // 降水
        let localPrecip = interpolated.precip;
        if (localPrecip > 0.001) {
            localPrecip *= Math.max(0, 1 + Math.sin(targetMs * 0.003) * 0.7);
        }

        // 湿度
        let localHumidity = Math.min(100, Math.max(10, interpolated.humidity + microNoise * 4));

        // 視程
        let localRVR = 12000;
        if (localPrecip > 0) {
            localRVR = Math.max(600, 12000 - localPrecip * 9600);
        } else if (localHumidity > 92) {
            localRVR = Math.round(12000 - ((localHumidity - 92) / 8) * 10500);
        }
        localRVR = Math.round(localRVR + microNoise * 200);

        // 路面状態
        let surfaceCond = "DRY";
        if (localPrecip > 0.08) surfaceCond = "FLOODED";
        else if (localPrecip > 0.01) surfaceCond = "WET";
        else if (localPrecip > 0 || localHumidity > 95) surfaceCond = "DAMP";

        // 乱気流
        let turbulenceScore = (localWindSpeed * 0.4) + (thermalUpdraft * 0.8) + (localGust - localWindSpeed) * 0.5;
        let turbulenceLevel = turbulenceScore > 6 ? "SEVERE" : turbulenceScore > 3 ? "MODERATE" : "LOW";

        // ドローンスコア
        let droneScore = 100;
        droneScore -= Math.min(60, localWindSpeed * 6);
        droneScore -= Math.min(20, (localGust - localWindSpeed) * 3);
        if (localPrecip > 0) droneScore -= Math.min(50, localPrecip * 2000);
        if (turbulenceLevel === "SEVERE") droneScore -= 30;
        else if (turbulenceLevel === "MODERATE") droneScore -= 15;
        if (localRVR < 1500) droneScore -= 25;
        droneScore = Math.max(0, Math.round(droneScore));
        let droneStatus = droneScore < 45 ? "DANGER" : droneScore < 75 ? "CAUTION" : "SAFE";

        // 露点
        const a = 17.27, b = 237.7;
        const alpha = ((a * localTemp) / (b + localTemp)) + Math.log(localHumidity / 100.0);
        const dewPoint = (b * alpha) / (a - alpha);

        // タイヤリスク
        let tireRisk = "良好";
        if (runwayTemp > 55) tireRisk = "⚠️ 高温注意 (グリップ低下)";
        else if (runwayTemp > 45) tireRisk = "注意 (やや高温)";
        else if (runwayTemp < 10) tireRisk = "⚠️ 低温注意 (硬化)";

        cityState.forecastTimeline.push({
            minuteOffset: m,
            time: targetDate,
            temp: localTemp,
            runwayTemp, humidity: localHumidity, dewPoint,
            windSpeed: localWindSpeed, windDir: localWindDir, windGust: localGust,
            precip: localPrecip, pressure: (interpolated.pressure || 1013.2) + microNoise * 0.15,
            rvr: localRVR, surfaceCond,
            thermalUpdraft, thermalHeight, turbulenceLevel,
            droneScore, droneStatus,
            breezeType: isDayTime ? "海風" : (!isTransition ? "陸風" : "穏やか"),
            // ソーラーデータ
            ghi: localGHI, dni: localDNI, dhi: localDHI, cloudCover: localCloudCover,
            cellTemp, tempCorrection, panelOutput,
            // 走行戦略データ
            airDensity, headwindComponent, crosswindComponent,
            consumptionWatts, energyBalance, optimalSpeed,
            tireRisk
        });
    }
}

// ===== 補間関数 =====
function interpolateHourly(targetMs, hourlyPoints) {
    if (!hourlyPoints || hourlyPoints.length === 0) {
        return { temp: 20, humidity: 60, windSpeed: 3, windDir: 180, windGust: 4, precip: 0, pressure: 1013.2, cloudCover: 30 };
    }
    let prev = hourlyPoints[0], next = hourlyPoints[hourlyPoints.length - 1];
    if (targetMs <= prev.time) return prev;
    if (targetMs >= next.time) return next;
    for (let i = 0; i < hourlyPoints.length - 1; i++) {
        if (targetMs >= hourlyPoints[i].time && targetMs <= hourlyPoints[i + 1].time) {
            prev = hourlyPoints[i]; next = hourlyPoints[i + 1]; break;
        }
    }
    const f = (targetMs - prev.time) / (next.time - prev.time);
    return {
        temp: prev.temp + (next.temp - prev.temp) * f,
        humidity: prev.humidity + (next.humidity - prev.humidity) * f,
        windSpeed: prev.windSpeed + (next.windSpeed - prev.windSpeed) * f,
        windDir: interpolateAngles(prev.windDir, next.windDir, f),
        windGust: prev.windGust + (next.windGust - prev.windGust) * f,
        precip: prev.precip + (next.precip - prev.precip) * f,
        pressure: 1013.2,
        cloudCover: (prev.cloudCover || 30) + ((next.cloudCover || 30) - (prev.cloudCover || 30)) * f
    };
}

function interpolateSolar(targetMs, solarPoints) {
    if (!solarPoints || solarPoints.length === 0) return { ghi: 0, dni: 0, dhi: 0, cloudCover: 50 };
    let prev = solarPoints[0], next = solarPoints[solarPoints.length - 1];
    if (targetMs <= prev.time) return prev;
    if (targetMs >= next.time) return next;
    for (let i = 0; i < solarPoints.length - 1; i++) {
        if (targetMs >= solarPoints[i].time && targetMs <= solarPoints[i + 1].time) {
            prev = solarPoints[i]; next = solarPoints[i + 1]; break;
        }
    }
    const f = (targetMs - prev.time) / (next.time - prev.time);
    return {
        ghi: prev.ghi + (next.ghi - prev.ghi) * f,
        dni: prev.dni + (next.dni - prev.dni) * f,
        dhi: prev.dhi + (next.dhi - prev.dhi) * f,
        cloudCover: prev.cloudCover + (next.cloudCover - prev.cloudCover) * f
    };
}

function interpolateAngles(a, b, f) {
    let diff = b - a;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return (a + diff * f + 360) % 360;
}

function blendAngles(current, target, factor) {
    let diff = target - current;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return (current + diff * factor + 360) % 360;
}

// ===== ヒーロー値更新 =====
function updateHeroValue() {
    const data = appState.cities[appState.currentCity].forecastTimeline[appState.selectedOffset];
    if (!data) return;
    const el = document.getElementById('hero-power-value');
    const watts = Math.round(data.panelOutput);
    animateValue(el, watts, 'W');
}

function animateValue(el, targetVal, unit) {
    el.innerHTML = `${targetVal}<span style="font-size:0.3em; font-weight:400; opacity:0.6;">${unit}</span>`;
}

// ===== ダッシュボード更新 =====
function updateDashboard(offset) {
    const data = appState.cities[appState.currentCity].forecastTimeline[offset];
    if (!data) return;

    document.getElementById('val-temp').textContent = data.temp.toFixed(1);
    document.getElementById('val-humidity').textContent = Math.round(data.humidity);
    document.getElementById('val-dewpoint').textContent = data.dewPoint.toFixed(1);
    document.getElementById('val-windspeed').textContent = data.windSpeed.toFixed(1);
    document.getElementById('val-windgust').textContent = data.windGust.toFixed(1);

    const dirText = getWindDirectionText(data.windDir);
    document.getElementById('val-winddir-text').textContent = `${dirText} (${Math.round(data.windDir)}°)`;

    document.getElementById('val-precip').textContent = data.precip.toFixed(2);
    document.getElementById('val-pressure').textContent = Math.round(data.pressure);
    document.getElementById('val-rvr').textContent = data.rvr;

    // フライト安全指数
    const safetyText = document.getElementById('val-drone-status');
    const safetyBadge = document.getElementById('val-drone-status-badge');
    safetyText.textContent = `${data.droneStatus} (Score: ${data.droneScore})`;
    safetyBadge.className = `drone-safety-badge ${data.droneStatus.toLowerCase()}`;

    document.getElementById('val-thermal').textContent = data.thermalUpdraft.toFixed(1);
    document.getElementById('val-turbulence').textContent = data.turbulenceLevel;

    // 滑走路ビジュアライザー
    if (runwayVisualizer) runwayVisualizer.updateWind(data.windSpeed, data.windDir, data.windGust);

    // 滑走路データ
    document.getElementById('val-surface-condition').textContent = data.surfaceCond;
    const sCondEl = document.getElementById('val-surface-condition');
    sCondEl.className = data.surfaceCond === 'DRY' ? 'badge safe' : 'badge wet';

    const city = CITIES[appState.currentCity];
    const rwyHeading = runwayVisualizer ? (runwayVisualizer.activeRunway === city.runway.name.split('/')[0] ? city.runway.heading : (city.runway.heading + 180) % 360) : city.runway.heading;
    const radDiff = ((data.windDir - rwyHeading) * Math.PI) / 180;
    const headwindVal = data.windSpeed * Math.cos(radDiff);
    const crosswindVal = data.windSpeed * Math.sin(radDiff);

    document.getElementById('val-headwind').textContent = Math.abs(headwindVal).toFixed(1);
    document.getElementById('val-crosswind').textContent = Math.abs(crosswindVal).toFixed(1);
    document.getElementById('val-headwind-dir').textContent = headwindVal >= 0 ? "(向かい風)" : "(追い風)";
    document.getElementById('val-crosswind-side').textContent = crosswindVal >= 0 ? "(右側)" : "(左側)";
    document.getElementById('val-runway-temp').textContent = data.runwayTemp.toFixed(1) + " °C";
    document.getElementById('val-breeze-type').textContent = data.breezeType + "循環";
    document.getElementById('val-thermal-height').textContent = data.thermalHeight + " m";

    let gustRisk = "低";
    if (data.windGust > 12) gustRisk = "高 (強風突風)";
    else if (data.windGust > 7) gustRisk = "中 (突風注意)";
    document.getElementById('val-gust-risk').textContent = gustRisk;

    // 診断
    updateDiagnostics(data, crosswindVal);

    // キャンバス天候
    let canvasMode = 'clear';
    if (data.precip > 0.01) canvasMode = 'rain';
    else if (data.windSpeed > 6.0) canvasMode = 'windy';
    else if (data.humidity > 80) canvasMode = 'cloudy';

    if (window.weatherCanvas) {
        window.weatherCanvas.setWeather(canvasMode, data.windSpeed, data.precip, data.windDir);
        const solarIntensity = Math.min(1, data.ghi / 800);
        if (window.weatherCanvas.setSolarIntensity) {
            window.weatherCanvas.setSolarIntensity(solarIntensity);
        }
    }
}

// ===== ソーラーダッシュボード更新 =====
function updateSolarDashboard(offset) {
    const data = appState.cities[appState.currentCity].forecastTimeline[offset];
    if (!data) return;

    document.getElementById('val-ghi').textContent = Math.round(data.ghi);
    document.getElementById('val-dni').textContent = Math.round(data.dni);
    document.getElementById('val-dhi').textContent = Math.round(data.dhi);
    document.getElementById('val-cloud-cover').textContent = Math.round(data.cloudCover);

    document.getElementById('val-cell-temp').textContent = data.cellTemp.toFixed(1);
    document.getElementById('val-temp-correction').textContent = (data.tempCorrection * 100).toFixed(1) + '%';
    document.getElementById('hero-panel-watts').textContent = Math.round(data.panelOutput);

    // 効率ゲージ
    const maxOutput = appState.config.panelArea * 1000 * appState.config.panelEfficiency;
    const efficiencyPercent = maxOutput > 0 ? Math.min(100, (data.panelOutput / maxOutput) * 100) : 0;
    document.getElementById('gauge-efficiency').textContent = Math.round(efficiencyPercent) + '%';

    const circumference = 534;
    const gaugeOffset = circumference - (circumference * efficiencyPercent / 100);
    document.getElementById('solar-gauge-fill').style.strokeDashoffset = gaugeOffset;

    // 累積Wh
    const timeline = appState.cities[appState.currentCity].forecastTimeline;
    let cumulativeWh = 0;
    for (let i = 0; i <= offset && i < timeline.length; i++) {
        cumulativeWh += timeline[i].panelOutput / 60; // W → Wh (1分あたり)
    }
    document.getElementById('val-cumulative-wh').textContent = Math.round(cumulativeWh);

    // 走行戦略
    updateStrategyPanel(data);

    // ヒーロー値
    updateHeroValue();
}

function updateStrategyPanel(data) {
    // 最適速度ゲージ
    document.getElementById('val-optimal-speed').textContent = data.optimalSpeed;
    const speedPercent = Math.min(100, (data.optimalSpeed / 130) * 100);
    const speedOffset = 534 - (534 * speedPercent / 100);
    document.getElementById('speed-gauge-fill').style.strokeDashoffset = speedOffset;

    // エネルギー収支
    const maxWatts = Math.max(data.panelOutput, data.consumptionWatts, 1);
    const inputPercent = (data.panelOutput / maxWatts) * 100;
    const consumePercent = (data.consumptionWatts / maxWatts) * 100;

    document.getElementById('balance-input-fill').style.width = Math.min(100, inputPercent) + '%';
    document.getElementById('val-energy-input').textContent = Math.round(data.panelOutput) + ' W';
    document.getElementById('val-energy-input').className = 'balance-label positive';

    document.getElementById('balance-consume-fill').style.width = Math.min(100, consumePercent) + '%';
    document.getElementById('val-energy-consume').textContent = Math.round(data.consumptionWatts) + ' W';

    const netFill = document.getElementById('balance-net-fill');
    const netLabel = document.getElementById('val-energy-net');
    const netVal = Math.round(data.energyBalance);
    if (netVal >= 0) {
        netFill.className = 'balance-fill positive';
        netFill.style.width = Math.min(100, (netVal / maxWatts) * 100) + '%';
        netLabel.textContent = '+' + netVal + ' W';
        netLabel.className = 'balance-label positive';
    } else {
        netFill.className = 'balance-fill negative';
        netFill.style.width = Math.min(100, (Math.abs(netVal) / maxWatts) * 100) + '%';
        netLabel.textContent = netVal + ' W';
        netLabel.className = 'balance-label negative';
    }

    // 風エネルギーコスト
    const headW = Math.round(Math.abs(data.headwindComponent) * data.airDensity * 10);
    const crossW = Math.round(Math.abs(data.crosswindComponent) * 5);
    document.getElementById('val-wind-energy-headtail').textContent =
        (data.headwindComponent >= 0 ? `+${headW} W (追加消費)` : `-${headW} W (節約)`);
    document.getElementById('val-wind-energy-cross').textContent = `+${crossW} W`;
    document.getElementById('val-air-density').textContent = data.airDensity.toFixed(4) + ' kg/m³';

    // 路面
    document.getElementById('val-road-temp').textContent = data.runwayTemp.toFixed(1) + ' °C';
    document.getElementById('val-road-condition').textContent = data.surfaceCond;
    document.getElementById('val-tire-risk').textContent = data.tireRisk;
}

// ===== 診断 =====
function updateDiagnostics(data, crosswindVal) {
    const diagBox = document.getElementById('diag-alert-icon-box');
    const diagTitle = document.getElementById('diag-title');
    const diagDesc = document.getElementById('diag-desc');
    const diagIcon = document.getElementById('diag-alert-icon');

    let level = 'safe', title = "気象良好 — ソーラー発電に最適", desc = "局所的な気象じょう乱は検出されていません。発電効率は安定しています。";

    if (data.precip > 0.08) {
        level = 'danger'; title = "降雨警報 — 発電効率大幅低下";
        desc = `局所的な降雨により日射量が低下。パネル出力が ${Math.round(data.panelOutput)}W まで減少しています。`;
    } else if (data.windSpeed > 8.0) {
        level = 'danger'; title = "強風警報 — 走行安全性に注意";
        desc = `風速 ${data.windSpeed.toFixed(1)}m/s の強風。横風 ${Math.abs(crosswindVal).toFixed(1)}m/s により車両安定性が低下する可能性があります。`;
    } else if (data.cloudCover > 80) {
        level = 'caution'; title = "曇天 — 発電効率低下";
        desc = `雲量 ${Math.round(data.cloudCover)}% により日射量が通常の ${Math.round((1 - data.cloudCover / 100) * 100)}% に低下。GHI: ${Math.round(data.ghi)} W/m²。`;
    } else if (data.thermalUpdraft > 1.8) {
        level = 'caution'; title = "サーマル対流発生";
        desc = `路面温度 ${data.runwayTemp.toFixed(1)}°C。上昇気流 ${data.thermalUpdraft.toFixed(1)}m/s が高度 ${data.thermalHeight}m まで発達。`;
    }

    diagBox.className = `diag-icon-box level-${level}`;
    diagTitle.textContent = title;
    diagDesc.textContent = desc;
    diagIcon.setAttribute('data-lucide', level === 'safe' ? 'info' : level === 'caution' ? 'alert-triangle' : 'alert-circle');
    lucide.createIcons();
}

// ===== 風向テキスト =====
function getWindDirectionText(deg) {
    const dirs = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
    return dirs[Math.round(((deg % 360) / 22.5)) % 16];
}

// ===== イベントリスナー =====
function initEventListeners() {
    // 手動更新
    document.getElementById('btn-refresh').addEventListener('click', () => {
        appState.currentTime = new Date();
        updateClockDisplay();
        fetchAllCities();
    });

    // タイムラインスライダー
    const slider = document.getElementById('timeline-slider');
    slider.addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        appState.selectedOffset = val;
        const targetTime = new Date(appState.currentTime.getTime() + val * 60000);
        const timeStr = targetTime.toTimeString().split(' ')[0].substring(0, 5);
        document.getElementById('val-timeline-time').textContent = val === 0 ? `現在 (${timeStr})` : timeStr;
        document.getElementById('val-timeline-offset').textContent = `+${val}分先`;

        document.querySelectorAll('.tick').forEach(tick => {
            const tickVal = parseInt(tick.getAttribute('data-val'));
            tick.classList.toggle('active', Math.abs(tickVal - val) < 15);
        });

        updateClockDisplay();
        updateDashboard(val);
        updateSolarDashboard(val);
    });

    // ティッククリック
    document.querySelectorAll('.tick').forEach(tick => {
        tick.addEventListener('click', () => {
            slider.value = tick.getAttribute('data-val');
            slider.dispatchEvent(new Event('input'));
        });
    });

    // グラフタブ
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            appState.currentGraphTab = btn.getAttribute('data-graph');
            renderForecastChart();
        });
    });

    // 速度スライダー
    const speedSlider = document.getElementById('speed-slider');
    speedSlider.addEventListener('input', (e) => {
        const speed = parseInt(e.target.value);
        appState.config.targetSpeed = speed;
        document.getElementById('speed-slider-value').textContent = speed + ' km/h';
        // 再シミュレーション
        generateMinuteResolutionForecast(appState.currentCity);
        updateDashboard(appState.selectedOffset);
        updateSolarDashboard(appState.selectedOffset);
        if (appState.currentGraphTab === 'strategy') renderForecastChart();
    });

    // 設定パネル
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('settings-close').addEventListener('click', closeSettings);
    document.getElementById('settings-overlay').addEventListener('click', closeSettings);
    document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

    // チャットボット
    document.getElementById('chat-fab').addEventListener('click', toggleChat);
    document.getElementById('chat-close').addEventListener('click', toggleChat);
    document.getElementById('chat-send').addEventListener('click', sendChatMessage);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // 音声入力
    document.getElementById('chat-voice').addEventListener('click', toggleVoiceInput);

    // 滑走路キャンバスアニメーションループ
    function canvasLoop(timestamp) {
        if (runwayVisualizer) runwayVisualizer.draw(timestamp);
        requestAnimationFrame(canvasLoop);
    }
    requestAnimationFrame(canvasLoop);
}

// ===== 設定パネル =====
function openSettings() {
    document.getElementById('settings-panel').classList.add('open');
    document.getElementById('settings-overlay').classList.add('open');
    // 現在の設定をフォームに反映
    document.getElementById('cfg-panel-area').value = appState.config.panelArea;
    document.getElementById('cfg-panel-efficiency').value = appState.config.panelEfficiency * 100;
    document.getElementById('cfg-cd').value = appState.config.cd;
    document.getElementById('cfg-frontal-area').value = appState.config.frontalArea;
    document.getElementById('cfg-weight').value = appState.config.weight;
    document.getElementById('cfg-crr').value = appState.config.crr;
    if (window.geminiAI && window.geminiAI.hasApiKey()) {
        document.getElementById('cfg-gemini-key').value = '••••••••••••';
    }
}

function closeSettings() {
    document.getElementById('settings-panel').classList.remove('open');
    document.getElementById('settings-overlay').classList.remove('open');
}

function saveSettings() {
    appState.config.panelArea = parseFloat(document.getElementById('cfg-panel-area').value) || 4.0;
    appState.config.panelEfficiency = (parseFloat(document.getElementById('cfg-panel-efficiency').value) || 24) / 100;
    appState.config.cd = parseFloat(document.getElementById('cfg-cd').value) || 0.11;
    appState.config.frontalArea = parseFloat(document.getElementById('cfg-frontal-area').value) || 1.2;
    appState.config.weight = parseFloat(document.getElementById('cfg-weight').value) || 250;
    appState.config.crr = parseFloat(document.getElementById('cfg-crr').value) || 0.006;

    // API Key
    const keyInput = document.getElementById('cfg-gemini-key').value;
    if (keyInput && !keyInput.startsWith('••')) {
        if (window.geminiAI) window.geminiAI.setApiKey(keyInput);
    }

    localStorage.setItem('solaris-config', JSON.stringify(appState.config));
    closeSettings();

    // 再シミュレーション
    for (const cityId of Object.keys(CITIES)) {
        generateMinuteResolutionForecast(cityId);
    }
    updateDashboard(appState.selectedOffset);
    updateSolarDashboard(appState.selectedOffset);
    renderForecastChart();
    renderSolarHarvestChart();

    // APIキーが設定されたらサマリー生成
    if (window.geminiAI && window.geminiAI.hasApiKey()) {
        generateAISummaries();
    }
}

function loadConfig() {
    const saved = localStorage.getItem('solaris-config');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            appState.config = { ...DEFAULT_CONFIG, ...parsed };
        } catch (e) { console.warn('設定読み込みエラー:', e); }
    }
}

// ===== チャットボット =====
function toggleChat() {
    const panel = document.getElementById('chat-panel');
    panel.classList.toggle('open');
}

async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    // ユーザーメッセージ表示
    appendChatMsg(msg, 'user');

    if (!window.geminiAI || !window.geminiAI.hasApiKey()) {
        appendChatMsg('⚠️ Gemini APIキーが設定されていません。右上の ⚙️ 設定から入力してください。', 'ai');
        return;
    }

    // ローディング
    const loadingEl = appendChatMsg('考え中...', 'ai loading');

    // コンテキスト構築
    const data = appState.cities[appState.currentCity].forecastTimeline[appState.selectedOffset];
    const context = data ? {
        city: CITIES[appState.currentCity].name,
        temp: data.temp.toFixed(1),
        humidity: Math.round(data.humidity),
        windSpeed: data.windSpeed.toFixed(1),
        windDir: getWindDirectionText(data.windDir),
        solarGHI: Math.round(data.ghi),
        solarDNI: Math.round(data.dni),
        panelOutput: Math.round(data.panelOutput),
        optimalSpeed: data.optimalSpeed,
        energyBalance: Math.round(data.energyBalance),
        cloudCover: Math.round(data.cloudCover),
        precip: data.precip.toFixed(2)
    } : {};

    try {
        const response = await window.geminiAI.chat(msg, context);
        loadingEl.remove();
        appendChatMsg(response, 'ai');
    } catch (e) {
        loadingEl.remove();
        appendChatMsg('エラーが発生しました: ' + e.message, 'ai');
    }
}

function appendChatMsg(text, type) {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = `chat-msg ${type}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

// ===== 音声入力 =====
function toggleVoiceInput() {
    if (!window.geminiAI) return;
    const btn = document.getElementById('chat-voice');

    if (window.geminiAI.isListening && window.geminiAI.isListening()) {
        window.geminiAI.stopVoiceInput();
        btn.classList.remove('recording');
    } else {
        btn.classList.add('recording');
        window.geminiAI.startVoiceInput((transcript) => {
            document.getElementById('chat-input').value = transcript;
            btn.classList.remove('recording');
        });
    }
}

// ===== AI サマリー生成 =====
async function generateAISummaries() {
    if (!window.geminiAI || !window.geminiAI.hasApiKey()) return;

    for (const cityId of Object.keys(CITIES)) {
        const data = appState.cities[cityId].forecastTimeline[0];
        if (!data) continue;

        const weatherData = {
            city: CITIES[cityId].name,
            temp: data.temp.toFixed(1),
            humidity: Math.round(data.humidity),
            windSpeed: data.windSpeed.toFixed(1),
            windDir: getWindDirectionText(data.windDir),
            solarGHI: Math.round(data.ghi),
            panelOutput: Math.round(data.panelOutput),
            optimalSpeed: data.optimalSpeed,
            cloudCover: Math.round(data.cloudCover),
            energyBalance: Math.round(data.energyBalance)
        };

        try {
            const summary = await window.geminiAI.generateSummary(weatherData);
            document.getElementById(`ai-summary-${cityId}`).textContent = summary;
            document.getElementById(`ai-summary-${cityId}-meta`).textContent =
                `最終更新: ${new Date().toTimeString().split(' ')[0]}`;
        } catch (e) {
            console.warn(`AI Summary error for ${cityId}:`, e);
        }
    }
}

// ===== 太陽位置計算（天文学的） =====
function calcSunPosition(lat, lon, date) {
    const rad = Math.PI / 180;
    const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
    const hourUTC = date.getUTCHours() + date.getUTCMinutes() / 60;

    // 太陽赤緯（declination）
    const declination = -23.45 * Math.cos(rad * (360 / 365) * (dayOfYear + 10));

    // 時角 (hour angle)
    const B = (360 / 365) * (dayOfYear - 81);
    const EoT = 9.87 * Math.sin(2 * B * rad) - 7.53 * Math.cos(B * rad) - 1.5 * Math.sin(B * rad);
    const solarNoon = 12 - lon / 15 - EoT / 60;
    const localSolarTime = hourUTC + (lon / 15);
    const hourAngle = (localSolarTime - 12) * 15;

    // 太陽高度角 (altitude)
    const sinAlt = Math.sin(lat * rad) * Math.sin(declination * rad)
        + Math.cos(lat * rad) * Math.cos(declination * rad) * Math.cos(hourAngle * rad);
    const altitude = Math.asin(sinAlt) / rad;

    // 太陽方位角 (azimuth)
    const cosAz = (Math.sin(declination * rad) - Math.sin(lat * rad) * sinAlt)
        / (Math.cos(lat * rad) * Math.cos(Math.asin(sinAlt)));
    let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) / rad;
    if (hourAngle > 0) azimuth = 360 - azimuth;

    // 日の出・日の入（簡易計算）
    const cosHa0 = -Math.tan(lat * rad) * Math.tan(declination * rad);
    const ha0 = Math.acos(Math.max(-1, Math.min(1, cosHa0))) / rad;
    const sunriseHour = 12 - ha0 / 15 + (lon - 135) / 15 + EoT / 60; // JST補正
    const sunsetHour = 12 + ha0 / 15 + (lon - 135) / 15 + EoT / 60;

    return { altitude, azimuth, sunriseHour, sunsetHour };
}

// ===== Sun Path Canvas =====
function initSunPathCanvas() {
    const canvas = document.getElementById('sun-path-canvas');
    if (!canvas) return;
    const resize = () => {
        canvas.width = canvas.parentElement.clientWidth * (window.devicePixelRatio || 1);
        canvas.height = canvas.parentElement.clientHeight * (window.devicePixelRatio || 1);
    };
    resize();
    window.addEventListener('resize', resize);
}

function updateSunPathCanvas() {
    const canvas = document.getElementById('sun-path-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, w, h);

    const city = CITIES[appState.currentCity];
    const now = appState.currentTime;
    const sunPos = calcSunPosition(city.lat, city.lon, now);

    // 背景
    ctx.fillStyle = 'rgba(5, 8, 16, 0.8)';
    ctx.fillRect(0, 0, w, h);

    // 地平線
    const horizonY = h * 0.75;
    ctx.strokeStyle = 'rgba(255, 200, 50, 0.15)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();

    // 太陽アーク（日の出〜日の入）
    ctx.strokeStyle = 'rgba(255, 200, 50, 0.12)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    const arcPoints = 100;
    for (let i = 0; i <= arcPoints; i++) {
        const t = i / arcPoints;
        const hourFrac = sunPos.sunriseHour + (sunPos.sunsetHour - sunPos.sunriseHour) * t;
        const testDate = new Date(now);
        testDate.setHours(Math.floor(hourFrac), (hourFrac % 1) * 60, 0);
        const testSun = calcSunPosition(city.lat, city.lon, testDate);

        const x = (t) * w * 0.85 + w * 0.075;
        const y = horizonY - (Math.max(0, testSun.altitude) / 90) * horizonY * 0.85;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 現在の太陽位置
    const currentHourFrac = now.getHours() + now.getMinutes() / 60;
    if (currentHourFrac >= sunPos.sunriseHour && currentHourFrac <= sunPos.sunsetHour) {
        const t = (currentHourFrac - sunPos.sunriseHour) / (sunPos.sunsetHour - sunPos.sunriseHour);
        const sunX = t * w * 0.85 + w * 0.075;
        const sunY = horizonY - (Math.max(0, sunPos.altitude) / 90) * horizonY * 0.85;

        // グロー
        const grad = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 30 * dpr);
        grad.addColorStop(0, 'rgba(255, 200, 50, 0.5)');
        grad.addColorStop(1, 'rgba(255, 200, 50, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sunX, sunY, 30 * dpr, 0, Math.PI * 2);
        ctx.fill();

        // 太陽
        ctx.fillStyle = '#ffc832';
        ctx.beginPath();
        ctx.arc(sunX, sunY, 6 * dpr, 0, Math.PI * 2);
        ctx.fill();
    }

    // ラベル
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = `${10 * dpr}px Inter`;
    ctx.fillText('E (東)', w * 0.05, horizonY + 15 * dpr);
    ctx.fillText('W (西)', w * 0.88, horizonY + 15 * dpr);
    ctx.fillText('S (南)', w * 0.48, horizonY + 15 * dpr);

    // データ更新
    document.getElementById('val-sun-altitude').textContent = Math.max(0, sunPos.altitude).toFixed(1) + '°';
    document.getElementById('val-sun-azimuth').textContent = sunPos.azimuth.toFixed(1) + '°';

    const formatHour = (h) => {
        const hh = Math.floor(h);
        const mm = Math.round((h % 1) * 60);
        return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    document.getElementById('val-sunrise').textContent = formatHour(sunPos.sunriseHour);
    document.getElementById('val-sunset').textContent = formatHour(sunPos.sunsetHour);
}

// ===== Chart.js — メイン予測グラフ =====
function renderForecastChart() {
    const ctx = document.getElementById('forecast-chart');
    if (!ctx) return;
    const timeline = appState.cities[appState.currentCity].forecastTimeline;
    if (timeline.length === 0) return;

    const labels = timeline.map(d => {
        const timeStr = d.time.toTimeString().split(' ')[0].substring(0, 5);
        return d.minuteOffset % 20 === 0 ? `${timeStr}` : '';
    });

    const gold = '#ffc832';
    const blue = '#00e5ff';
    const green = '#39ff14';
    const red = '#ff3366';
    const amber = '#ffaa00';
    const softW = 'rgba(255,255,255,0.6)';

    let datasets = [], yAxes = {};

    if (appState.currentGraphTab === 'solar') {
        datasets = [
            { label: 'GHI (W/m²)', data: timeline.map(d => d.ghi), borderColor: gold, backgroundColor: 'rgba(255,200,50,0.05)', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 },
            { label: 'DNI (W/m²)', data: timeline.map(d => d.dni), borderColor: amber, borderWidth: 1.5, fill: false, tension: 0.4, pointRadius: 0, borderDash: [5, 3] },
            { label: 'パネル出力 (W)', data: timeline.map(d => d.panelOutput), borderColor: green, borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0, yAxisID: 'y1' }
        ];
        yAxes = {
            y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: softW }, title: { display: true, text: '日射量 (W/m²)', color: softW }, min: 0 },
            y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: softW }, title: { display: true, text: 'パネル出力 (W)', color: softW }, min: 0 }
        };
    } else if (appState.currentGraphTab === 'temp') {
        datasets = [
            { label: '気温 (°C)', data: timeline.map(d => d.temp), borderColor: amber, backgroundColor: 'rgba(255,170,0,0.05)', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 },
            { label: '路面温度 (°C)', data: timeline.map(d => d.runwayTemp), borderColor: red, borderWidth: 1.5, borderDash: [5, 5], fill: false, tension: 0.4, pointRadius: 0 },
            { label: '湿度 (%)', data: timeline.map(d => d.humidity), borderColor: blue, borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y1' }
        ];
        yAxes = {
            y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: softW }, title: { display: true, text: '温度 (°C)', color: softW } },
            y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: softW }, title: { display: true, text: '湿度 (%)', color: softW }, min: 0, max: 100 }
        };
    } else if (appState.currentGraphTab === 'wind') {
        datasets = [
            { label: '平均風速 (m/s)', data: timeline.map(d => d.windSpeed), borderColor: blue, backgroundColor: 'rgba(0,229,255,0.05)', borderWidth: 2.5, fill: true, tension: 0.3, pointRadius: 0 },
            { label: '突風 (m/s)', data: timeline.map(d => d.windGust), borderColor: amber, borderWidth: 1.5, fill: false, tension: 0.3, pointRadius: 0 },
            { label: '横風 (m/s)', data: timeline.map(d => Math.abs(d.crosswindComponent)), borderColor: red, borderWidth: 1.5, borderDash: [3, 3], fill: false, tension: 0.3, pointRadius: 0 }
        ];
        yAxes = { y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: softW }, title: { display: true, text: '風速 (m/s)', color: softW }, min: 0 } };
    } else if (appState.currentGraphTab === 'precip') {
        datasets = [
            { label: '降水量 (mm/min)', data: timeline.map(d => d.precip), borderColor: '#00aaff', backgroundColor: 'rgba(0,170,255,0.1)', borderWidth: 2, fill: true, tension: 0.2, pointRadius: 0 },
            { label: 'RVR (m)', data: timeline.map(d => d.rvr), borderColor: green, borderWidth: 1.5, fill: false, tension: 0.2, pointRadius: 0, yAxisID: 'y1' }
        ];
        yAxes = {
            y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: softW }, title: { display: true, text: '降水量', color: softW }, min: 0 },
            y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: softW }, title: { display: true, text: 'RVR (m)', color: softW }, min: 0, max: 12000 }
        };
    } else if (appState.currentGraphTab === 'strategy') {
        datasets = [
            { label: 'ソーラー入力 (W)', data: timeline.map(d => d.panelOutput), borderColor: gold, backgroundColor: 'rgba(255,200,50,0.05)', borderWidth: 2, fill: true, tension: 0.4, pointRadius: 0 },
            { label: '走行消費 (W)', data: timeline.map(d => d.consumptionWatts), borderColor: red, borderWidth: 1.5, borderDash: [4, 4], fill: false, tension: 0.3, pointRadius: 0 },
            { label: '最適速度 (km/h)', data: timeline.map(d => d.optimalSpeed), borderColor: green, borderWidth: 2, fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y1' }
        ];
        yAxes = {
            y: { type: 'linear', display: true, position: 'left', grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: softW }, title: { display: true, text: 'エネルギー (W)', color: softW }, min: 0 },
            y1: { type: 'linear', display: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: softW }, title: { display: true, text: '速度 (km/h)', color: softW }, min: 0, max: 130 }
        };
    }

    if (forecastChart) forecastChart.destroy();

    forecastChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { labels: { color: softW, font: { family: 'Inter', size: 10 } } },
                tooltip: {
                    backgroundColor: 'rgba(10,20,40,0.92)', titleColor: '#fff', bodyColor: '#ddd',
                    borderColor: 'rgba(255,200,50,0.15)', borderWidth: 1,
                    callbacks: {
                        title: function (ctx) {
                            const offset = ctx[0].dataIndex;
                            const t = timeline[offset];
                            return `${formatDate(t.time).substring(11, 16)} (+${offset}分)`;
                        }
                    }
                }
            },
            scales: yAxes
        }
    });
}

// ===== ソーラーハーベストチャート =====
function renderSolarHarvestChart() {
    const ctx = document.getElementById('solar-harvest-chart');
    if (!ctx) return;
    const timeline = appState.cities[appState.currentCity].forecastTimeline;
    if (timeline.length === 0) return;

    let cumulativeWh = 0;
    const cumulativeData = timeline.map(d => {
        cumulativeWh += d.panelOutput / 60;
        return cumulativeWh;
    });

    const labels = timeline.map(d => d.minuteOffset % 30 === 0 ? d.time.toTimeString().substring(0, 5) : '');

    if (solarHarvestChart) solarHarvestChart.destroy();

    solarHarvestChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: '累積発電量 (Wh)',
                data: cumulativeData,
                borderColor: '#ffc832',
                backgroundColor: 'rgba(255, 200, 50, 0.08)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,20,40,0.92)',
                    borderColor: 'rgba(255,200,50,0.15)', borderWidth: 1,
                    callbacks: {
                        label: (ctx) => `${Math.round(ctx.parsed.y)} Wh`
                    }
                }
            },
            scales: {
                x: { display: true, ticks: { color: 'rgba(255,255,255,0.3)', font: { size: 9 } }, grid: { display: false } },
                y: { display: true, ticks: { color: 'rgba(255,255,255,0.3)' }, grid: { color: 'rgba(255,255,255,0.03)' }, min: 0, title: { display: true, text: 'Wh', color: 'rgba(255,255,255,0.4)' } }
            }
        }
    });
}
