// Renderizacao (canvas) + UI + loop principal.
// Porte de pomodoro.py: o bichinho e pixel art desenhada em tempo real,
// numa superficie logica 64x64 depois ampliada com nearest-neighbor.

(() => {
  const APP_NAME = "Pomodemônio";
  const STORAGE_KEY = "pomodoro-pet:v1";
  const SPRITE = 64; // resolucao logica do bichinho

  // Paleta (igual ao original)
  const TEXT = [236, 239, 246];
  const MUTED = [140, 148, 166];
  const FOCUS_ACCENT = [255, 96, 96];
  const BREAK_ACCENT = [86, 220, 140];
  const EYE_WHITE = [250, 250, 253];
  const INK = [30, 22, 38];
  const DEMON_EYE = [255, 214, 96];
  const SWEAT = [150, 205, 255];
  const SPARK = [255, 226, 120];
  const TOOTH = [250, 250, 255];

  // Cores da energia: 0.0 = exausto/demonio, 1.0 = fofo
  const ENERGY_STOPS = [
    [0.0, [168, 40, 62]],
    [0.25, [216, 92, 74]],
    [0.55, [238, 170, 100]],
    [1.0, [122, 214, 150]],
  ];

  const JOY_TIME = 1.8;
  const ALERT_TIME = 1.6;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (c1, c2, t) => c1.map((a, i) => Math.round(a + (c2[i] - a) * t));
  const shade = (c, f) => c.map((v) => Math.round(v * f));
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

  function energyColor(energy) {
    const level = clamp(energy / 100.0, 0.0, 1.0);
    for (let i = 0; i < ENERGY_STOPS.length - 1; i++) {
      const [p0, c0] = ENERGY_STOPS[i];
      const [p1, c1] = ENERGY_STOPS[i + 1];
      if (level <= p1) {
        const span = p1 - p0 || 1.0;
        return mix(c0, c1, (level - p0) / span);
      }
    }
    return ENERGY_STOPS[ENERGY_STOPS.length - 1][1];
  }

  // PomodoroPet, FOCUS, BREAK, FOCUS_DONE, BREAK_DONE, BREAK_STARTED vem de pet.js
  // (scripts classicos compartilham o mesmo escopo global lexical).
  const pet = new PomodoroPet({ focusDuration: 25 * 60, breakDuration: 5 * 60 });

  const canvas = document.getElementById("pet-canvas");
  const ctx = canvas.getContext("2d");

  // O bichinho e desenhado inteiramente com formas vetoriais (arcos, elipses,
  // curvas) num espaco logico de 64x64 — nunca foi pixel art de verdade. O
  // aspecto "pixelado" vinha so de ampliar esse canvas pequeno com
  // nearest-neighbor. Aqui desenhamos no backing buffer numa resolucao bem
  // maior (supersampling) e deixamos o navegador reduzir com suavizacao, o
  // que da bordas lisas sem precisar reescrever nenhuma das contas abaixo
  // (todas continuam em termos de coordenadas 0..64).
  const RENDER_SCALE = 4;
  canvas.width = SPRITE * RENDER_SCALE;
  canvas.height = SPRITE * RENDER_SCALE;
  ctx.scale(RENDER_SCALE, RENDER_SCALE);

  const els = {
    phasePill: document.getElementById("phase-pill"),
    status: document.getElementById("status"),
    timer: document.getElementById("timer"),
    energyFill: document.getElementById("energy-fill"),
    energyLabel: document.getElementById("energy-label"),
    cycles: document.getElementById("cycles"),
    mainBtn: document.getElementById("btn-main"),
    skipBtn: document.getElementById("btn-skip"),
    resetBtn: document.getElementById("btn-reset"),
    alertMark: document.getElementById("alert-mark"),
    root: document.documentElement,
  };

  let joy = 0.0;
  let alertTimer = 0.0;
  let look = [0.0, 0.0];
  let lastTime = null;
  let lastSaveAt = 0;

  // --- som ---
  // So pode ser criado apos um gesto real do usuario (click/tecla), por isso
  // a criacao fica separada da reproducao: ensureAudio() roda nas acoes do
  // usuario, playChime() pode ser chamada depois por codigo (ex.: o timer
  // chegando a zero sozinho).
  let audioCtx = null;
  function ensureAudio() {
    if (audioCtx) {
      if (audioCtx.state === "suspended") audioCtx.resume();
      return;
    }
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (AudioCtor) audioCtx = new AudioCtor();
  }
  function playChime() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, t0);
    osc.frequency.setValueAtTime(1175, t0 + 0.12);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  }

  // --- persistencia ---
  // Uma aba em segundo plano pode ser descartada pelo navegador (economia de
  // memoria) e recarregada do zero na proxima visita — sem isso, o Pomodoro
  // "reinicia sozinho" bem no meio de uma sessao. Guardamos o estado e, ao
  // recarregar, recuperamos o tempo real que passou em vez de zerar o timer.
  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          phase: pet.phase,
          remaining: pet.remaining,
          running: pet.running,
          awaiting: pet.awaiting,
          cycles: pet.cycles,
          energy: pet.energy,
          savedAt: Date.now(),
        })
      );
    } catch (e) {
      // localStorage indisponivel (aba anonima, quota etc.) — segue sem persistir
    }
  }

  function loadState() {
    let saved;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      saved = JSON.parse(raw);
    } catch (e) {
      return;
    }
    pet.phase = saved.phase === BREAK ? BREAK : FOCUS;
    pet.remaining = Number(saved.remaining) || 0;
    pet.running = Boolean(saved.running);
    pet.awaiting = Boolean(saved.awaiting);
    pet.cycles = Number(saved.cycles) || 0;
    pet.energy = clamp(Number(saved.energy), 0, 100);

    if (pet.running && !pet.awaiting) {
      const elapsedReal = Math.max(0, (Date.now() - Number(saved.savedAt || Date.now())) / 1000);
      const events = pet.tick(elapsedReal);
      for (const event of events) {
        if (event === FOCUS_DONE || event === BREAK_DONE) alertTimer = ALERT_TIME;
      }
    }
  }

  function accent() {
    return pet.phase === BREAK ? BREAK_ACCENT : FOCUS_ACCENT;
  }

  function expression() {
    if (joy > 0) return "happy";
    if (pet.phase === BREAK && pet.running) return pet.energy >= 70 ? "happy" : "resting";
    return pet.mood;
  }

  function actionLabel() {
    if (pet.awaiting) return pet.phase === FOCUS ? "comecar pausa" : "iniciar foco";
    if (pet.running) return "pausar";
    if (pet.progress > 0) return "retomar";
    return pet.phase === FOCUS ? "iniciar foco" : "iniciar pausa";
  }

  function primaryAction() {
    ensureAudio();
    const event = pet.toggle();
    if (event === BREAK_STARTED) joy = JOY_TIME;
    saveState();
  }

  function doSkip() {
    ensureAudio();
    const event = pet.skip();
    if (event === FOCUS_DONE || event === BREAK_DONE) {
      alertTimer = ALERT_TIME;
      playChime();
    }
    saveState();
  }

  function doReset() {
    ensureAudio();
    pet.reset();
    joy = 0;
    alertTimer = 0;
    saveState();
  }

  // --- eventos ---
  // Tira o foco apos o clique: evita que a barra de espaco "reative" o botao
  // (atalho global) e tambem acione o clique nativo do botao focado.
  function withBlur(fn) {
    return (e) => {
      e.currentTarget.blur();
      fn();
    };
  }
  els.mainBtn.addEventListener("click", withBlur(primaryAction));
  els.skipBtn.addEventListener("click", withBlur(doSkip));
  els.resetBtn.addEventListener("click", withBlur(doReset));
  canvas.addEventListener("click", primaryAction);

  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLButtonElement) return;
    if (e.code === "Space" || e.code === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault();
      primaryAction();
    } else if (e.key === "s" || e.key === "S") {
      doSkip();
    } else if (e.key === "r" || e.key === "R") {
      doReset();
    }
  });

  document.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    look = [
      clamp((e.clientX - cx) / (rect.width * 1.5), -1.0, 1.0),
      clamp((e.clientY - cy) / (rect.height * 1.5), -1.0, 1.0),
    ];
  });

  // salva antes da aba ser ocultada/fechada, para nao perder o progresso
  // caso o navegador descarte a aba em segundo plano.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveState();
  });
  window.addEventListener("pagehide", saveState);

  // --- titulo da aba ---
  // Mostra o timer ao vivo (da pra acompanhar sem trocar de aba) e, quando a
  // fase termina, pisca uma mensagem chamativa ate o usuario dar o proximo passo.
  function updateTitle(now) {
    if (pet.awaiting) {
      const blinkOn = Math.floor(now / 900) % 2 === 0;
      const alertMsg = pet.phase === FOCUS ? "⏰ Hora da pausa!" : "⏰ Hora de focar!";
      document.title = blinkOn ? alertMsg : APP_NAME;
      return;
    }
    document.title = `${PomodoroPet.formatTime(pet.remaining)} · ${pet.phaseLabel} — ${APP_NAME}`;
  }

  // --- UI (DOM) ---
  function updateUI() {
    const acc = accent();
    els.root.style.setProperty("--accent", rgb(acc));
    els.root.style.setProperty("--accent-dark", rgb(shade(acc, 0.65)));

    els.phasePill.textContent = pet.phaseLabel;
    els.status.textContent = pet.awaiting ? "aguardando" : pet.running ? "rodando" : "pausado";

    els.timer.textContent = PomodoroPet.formatTime(pet.remaining);
    els.timer.style.color = pet.awaiting ? rgb(acc) : rgb(TEXT);

    const energyPct = clamp(pet.energy, 0, 100);
    els.energyFill.style.width = `${energyPct}%`;
    els.energyFill.style.backgroundColor = rgb(energyColor(pet.energy));
    els.energyLabel.textContent = `energia ${Math.round(pet.energy)}%`;

    els.cycles.innerHTML = "";
    const shown = Math.min(pet.cycles, 6);
    for (let i = 0; i < shown; i++) {
      const dot = document.createElement("span");
      dot.className = "cycle-dot";
      els.cycles.appendChild(dot);
    }
    if (pet.cycles > 6) {
      const extra = document.createElement("span");
      extra.className = "cycle-extra";
      extra.textContent = `+${pet.cycles - 6}`;
      els.cycles.appendChild(extra);
    }

    els.mainBtn.textContent = actionLabel();
    els.mainBtn.classList.toggle("primary", pet.awaiting || !pet.running);

    els.alertMark.style.opacity = alertTimer > 0 ? "1" : "0";
    if (alertTimer > 0) {
      const pulse = 1.0 + 0.4 * Math.abs(Math.sin(performance.now() / 130.0));
      els.alertMark.style.transform = `translate(-50%, -50%) scale(${pulse})`;
    }
  }

  // --- desenho do bichinho ---
  function menace() {
    return clamp((0.7 - pet.energy / 100.0) / 0.7, 0.0, 1.0);
  }

  function drawSprite(t) {
    const expr = expression();
    const resting = expr === "resting";
    const bx = 32;
    const by = 33;
    const radius = 17;
    let men = menace();
    if (joy > 0) men *= 0.6;
    const body = energyColor(pet.energy);
    const dark = shade(body, 0.52);

    ctx.clearRect(0, 0, SPRITE, SPRITE);

    drawTail(bx, by, radius, men, dark);
    drawHorns(bx, by, radius, men, body);

    fillCircle(bx, by, radius, rgb(body));
    fillEllipse(bx - 9, by + 1, 18, 13, rgb(mix(body, [255, 255, 255], 0.2)));
    if (men < 0.6) {
      fillEllipse(bx - 14, by - 8, 7, 5, rgb(shade(body, 0.88)));
      fillEllipse(bx + 6, by - 4, 5, 4, rgb(shade(body, 0.88)));
    }
    strokeCircle(bx, by, radius, rgb(INK), 2);

    for (const dx of [-6, 6]) {
      const fx = bx + dx - 4;
      const fy = by + radius - 3;
      fillEllipse(fx + 4, fy + 3, 8, 6, rgb(dark));
      strokeEllipse(fx + 4, fy + 3, 8, 6, rgb(INK), 1);
    }

    drawArms(bx, by, radius, body);

    if (expr === "happy" || expr === "ok" || resting) {
      for (const dx of [-11, 11]) {
        fillCircle(bx + dx, by + 4, 2, "rgb(255, 140, 150)");
      }
    }

    drawFace(bx, by, men, expr, t);

    if ((expr === "tired" || expr === "exhausted") && pet.running) drawSweat(bx, by, t);
    if (resting) drawZzz(bx, by, t);
    if (joy > 0) drawJoy(bx, by, radius, t);
  }

  function drawTail(bx, by, radius, men, color) {
    if (men <= 0.2) return;
    const k = (men - 0.2) / 0.8;
    const start = [bx + radius - 2, by + radius - 5];
    const mid = [bx + radius + 6, by + radius - 7];
    const tip = [bx + radius + 8, by + 2 - Math.round(7 * k)];
    ctx.strokeStyle = rgb(color);
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...start);
    ctx.lineTo(...mid);
    ctx.lineTo(...tip);
    ctx.stroke();
    fillPolygon(
      [
        [tip[0] - 3, tip[1] + 1],
        [tip[0] + 3, tip[1] + 1],
        [tip[0], tip[1] - 6],
      ],
      rgb(color)
    );
  }

  function drawHorns(bx, by, radius, men, body) {
    const lit = mix(body, [255, 255, 255], 0.35);
    const color = mix(lit, [104, 62, 120], men);
    const length = Math.round(lerp(5, 15, men));
    const curve = Math.round(lerp(1, 5, men));
    const baseY = by - radius + 3;
    for (const side of [-1, 1]) {
      const baseX = bx + side * 9;
      const tip = [Math.round(bx + side * (9 + curve)), baseY - length];
      const points = [
        [baseX - 3, baseY],
        [baseX + 3, baseY],
        tip,
      ];
      fillPolygon(points, rgb(color));
      strokePolygon(points, rgb(INK), 1);
    }
  }

  function drawArms(bx, by, radius, body) {
    const arm = shade(body, 0.9);
    const raised = joy > 0;
    for (const side of [-1, 1]) {
      const ax = Math.round(bx + side * (radius - 2));
      const ay = Math.round(by + (raised ? -2 : 4));
      fillEllipse(ax, ay, 7, 10, rgb(arm));
      strokeEllipse(ax, ay, 7, 10, rgb(INK), 1);
    }
  }

  function drawFace(bx, by, men, expr, t) {
    const dark = rgb(INK);
    if (expr === "resting") {
      for (const side of [-1, 1]) {
        const x = bx + side * 7;
        const y = by - 4;
        strokePolyline(
          [
            [x - 4, y],
            [x, y + 2],
            [x + 4, y],
          ],
          dark,
          2
        );
      }
      drawMouth(bx, by + 8, 0.0, "smile");
      return;
    }
    if (expr === "exhausted") {
      for (const side of [-1, 1]) {
        const x = bx + side * 7;
        const y = by - 4;
        strokePolyline(
          [
            [x - 4, y + 1],
            [x, y - 2],
            [x + 4, y + 1],
          ],
          dark,
          2
        );
      }
      drawMouth(bx, by + 8, 1.0, "pant");
      return;
    }

    const blink = t % 3.6 < 0.11;
    const eyeW = Math.round(lerp(8, 11, men));
    const eyeH = Math.round(lerp(9, 5, men));
    const sclera = mix(EYE_WHITE, DEMON_EYE, men);
    for (const side of [-1, 1]) {
      const x = bx + side * 7;
      const y = by - 4;
      if (blink) {
        strokeLine(x - eyeW / 2, y, x + eyeW / 2, y, dark, 2);
        continue;
      }
      fillEllipse(x, y, eyeW, eyeH, rgb(sclera));
      strokeEllipse(x, y, eyeW, eyeH, dark, 1);
      let px = x + look[0] * 1.5;
      let py = y + look[1] * 1.5;
      if (expr === "focus") py = y + 1;
      const pupilW = Math.max(2, Math.round(lerp(3, 2, men)));
      const pupilH = Math.max(3, Math.round(lerp(4, eyeH - 1, men)));
      fillEllipse(px, py, pupilW, pupilH, dark);
      if (men < 0.7) {
        ctx.fillStyle = rgb(EYE_WHITE);
        ctx.fillRect(x - 2, y - 2, 1, 1);
      }

      const brow = Math.max(men, expr === "focus" ? 0.45 : 0.0);
      if (brow > 0.12) {
        const outer = [x + side * (eyeW / 2), y - eyeH / 2 - 1];
        const inner = [x - side * (eyeW / 2), y - eyeH / 2 - 1 + 4 * brow];
        strokeLine(outer[0], outer[1], inner[0], inner[1], dark, 2);
      }
    }

    if (expr === "focus") drawMouth(bx, by + 8, men, "flat");
    else if (expr === "tired") drawMouth(bx, by + 8, men, "tired");
    else drawMouth(bx, by + 8, men, "smile");
  }

  function drawMouth(mx, my, men, style) {
    const ink = rgb(INK);
    if (men >= 0.5 && style !== "pant") {
      const k = (men - 0.5) / 0.5;
      const gw = Math.round(lerp(8, 20, k));
      const gh = Math.round(lerp(3, 7, k));
      fillEllipse(mx, my, gw, gh, ink);
      const teeth = 2 + Math.round(3 * k);
      for (let i = 0; i < teeth; i++) {
        const fx = mx - gw / 2 + 2 + (i * (gw - 4)) / Math.max(1, teeth - 1);
        fillPolygon(
          [
            [fx - 1, my - gh / 2],
            [fx + 1, my - gh / 2],
            [fx, my - gh / 2 + 3],
          ],
          rgb(TOOTH)
        );
        fillPolygon(
          [
            [fx - 1, my + gh / 2],
            [fx + 1, my + gh / 2],
            [fx, my + gh / 2 - 3],
          ],
          rgb(TOOTH)
        );
      }
      return;
    }
    if (style === "flat") {
      strokeLine(mx - 5, my, mx + 5, my, ink, 2);
    } else if (style === "tired") {
      strokeLine(mx - 4, my, mx + 4, my - 1, ink, 2);
    } else if (style === "pant") {
      fillEllipse(mx, my + 1, 6, 6, ink);
    } else {
      const curve = style === "smile" ? 3 : 1;
      strokePolyline(
        [
          [mx - 5, my],
          [mx, my + curve],
          [mx + 5, my],
        ],
        ink,
        2
      );
      if (style === "smile") {
        fillPolygon(
          [
            [mx + 2, my - 1],
            [mx + 4, my - 1],
            [mx + 3, my + 2],
          ],
          rgb(TOOTH)
        );
      }
    }
  }

  function drawSweat(bx, by, t) {
    [-14, 14].forEach((dx, i) => {
      const phase = (t * 0.9 + i * 0.5) % 1.0;
      const x = bx + dx;
      const y = by - 8 + phase * 16;
      fillPolygon(
        [
          [x, y - 3],
          [x - 2, y],
          [x + 2, y],
        ],
        rgb(SWEAT)
      );
    });
  }

  function drawZzz(bx, by, t) {
    for (let i = 0; i < 3; i++) {
      const phase = (t * 0.6 + i / 3.0) % 1.0;
      const size = 4 + i;
      const x = bx + 12 + phase * 8 + i * 4;
      const y = by - 12 - phase * 18 - i * 8;
      const col = rgb([170 + i * 20, 210, 255]);
      strokeLine(x, y, x + size, y, col, 2);
      strokeLine(x + size, y, x, y + size, col, 2);
      strokeLine(x, y + size, x + size, y + size, col, 2);
    }
  }

  function drawJoy(bx, by, radius, t) {
    strokeCircle(bx, by, radius + 4, rgb(accent()), 2);
    for (let i = 0; i < 6; i++) {
      const angle = t * 2.2 + (i * Math.PI) / 3;
      const rr = radius + 5 + 3 * Math.sin(t * 3 + i);
      const x = bx + Math.cos(angle) * rr;
      const y = by + Math.sin(angle) * rr * 0.8;
      ctx.fillStyle = rgb(SPARK);
      ctx.fillRect(x - 1, y - 3, 2, 6);
      ctx.fillRect(x - 3, y - 1, 6, 2);
    }
  }

  // --- helpers de desenho ---
  function fillCircle(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  function strokeCircle(x, y, r, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  function fillEllipse(cx, cy, w, h, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  function strokeEllipse(cx, cy, w, h, color, lw) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  function fillPolygon(points, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.closePath();
    ctx.fill();
  }
  function strokePolygon(points, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.closePath();
    ctx.stroke();
  }
  function strokePolyline(points, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
    ctx.stroke();
  }
  function strokeLine(x1, y1, x2, y2, color, w) {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // --- loop principal ---
  function frame(now) {
    if (lastTime === null) lastTime = now;
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    const events = pet.tick(dt);
    for (const event of events) {
      if (event === FOCUS_DONE || event === BREAK_DONE) {
        alertTimer = ALERT_TIME;
        playChime();
      }
    }
    joy = Math.max(0.0, joy - dt);
    alertTimer = Math.max(0.0, alertTimer - dt);

    updateUI();
    updateTitle(now);
    drawSprite(now / 1000.0);

    if (now - lastSaveAt > 1000) {
      saveState();
      lastSaveAt = now;
    }

    requestAnimationFrame(frame);
  }

  loadState();
  requestAnimationFrame(frame);
})();
