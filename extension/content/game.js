// content/game.js
// Lane-based pixel car dodging game during loading.
// Player moves between 3 lanes with W/S or Up/Down arrows.
// Oncoming cars scroll from right to left. Dodge to survive.

/* eslint-disable no-unused-vars */
var CarLensGame = (function () {
  let canvas, ctx;
  let running = false;
  let animFrame = null;

  // Constants
  const LANE_COUNT = 3;
  const PLAYER_SCALE = 3;
  const SPRITE_W = 29;
  const SPRITE_H = 13;

  // Game state
  let player, obstacles, score, gameOver;
  let speed, spawnTimer, nextSpawn;
  let carImages = {};
  let imagesLoaded = false;
  let canvasW, canvasH, laneHeight, roadTop;

  const PLAYER_SPRITE = "sedan_blue.png";
  const OBSTACLE_SPRITES = [
    "sports_red.png", "truck.png", "van.png", "taxi.png",
    "suv.png", "convertible.png", "sedan.png",
  ];

  function loadImages(callback) {
    if (imagesLoaded) { callback(); return; }
    const allSprites = [PLAYER_SPRITE, ...OBSTACLE_SPRITES];
    let loaded = 0;
    for (const name of allSprites) {
      const img = new Image();
      img.onload = img.onerror = () => {
        loaded++;
        if (loaded === allSprites.length) { imagesLoaded = true; callback(); }
      };
      img.src = chrome.runtime.getURL("assets/cars/" + name);
      carImages[name] = img;
    }
  }

  function laneY(lane) {
    return roadTop + lane * laneHeight + (laneHeight - SPRITE_H * PLAYER_SCALE) / 2;
  }

  function init() {
    canvas = document.getElementById("carlens-game");
    if (!canvas) return;
    ctx = canvas.getContext("2d");

    const container = canvas.parentElement;
    canvasW = container ? container.clientWidth : 380;
    canvasH = 120;
    canvas.width = canvasW;
    canvas.height = canvasH;

    // Road occupies most of the canvas, with sky at top
    roadTop = 16;
    laneHeight = (canvasH - roadTop - 4) / LANE_COUNT;

    reset();
    loadImages(() => {
      running = true;
      bindInput();
      loop();
    });
  }

  function reset() {
    player = {
      lane: 1, // middle lane
      x: 24,
      targetY: 0,
      y: 0,
      w: SPRITE_W * PLAYER_SCALE,
      h: SPRITE_H * PLAYER_SCALE,
    };
    player.targetY = laneY(player.lane);
    player.y = player.targetY;

    obstacles = [];
    score = 0;
    gameOver = false;
    speed = 3;
    spawnTimer = 0;
    nextSpawn = 40 + Math.floor(Math.random() * 30);
  }

  function bindInput() {
    document._carlensGameHandler = function (e) {
      if (!running) return;
      // Only capture keys when the loading screen is actively visible
      const loading = document.getElementById("carlens-loading");
      if (!loading || loading.style.display === "none") return;

      const key = e.key || e.code;

      // Retry on SPACE when game over
      if (gameOver) {
        if (key === " " || key === "Space") { reset(); e.preventDefault(); }
        return;
      }

      if (key === "ArrowUp" || key === "w" || key === "W") {
        if (player.lane > 0) {
          player.lane--;
          player.targetY = laneY(player.lane);
          e.preventDefault();
        }
      } else if (key === "ArrowDown" || key === "s" || key === "S") {
        if (player.lane < LANE_COUNT - 1) {
          player.lane++;
          player.targetY = laneY(player.lane);
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", document._carlensGameHandler);

    // Touch/click: top half = up, bottom half = down
    canvas.addEventListener("click", (e) => {
      if (!running) return;
      if (gameOver) { reset(); return; }
      const rect = canvas.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      if (clickY < canvas.height / 2) {
        if (player.lane > 0) { player.lane--; player.targetY = laneY(player.lane); }
      } else {
        if (player.lane < LANE_COUNT - 1) { player.lane++; player.targetY = laneY(player.lane); }
      }
    });
  }

  function spawnObstacle() {
    // Pick a random lane, avoid spawning on top of recent obstacles in same lane
    let lane = Math.floor(Math.random() * LANE_COUNT);
    // Check if there's already an obstacle close in this lane
    const tooClose = obstacles.some(o => o.lane === lane && o.x > canvasW - 120);
    if (tooClose) {
      lane = (lane + 1) % LANE_COUNT;
    }

    const scale = 2.2 + Math.random() * 1;
    const sprite = OBSTACLE_SPRITES[Math.floor(Math.random() * OBSTACLE_SPRITES.length)];
    obstacles.push({
      x: canvasW + 10,
      lane,
      y: laneY(lane) + (SPRITE_H * PLAYER_SCALE - SPRITE_H * scale) / 2,
      w: SPRITE_W * scale,
      h: SPRITE_H * scale,
      sprite,
    });
  }

  function update() {
    if (gameOver) return;

    score++;
    speed = 3 + score * 0.003;

    // Smooth lane transition
    const dy = player.targetY - player.y;
    player.y += dy * 0.25;

    // Spawn
    spawnTimer++;
    if (spawnTimer >= nextSpawn) {
      spawnObstacle();
      // Occasionally spawn two cars at once in different lanes for challenge
      if (score > 300 && Math.random() < 0.4) {
        spawnObstacle();
      }
      spawnTimer = 0;
      nextSpawn = Math.max(20, 45 - score * 0.01) + Math.floor(Math.random() * 25);
    }

    // Move & collide
    for (let i = obstacles.length - 1; i >= 0; i--) {
      obstacles[i].x -= speed;
      if (obstacles[i].x + obstacles[i].w < 0) {
        obstacles.splice(i, 1);
        continue;
      }

      const o = obstacles[i];
      const margin = 6;
      if (
        player.x + margin < o.x + o.w - margin &&
        player.x + player.w - margin > o.x + margin &&
        player.y + margin < o.y + o.h - margin &&
        player.y + player.h - margin > o.y + margin
      ) {
        gameOver = true;
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, roadTop);
    sky.addColorStop(0, "#c8ddf0");
    sky.addColorStop(1, "#e0ecf6");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvasW, roadTop);

    // Road background
    ctx.fillStyle = "#555";
    ctx.fillRect(0, roadTop, canvasW, canvasH - roadTop);

    // Lane dividers (dashed white lines)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1.5;
    const dashOffset = -(score * speed * 0.4) % 24;
    ctx.setLineDash([14, 10]);
    ctx.lineDashOffset = dashOffset;
    for (let i = 1; i < LANE_COUNT; i++) {
      const lineY = roadTop + i * laneHeight;
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(canvasW, lineY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    // Road edges (solid lines)
    ctx.strokeStyle = "#eee";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, roadTop);
    ctx.lineTo(canvasW, roadTop);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, canvasH - 2);
    ctx.lineTo(canvasW, canvasH - 2);
    ctx.stroke();

    // Pixelated sprites
    ctx.imageSmoothingEnabled = false;

    // Draw player (facing right)
    const pImg = carImages[PLAYER_SPRITE];
    if (pImg && pImg.complete && pImg.naturalWidth > 0) {
      ctx.drawImage(pImg, player.x, player.y, player.w, player.h);
    } else {
      ctx.fillStyle = "#4285f4";
      ctx.fillRect(player.x, player.y, player.w, player.h);
    }

    // Draw obstacles (flipped to face left — coming toward player)
    for (const o of obstacles) {
      const oImg = carImages[o.sprite];
      if (oImg && oImg.complete && oImg.naturalWidth > 0) {
        ctx.save();
        ctx.translate(o.x + o.w, o.y);
        ctx.scale(-1, 1);
        ctx.drawImage(oImg, 0, 0, o.w, o.h);
        ctx.restore();
      } else {
        ctx.fillStyle = "#ea4335";
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
    }

    // Score display
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "right";
    ctx.fillText(Math.floor(score / 5) + "", canvasW - 8, roadTop - 3);

    // Game over
    if (gameOver) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(0, 0, canvasW, canvasH);

      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Score: " + Math.floor(score / 5), canvasW / 2, canvasH / 2 - 8);

      ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText("Press SPACE or tap to retry", canvasW / 2, canvasH / 2 + 12);
    }
  }

  function loop() {
    if (!running) return;
    update();
    draw();
    animFrame = requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    init();
  }

  function stop() {
    running = false;
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }
    if (document._carlensGameHandler) {
      document.removeEventListener("keydown", document._carlensGameHandler);
      document._carlensGameHandler = null;
    }
  }

  return { start, stop };
})();
