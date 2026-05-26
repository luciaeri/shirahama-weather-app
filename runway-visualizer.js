/* ==========================================================================
   旧南紀白浜空港 局所天気予報アプリ - 滑走路風速・吹き流しビジュアライザ
   Script file: runway-visualizer.js
   ========================================================================== */

class RunwayVisualizer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.windSpeed = 0;       // m/s
        this.windAngle = 0;       // degrees (0 = North, 90 = East, 180 = South, 270 = West)
        this.runwayHeading = 150; // RWY 15/33 (150 degrees / 330 degrees)
        this.activeRunway = '15'; // '15' or '33'
        
        this.animationFrame = 0;
        this.init();
        
        window.addEventListener('resize', () => this.resize());
    }

    init() {
        this.resize();
    }

    resize() {
        // Get true layout size from container
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * window.devicePixelRatio;
        this.canvas.height = rect.height * window.devicePixelRatio;
        this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    updateWind(speed, angle) {
        this.windSpeed = speed;
        this.windAngle = angle;
        
        // Determine active runway: land into the wind (minimize tailwind)
        // Cosine of angle difference between wind source and runway heading
        const diff15 = ((angle - 150) * Math.PI) / 180;
        const headwind15 = speed * Math.cos(diff15);
        
        if (headwind15 >= 0) {
            this.activeRunway = '15';
        } else {
            this.activeRunway = '33';
        }
    }

    draw(timeMs) {
        const width = this.canvas.width / window.devicePixelRatio;
        const height = this.canvas.height / window.devicePixelRatio;
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.45;
        
        this.ctx.clearRect(0, 0, width, height);
        
        // 1. Draw Compass Ring (Outer Circle)
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        this.ctx.stroke();

        // Draw Compass Cardinals (N, E, S, W)
        this.ctx.font = 'bold 10px var(--font-primary)';
        this.ctx.fillStyle = 'var(--text-muted)';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        
        const cardinals = [
            { text: 'N', a: -Math.PI / 2 },
            { text: 'E', a: 0 },
            { text: 'S', a: Math.PI / 2 },
            { text: 'W', a: Math.PI }
        ];
        
        cardinals.forEach(c => {
            const tx = cx + Math.cos(c.a) * (radius - 12);
            const ty = cy + Math.sin(c.a) * (radius - 12);
            this.ctx.fillText(c.text, tx, ty);
        });

        // 2. Draw Runway (RWY 15/33 heading is ~150 degrees)
        // Runway is drawn rotated. 150 degrees is SSE.
        // We calculate coordinate axes
        const rwyAngleRad = ((150 - 90) * Math.PI) / 180; // offset by 90 to match canvas coords
        
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.rotate(rwyAngleRad);
        
        // Tarmac
        this.ctx.fillStyle = 'rgba(25, 30, 45, 0.95)';
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.lineWidth = 1;
        const rwyLength = radius * 1.5;
        const rwyWidth = 26;
        this.ctx.fillRect(-rwyLength / 2, -rwyWidth / 2, rwyLength, rwyWidth);
        this.ctx.strokeRect(-rwyLength / 2, -rwyWidth / 2, rwyLength, rwyWidth);
        
        // Runway Centerline
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([8, 6]);
        this.ctx.beginPath();
        this.ctx.moveTo(-rwyLength / 2 + 15, 0);
        this.ctx.lineTo(rwyLength / 2 - 15, 0);
        this.ctx.stroke();
        this.ctx.setLineDash([]); // clear dash
        
        // Runway Designator Numbers
        this.ctx.font = '900 11px var(--font-heading)';
        this.ctx.fillStyle = '#fff';
        
        // Runway 33 is on the left side (North-West end), oriented facing SE
        this.ctx.save();
        this.ctx.translate(-rwyLength / 2 + 20, 0);
        this.ctx.rotate(Math.PI / 2);
        this.ctx.fillText('33', 0, 0);
        this.ctx.restore();
        
        // Runway 15 is on the right side (South-East end), oriented facing NW
        this.ctx.save();
        this.ctx.translate(rwyLength / 2 - 20, 0);
        this.ctx.rotate(-Math.PI / 2);
        this.ctx.fillText('15', 0, 0);
        this.ctx.restore();

        // Highlight active Runway threshold in green
        this.ctx.fillStyle = 'rgba(57, 255, 20, 0.25)';
        this.ctx.strokeStyle = 'var(--neon-green)';
        this.ctx.lineWidth = 1.5;
        if (this.activeRunway === '15') {
            // Landing on 15 means approaching from NW (left side of canvas drawing) to SE
            this.ctx.fillRect(-rwyLength / 2, -rwyWidth / 2, 8, rwyWidth);
            this.ctx.strokeRect(-rwyLength / 2, -rwyWidth / 2, 8, rwyWidth);
        } else {
            // Landing on 33 means approaching from SE (right side of canvas drawing) to NW
            this.ctx.fillRect(rwyLength / 2 - 8, -rwyWidth / 2, 8, rwyWidth);
            this.ctx.strokeRect(rwyLength / 2 - 8, -rwyWidth / 2, 8, rwyWidth);
        }
        
        this.ctx.restore();

        // 3. Draw Active Direction Indicator Arrow
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.rotate(rwyAngleRad);
        
        this.ctx.strokeStyle = 'rgba(57, 255, 20, 0.6)';
        this.ctx.fillStyle = 'rgba(57, 255, 20, 0.6)';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        if (this.activeRunway === '15') {
            // Arrow pointing left-to-right (landing NW to SE)
            this.ctx.moveTo(-rwyLength / 2 - 25, 0);
            this.ctx.lineTo(-rwyLength / 2 - 12, 0);
            this.ctx.lineTo(-rwyLength / 2 - 16, -4);
            this.ctx.moveTo(-rwyLength / 2 - 12, 0);
            this.ctx.lineTo(-rwyLength / 2 - 16, 4);
        } else {
            // Arrow pointing right-to-left (landing SE to NW)
            this.ctx.moveTo(rwyLength / 2 + 25, 0);
            this.ctx.lineTo(rwyLength / 2 + 12, 0);
            this.ctx.lineTo(rwyLength / 2 + 16, -4);
            this.ctx.moveTo(rwyLength / 2 + 12, 0);
            this.ctx.lineTo(rwyLength / 2 + 16, 4);
        }
        this.ctx.stroke();
        this.ctx.restore();

        // 4. Draw Wind Vector Arrow (Center)
        if (this.windSpeed > 0.1) {
            // Wind comes FROM windAngle, so it blows TOWARDS windAngle + 180
            const blowAngleRad = ((this.windAngle - 90) * Math.PI) / 180;
            const arrowLen = Math.min(radius * 0.7, 15 + this.windSpeed * 4.5);
            
            this.ctx.save();
            this.ctx.translate(cx, cy);
            this.ctx.rotate(blowAngleRad);
            
            // Wind arrow shaft
            const arrowGrad = this.ctx.createLinearGradient(-arrowLen, 0, 0, 0);
            arrowGrad.addColorStop(0, 'rgba(0, 240, 255, 0.0)');
            arrowGrad.addColorStop(0.8, 'rgba(0, 240, 255, 0.8)');
            arrowGrad.addColorStop(1, 'var(--neon-blue)');
            
            this.ctx.strokeStyle = arrowGrad;
            this.ctx.lineWidth = 3;
            this.ctx.beginPath();
            this.ctx.moveTo(-arrowLen, 0);
            this.ctx.lineTo(0, 0);
            this.ctx.stroke();
            
            // Wind arrow head (facing center / blow direction)
            this.ctx.fillStyle = 'var(--neon-blue)';
            this.ctx.beginPath();
            this.ctx.moveTo(0, 0);
            this.ctx.lineTo(-8, -5);
            this.ctx.lineTo(-6, 0);
            this.ctx.lineTo(-8, 5);
            this.ctx.closePath();
            this.ctx.fill();
            
            this.ctx.restore();
        }

        // 5. Draw Animated Windsock (Positioned top-left of runway area)
        this.drawWindsock(cx - radius * 0.5, cy - radius * 0.4, timeMs);
        
        // Active runway text in small box
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        this.ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        this.ctx.fillRect(cx - 50, cy + radius - 26, 100, 18);
        this.ctx.strokeRect(cx - 50, cy + radius - 26, 100, 18);
        this.ctx.fillStyle = 'var(--text-secondary)';
        this.ctx.font = '500 8.5px var(--font-primary)';
        this.ctx.fillText(`ACTIVE RWY: ${this.activeRunway}`, cx, cy + radius - 17);
    }

    drawWindsock(x, y, timeMs) {
        // Windsock pole
        this.ctx.strokeStyle = 'rgba(200, 200, 200, 0.8)';
        this.ctx.lineWidth = 2.5;
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x, y - 30);
        this.ctx.stroke();
        
        // Small metallic cap on top
        this.ctx.fillStyle = '#aaa';
        this.ctx.beginPath();
        this.ctx.arc(x, y - 30, 2, 0, Math.PI * 2);
        this.ctx.fill();

        // Windsock fabric behavior based on wind speed
        // angle fabric points: wind blows TOWARDS windAngle + 180
        const windTowardsRad = ((this.windAngle - 90) * Math.PI) / 180;
        
        // Calculate horizontal extension (droop) based on wind speed
        // fully drooped at 0m/s, horizontal at 10m/s+
        const droopFactor = Math.min(1.0, this.windSpeed / 9);
        const sockAngle = windTowardsRad + (Math.PI / 2) * (1 - droopFactor) * 0.7;
        
        this.ctx.save();
        this.ctx.translate(x, y - 30);
        this.ctx.rotate(sockAngle);

        // Windsock segments (Stripes of Orange and White)
        const segs = 4;
        const baseLen = 22;
        const segmentLength = baseLen / segs;
        const startWidth = 6.5;
        const endWidth = 3;
        
        // Flatter waving effect in wind
        const waveAmp = (this.windSpeed > 1) ? Math.sin((timeMs * 0.008) + x) * (this.windSpeed * 0.25) : 0;
        
        let curX = 0;
        for (let i = 0; i < segs; i++) {
            const segmentProgress = i / segs;
            const nextProgress = (i + 1) / segs;
            
            const w1 = startWidth - (startWidth - endWidth) * segmentProgress;
            const w2 = startWidth - (startWidth - endWidth) * nextProgress;
            
            const x1 = curX;
            const x2 = curX + segmentLength;
            
            // Add wave curve to Y position of segments
            const y1 = Math.sin((i / segs) * Math.PI * 0.5) * waveAmp;
            const y2 = Math.sin(((i + 1) / segs) * Math.PI * 0.5) * waveAmp;
            
            // Stripe color
            this.ctx.fillStyle = (i % 2 === 0) ? '#ff5500' : '#ffffff';
            
            this.ctx.beginPath();
            this.ctx.moveTo(x1, y1 - w1);
            this.ctx.lineTo(x2, y2 - w2);
            this.ctx.lineTo(x2, y2 + w2);
            this.ctx.lineTo(x1, y1 + w1);
            this.ctx.closePath();
            this.ctx.fill();
            
            curX = x2;
        }
        
        this.ctx.restore();
    }
}

// Bind class to window
window.RunwayVisualizer = RunwayVisualizer;
