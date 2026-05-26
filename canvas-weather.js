/* ==========================================================================
   旧南紀白浜空港 局所天気予報アプリ - 天候パーティクルアニメーション
   Script file: canvas-weather.js
   ========================================================================== */

class WeatherEffectCanvas {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.particles = [];
        this.clouds = [];
        this.sunRays = [];
        this.weatherMode = 'clear'; // clear, cloudy, rain, windy
        this.windSpeed = 2.0;       // m/s (determines angle/speed)
        this.windAngle = 0;         // degrees (0 = north, 90 = east...)
        this.rainIntensity = 0.0;   // mm/min
        
        this.init();
        this.animate();
        
        window.addEventListener('resize', () => this.resize());
    }

    init() {
        this.resize();
        this.createClouds();
        this.createSunRays();
    }

    resize() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    }

    setWeather(mode, windSpeed, rainIntensity, windAngle = 0) {
        this.weatherMode = mode;
        this.windSpeed = windSpeed;
        this.rainIntensity = rainIntensity;
        this.windAngle = windAngle;
        
        // Reset or adjust particles on change
        if (mode === 'rain' && this.particles.length < 100) {
            this.createRainParticles(150);
        } else if (mode === 'windy' && this.particles.length < 80) {
            this.createWindLines(60);
        } else if (mode === 'clear' && this.particles.length < 40) {
            this.createSunnyDust(30);
        }
    }

    createRainParticles(count) {
        this.particles = [];
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height - this.canvas.height,
                length: Math.random() * 20 + 15,
                speed: Math.random() * 15 + 15,
                opacity: Math.random() * 0.4 + 0.1,
                width: Math.random() * 1.5 + 0.5
            });
        }
    }

    createWindLines(count) {
        this.particles = [];
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                length: Math.random() * 80 + 40,
                speed: Math.random() * 4 + 2,
                opacity: Math.random() * 0.15 + 0.05,
                width: Math.random() * 2 + 1
            });
        }
    }

    createSunnyDust(count) {
        this.particles = [];
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                radius: Math.random() * 4 + 1,
                speedX: (Math.random() - 0.5) * 0.5,
                speedY: (Math.random() - 0.5) * 0.5 - 0.2, // Drift slightly up
                opacity: Math.random() * 0.3 + 0.05
            });
        }
    }

    createClouds() {
        this.clouds = [];
        const cloudCount = 6;
        for (let i = 0; i < cloudCount; i++) {
            this.clouds.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * (this.canvas.height * 0.4),
                radius: Math.random() * 80 + 60,
                speed: (Math.random() * 0.2 + 0.05) * (Math.random() > 0.5 ? 1 : -1),
                opacity: Math.random() * 0.08 + 0.02
            });
        }
    }

    createSunRays() {
        this.sunRays = [];
        const rayCount = 4;
        for (let i = 0; i < rayCount; i++) {
            this.sunRays.push({
                angle: (i / rayCount) * Math.PI * 0.5 + 0.2,
                opacity: Math.random() * 0.03 + 0.01,
                speed: Math.random() * 0.0005 + 0.0002
            });
        }
    }

    drawClear() {
        // Draw soft ambient sunlight / halo in upper right
        const gradient = this.ctx.createRadialGradient(
            this.canvas.width * 0.85, this.canvas.height * 0.15, 0,
            this.canvas.width * 0.85, this.canvas.height * 0.15, this.canvas.width * 0.6
        );
        gradient.addColorStop(0, 'rgba(255, 170, 0, 0.12)');
        gradient.addColorStop(0.3, 'rgba(0, 240, 255, 0.02)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw floating sunny dust particles
        this.ctx.fillStyle = 'rgba(255, 240, 200, 1)';
        this.particles.forEach(p => {
            this.ctx.globalAlpha = p.opacity;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Move particle
            p.x += p.speedX + (this.windSpeed * 0.05);
            p.y += p.speedY;

            // Boundary wrap
            if (p.x < 0) p.x = this.canvas.width;
            if (p.x > this.canvas.width) p.x = 0;
            if (p.y < 0) p.y = this.canvas.height;
            if (p.y > this.canvas.height) p.y = 0;
        });
        this.ctx.globalAlpha = 1.0;
    }

    drawCloudy() {
        // Draw cloud shapes drifting across
        this.ctx.fillStyle = 'rgba(200, 220, 255, 1)';
        this.clouds.forEach(c => {
            this.ctx.globalAlpha = c.opacity;
            this.ctx.beginPath();
            this.ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
            this.ctx.arc(c.x + c.radius * 0.6, c.y - c.radius * 0.2, c.radius * 0.8, 0, Math.PI * 2);
            this.ctx.arc(c.x - c.radius * 0.6, c.y - c.radius * 0.2, c.radius * 0.8, 0, Math.PI * 2);
            this.ctx.fill();

            // Drift based on wind
            c.x += c.speed + (this.windSpeed * 0.02);
            if (c.x - c.radius * 1.5 > this.canvas.width) {
                c.x = -c.radius * 1.5;
            } else if (c.x + c.radius * 1.5 < 0) {
                c.x = this.canvas.width + c.radius * 1.5;
            }
        });
        this.ctx.globalAlpha = 1.0;
    }

    drawRain() {
        // Overlay gray gradient for sky darkness
        const overlayGrad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
        overlayGrad.addColorStop(0, 'rgba(10, 15, 30, 0.4)');
        overlayGrad.addColorStop(1, 'rgba(5, 5, 10, 0.1)');
        this.ctx.fillStyle = overlayGrad;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw falling rain streaks
        this.ctx.strokeStyle = 'rgba(150, 200, 255, 1)';
        
        // Rain falls down and sideways based on wind speed
        // Convert windAngle to radians
        const angleRad = (this.windAngle * Math.PI) / 180;
        const windDX = Math.sin(angleRad) * this.windSpeed * 0.8;

        this.particles.forEach(p => {
            this.ctx.globalAlpha = p.opacity;
            this.ctx.lineWidth = p.width;
            this.ctx.beginPath();
            
            // Start line
            this.ctx.moveTo(p.x, p.y);
            // End line slanted by wind
            this.ctx.lineTo(p.x + windDX, p.y + p.length);
            this.ctx.stroke();

            // Move rain
            p.y += p.speed;
            p.x += windDX;

            // Reset when offscreen
            if (p.y > this.canvas.height) {
                p.y = -p.length;
                p.x = Math.random() * this.canvas.width;
                p.opacity = Math.random() * (this.rainIntensity * 0.3) + 0.1; // scale opacity with rain rate
            }
            if (p.x < 0) p.x = this.canvas.width;
            if (p.x > this.canvas.width) p.x = 0;
        });
        this.ctx.globalAlpha = 1.0;

        // Draw soft clouds in rain too
        this.drawCloudy();
    }

    drawWindy() {
        this.ctx.strokeStyle = 'rgba(0, 240, 255, 1)';
        
        // Wind vectors
        const angleRad = (this.windAngle * Math.PI) / 180;
        const windX = Math.sin(angleRad) * (this.windSpeed * 0.6);
        const windY = -Math.cos(angleRad) * (this.windSpeed * 0.6);

        this.particles.forEach(p => {
            this.ctx.globalAlpha = p.opacity;
            this.ctx.lineWidth = p.width;
            
            this.ctx.beginPath();
            this.ctx.moveTo(p.x, p.y);
            // Draw flowing curved or straight line
            this.ctx.lineTo(p.x + windX * p.length * 0.1, p.y + windY * p.length * 0.1);
            this.ctx.stroke();

            // Drift particle
            p.x += windX + (Math.sin(p.y * 0.01) * 0.2); // minor wavy motion
            p.y += windY;

            // Wrap boundaries
            if (p.x < -p.length) p.x = this.canvas.width;
            if (p.x > this.canvas.width + p.length) p.x = -p.length;
            if (p.y < -p.length) p.y = this.canvas.height;
            if (p.y > this.canvas.height + p.length) p.y = -p.length;
        });
        this.ctx.globalAlpha = 1.0;
    }

    animate() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw depending on weather mode
        switch (this.weatherMode) {
            case 'clear':
                this.drawClear();
                break;
            case 'cloudy':
                this.drawCloudy();
                break;
            case 'rain':
                this.drawRain();
                break;
            case 'windy':
                this.drawWindy();
                break;
            default:
                this.drawClear();
        }
        
        requestAnimationFrame(() => this.animate());
    }
}

// Bind to window to allow access from main app
window.weatherCanvas = null;
window.addEventListener('DOMContentLoaded', () => {
    window.weatherCanvas = new WeatherEffectCanvas('weather-effect-canvas');
});
