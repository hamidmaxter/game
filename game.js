(function(){
    // ---------- CANVAS ----------
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let cw, ch;
    function resizeCanvas() {
        cw = window.innerWidth;
        ch = window.innerHeight;
        canvas.width = cw;
        canvas.height = ch;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // ---------- GAME CONSTANTS ----------
    const LANE_COUNT = 3;
    let laneWidth = cw / LANE_COUNT;
    let lanePositions = [laneWidth/2, laneWidth*1.5, laneWidth*2.5];
    const PLAYER_Y_OFFSET = ch - 120;
    const GROUND_Y = ch - 70;
    const PLAYER_SIZE = 50;

    let gameRunning = false;
    let paused = false;
    let score = 0;
    let coinsCollected = 0;
    let bestScore = localStorage.getItem('bestRunnerScore') || 0;
    let gameSpeed = 5.0;
    let baseSpeed = 5.0;
    let speedMultiplier = 1.0;
    let distanceCounter = 0;
    let frame = 0;
    let animationId = null;

    // player state
    let currentLane = 1; // 0/1/2
    let isJumping = false;
    let jumpProgress = 0;
    let isSliding = false;
    let slideTimer = 0;
    let invincible = false;
    let invincibleTimer = 0;
    let magnetActive = false;
    let magnetTimer = 0;
    let speedBoostTimer = 0;
    
    // world arrays
    let obstacles = [];
    let coins = [];
    let powerups = [];
    
    let lastSpawnFrame = 0;
    let spawnGap = 45;  // frames between spawns (decreases with score)
    let globalOffset = 0;

    // audio / ui elements
    const homeScreen = document.getElementById('homeScreen');
    const gameHUD = document.getElementById('gameHUD');
    const gameOverPanel = document.getElementById('gameOverPanel');
    const pausePanel = document.getElementById('pausePanel');
    const scoreSpan = document.getElementById('scoreValue');
    const coinSpan = document.getElementById('coinValue');
    const bestScoreSpan = document.getElementById('bestScoreDisplay');
    const finalScoreSpan = document.getElementById('finalScore');
    const finalCoinsSpan = document.getElementById('finalCoins');
    const soundToggleBtn = document.getElementById('soundToggle');
    
    let soundEnabled = true;
    let bgmAudio = null; // lazy web audio context
    let audioCtx = null;
    
    function initAudio() {
        if(!audioCtx && soundEnabled) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    function playBeep(type) {
        if(!soundEnabled || !audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        let freq = 800;
        let duration = 0.1;
        if(type === 'coin') { freq = 1200; duration = 0.08; }
        if(type === 'crash') { freq = 300; duration = 0.4; gain.gain.value = 0.4; }
        if(type === 'jump') { freq = 600; duration = 0.12; }
        if(type === 'powerup') { freq = 1600; duration = 0.2; }
        osc.frequency.value = freq;
        gain.gain.value = 0.15;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        osc.stop(audioCtx.currentTime + duration);
    }
    function playBgMusic() { /* stub, but we trigger start on user gesture */ }
    
    // update best display
    bestScoreSpan.innerText = bestScore;
    
    // lane utils
    function updateLanePositions() {
        laneWidth = cw / LANE_COUNT;
        lanePositions = [laneWidth/2, laneWidth*1.5, laneWidth*2.5];
    }
    
    // spawn objects
    function trySpawn(frameCount) {
        let dynamicGap = Math.max(25, spawnGap - Math.floor(score / 500));
        if(frameCount - lastSpawnFrame < dynamicGap) return;
        lastSpawnFrame = frameCount;
        // obstacle chance 60%
        if(Math.random() < 0.6) {
            let lane = Math.floor(Math.random() * 3);
            let type = Math.random() > 0.7 ? 'slide' : 'normal';
            if(Math.random() > 0.8) type = 'jump';
            obstacles.push({
                x: cw + 30,
                lane: lane,
                width: 42,
                height: 48,
                type: type,
                active: true
            });
        } else {
            // spawn coins (1~4 in a row)
            let count = 1 + Math.floor(Math.random() * 4);
            for(let i=0;i<count;i++) {
                coins.push({
                    x: cw + 30 + i * 45,
                    lane: Math.floor(Math.random() * 3),
                    width: 28,
                    height: 28,
                    collected: false
                });
            }
        }
        // powerup every 250 score
        if(score > 0 && Math.random() < 0.02 && powerups.length < 2) {
            let type = ['magnet','invincible','speed'][Math.floor(Math.random()*3)];
            powerups.push({
                x: cw + 40,
                lane: Math.floor(Math.random() * 3),
                type: type,
                width: 36,
                height: 36
            });
        }
    }
    
    function updateWorld() {
        if(!gameRunning || paused) return;
        let currentSpeed = baseSpeed * speedMultiplier * (1 + Math.floor(score/2000)*0.2);
        currentSpeed = Math.min(currentSpeed, 18);
        // move obstacles
        for(let i=0;i<obstacles.length;i++) {
            obstacles[i].x -= currentSpeed;
            if(obstacles[i].x + 50 < 0) obstacles.splice(i,1), i--;
        }
        for(let i=0;i<coins.length;i++) {
            coins[i].x -= currentSpeed;
            if(coins[i].x + 40 < 0) coins.splice(i,1), i--;
        }
        for(let i=0;i<powerups.length;i++) {
            powerups[i].x -= currentSpeed;
            if(powerups[i].x + 40 < 0) powerups.splice(i,1), i--;
        }
        // frame based score increment
        distanceCounter++;
        if(distanceCounter % 6 === 0) {
            score += 1;
            scoreSpan.innerText = Math.floor(score);
            if(score > bestScore) { bestScore = score; localStorage.setItem('bestRunnerScore', bestScore); bestScoreSpan.innerText = bestScore; }
        }
        // coin magnet effect
        if(magnetActive) {
            for(let c of coins) {
                if(!c.collected && Math.abs(c.lane - currentLane) <= 1) {
                    let dx = (lanePositions[c.lane] - lanePositions[currentLane]);
                    if(Math.abs(dx) < 100) {
                        c.collected = true;
                        coinsCollected++;
                        coinSpan.innerText = coinsCollected;
                        playBeep('coin');
                    }
                }
            }
        }
        // collision detection (non invincible)
        if(!invincible) {
            for(let ob of obstacles) {
                let playerLaneX = lanePositions[currentLane];
                let obX = ob.x;
                if(Math.abs(obX - playerLaneX) < 45 && ob.lane === currentLane) {
                    let isEvaded = false;
                    if(ob.type === 'jump' && isJumping) isEvaded = true;
                    if(ob.type === 'slide' && isSliding) isEvaded = true;
                    if(!isEvaded) { gameCrash(); return; }
                }
            }
        }
        // collect coins
        for(let c of coins) {
            if(!c.collected && Math.abs(c.x - lanePositions[currentLane]) < 40 && c.lane === currentLane) {
                c.collected = true;
                coinsCollected++;
                coinSpan.innerText = coinsCollected;
                playBeep('coin');
            }
        }
        // collect powerups
        for(let i=0;i<powerups.length;i++) {
            let p = powerups[i];
            if(Math.abs(p.x - lanePositions[currentLane]) < 40 && p.lane === currentLane) {
                if(p.type === 'magnet') { magnetActive = true; magnetTimer = 450; playBeep('powerup'); }
                if(p.type === 'invincible') { invincible = true; invincibleTimer = 350; playBeep('powerup'); }
                if(p.type === 'speed') { speedBoostTimer = 400; speedMultiplier = 1.8; playBeep('powerup'); }
                powerups.splice(i,1);
                i--;
            }
        }
        // update timers
        if(invincible) { invincibleTimer--; if(invincibleTimer<=0) invincible=false; }
        if(magnetActive) { magnetTimer--; if(magnetTimer<=0) magnetActive=false; }
        if(speedBoostTimer) { speedBoostTimer--; if(speedBoostTimer<=0) speedMultiplier=1.0; }
        // jump & slide physics
        if(isJumping) {
            jumpProgress += 0.18;
            if(jumpProgress >= 1) { isJumping = false; jumpProgress = 0; }
        }
        if(isSliding) {
            slideTimer--;
            if(slideTimer <= 0) isSliding = false;
        }
    }
    
    function gameCrash() {
        if(!gameRunning) return;
        gameRunning = false;
        playBeep('crash');
        if ('vibrate' in navigator) navigator.vibrate(200);
        finalScoreSpan.innerText = Math.floor(score);
        finalCoinsSpan.innerText = coinsCollected;
        gameOverPanel.classList.remove('hidden');
        cancelAnimationFrame(animationId);
    }
    
    // drawing
    function draw() {
        ctx.clearRect(0,0,cw,ch);
        // neon grid
        ctx.fillStyle = '#131a2c';
        ctx.fillRect(0,0,cw,ch);
        for(let i=1;i<LANE_COUNT;i++) {
            let x = i * laneWidth;
            ctx.beginPath();
            ctx.strokeStyle = '#facc1555';
            ctx.lineWidth = 3;
            ctx.setLineDash([12,20]);
            ctx.moveTo(x,0);
            ctx.lineTo(x,ch);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        // draw coins
        for(let c of coins) {
            if(c.collected) continue;
            ctx.fillStyle = '#FFD966';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.ellipse(c.x, GROUND_Y-15, 15, 18, 0, 0, Math.PI*2);
            ctx.fill();
            ctx.fillStyle = '#F1C40F';
            ctx.beginPath();
            ctx.ellipse(c.x-2, GROUND_Y-18, 4, 6, 0, 0, Math.PI*2);
            ctx.fill();
        }
        // draw obstacles
        for(let ob of obstacles) {
            let yBase = GROUND_Y - 25;
            ctx.fillStyle = '#e74c3c';
            ctx.shadowBlur = 10;
            ctx.fillRect(ob.x-22, yBase-30, 44, 50);
            if(ob.type === 'jump') ctx.fillStyle = '#f39c12';
            if(ob.type === 'slide') ctx.fillStyle = '#9b59b6';
            ctx.fillRect(ob.x-22, yBase-30, 44, 50);
        }
        // powerups
        for(let p of powerups) {
            ctx.fillStyle = '#2ecc71';
            ctx.shadowBlur = 12;
            ctx.beginPath();
            ctx.rect(p.x-18, GROUND_Y-35, 36, 36);
            ctx.fill();
            ctx.fillStyle = 'white';
            ctx.font = 'bold 22px monospace';
            ctx.fillText(p.type[0].toUpperCase(), p.x-10, GROUND_Y-10);
        }
        // draw player (with jump/slide effect)
        let playerY = GROUND_Y - 50;
        if(isJumping) playerY -= Math.sin(jumpProgress * Math.PI) * 55;
        if(isSliding) playerY += 22;
        ctx.shadowBlur = 20;
        ctx.fillStyle = invincible ? '#fde047' : '#3b82f6';
        ctx.beginPath();
        ctx.roundRect(lanePositions[currentLane]-30, playerY-8, 60, 55, 20);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 32px monospace';
        ctx.fillText('🏃', lanePositions[currentLane]-18, playerY+22);
        ctx.shadowBlur = 0;
    }
    
    // animate & loop
    function gameLoop() {
        if(!gameRunning || paused) { if(!paused && !gameRunning) return; draw(); requestAnimationFrame(gameLoop); return; }
        frame++;
        updateWorld();
        updateLanePositions();
        trySpawn(frame);
        draw();
        animationId = requestAnimationFrame(gameLoop);
    }
    
    // control methods
    function changeLane(dir) {
        if(!gameRunning || paused) return;
        let newLane = currentLane + dir;
        if(newLane >=0 && newLane < LANE_COUNT) currentLane = newLane;
    }
    function actionJump() { if(!gameRunning || paused) return; if(!isJumping && !isSliding) { isJumping = true; jumpProgress=0; playBeep('jump'); } }
    function actionSlide() { if(!gameRunning || paused) return; if(!isSliding && !isJumping) { isSliding = true; slideTimer = 28; playBeep('jump'); } }
    
    // reset game
    function startGame() {
        gameRunning = true;
        paused = false;
        score = 0;
        coinsCollected = 0;
        gameSpeed = baseSpeed = 5.0;
        speedMultiplier = 1;
        obstacles = []; coins = []; powerups = [];
        currentLane = 1;
        isJumping = false; isSliding = false;
        invincible=false; magnetActive=false;
        frame = 0; lastSpawnFrame = 0;
        distanceCounter = 0;
        scoreSpan.innerText = "0";
        coinSpan.innerText = "0";
        gameOverPanel.classList.add('hidden');
        pausePanel.classList.add('hidden');
        homeScreen.classList.add('hidden');
        gameHUD.classList.remove('hidden');
        if(animationId) cancelAnimationFrame(animationId);
        animationId = requestAnimationFrame(gameLoop);
        initAudio();
        if(audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    }
    
    function pauseGame() { if(gameRunning && !paused) { paused = true; pausePanel.classList.remove('hidden'); } }
    function resumeGame() { if(gameRunning && paused) { paused = false; pausePanel.classList.add('hidden'); animationId = requestAnimationFrame(gameLoop); } }
    function quitHome() { cancelAnimationFrame(animationId); gameRunning=false; homeScreen.classList.remove('hidden'); gameHUD.classList.add('hidden'); pausePanel.classList.add('hidden'); }
    
    // event handlers
    document.getElementById('playBtn').onclick = () => { startGame(); };
    document.getElementById('restartBtn').onclick = () => { gameOverPanel.classList.add('hidden'); startGame(); };
    document.getElementById('resumeBtn').onclick = resumeGame;
    document.getElementById('quitHomeBtn').onclick = quitHome;
    document.getElementById('pauseBtn').onclick = pauseGame;
    document.getElementById('shareScoreBtn').onclick = () => { alert(`🏆 Score: ${Math.floor(score)}\n🪙 Coins: ${coinsCollected}\nMetro Chase`); };
    soundToggleBtn.onclick = () => { soundEnabled = !soundEnabled; soundToggleBtn.innerText = soundEnabled ? "🔊 SOUND ON" : "🔇 SOUND OFF"; if(soundEnabled && audioCtx && audioCtx.state==='suspended') audioCtx.resume(); };
    
    // keyboard & touch
    window.addEventListener('keydown', (e) => {
        if(e.key === 'ArrowLeft') changeLane(-1);
        if(e.key === 'ArrowRight') changeLane(1);
        if(e.key === 'ArrowUp') actionJump();
        if(e.key === 'ArrowDown') actionSlide();
        if(e.key === ' ' && gameRunning) actionJump();
    });
    let touchStartX = 0;
    canvas.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; e.preventDefault(); });
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); });
    canvas.addEventListener('touchend', (e) => {
        let endX = e.changedTouches[0].clientX;
        let diff = endX - touchStartX;
        if(Math.abs(diff) > 50) changeLane(diff>0 ? 1 : -1);
    });
    canvas.addEventListener('touchstart', (e) => { if(e.touches.length === 2) actionJump(); });
    // roundRect helper
    if (!CanvasRenderingContext2D.prototype.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
            if (w < 2 * r) r = w / 2;
            if (h < 2 * r) r = h / 2;
            this.moveTo(x+r, y);
            this.lineTo(x+w-r, y);
            this.quadraticCurveTo(x+w, y, x+w, y+r);
            this.lineTo(x+w, y+h-r);
            this.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
            this.lineTo(x+r, y+h);
            this.quadraticCurveTo(x, y+h, x, y+h-r);
            this.lineTo(x, y+r);
            this.quadraticCurveTo(x, y, x+r, y);
            return this;
        };
    }
})();