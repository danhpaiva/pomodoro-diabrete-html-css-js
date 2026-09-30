// Logica pura do Pomodoro-Tamagotchi: ciclo foco/pausa e energia/humor.
// Porte fiel de pet.py — sem dependencias de DOM/canvas, testavel isoladamente.

const FOCUS = "focus";
const BREAK = "break";

const PHASE_LABELS = { [FOCUS]: "FOCO", [BREAK]: "PAUSA" };

// Limiares de humor (energia 0..100)
const EXHAUSTED_MAX = 20;
const TIRED_MAX = 45;
const OK_MAX = 75;

// Eventos devolvidos por tick()/skip()/toggle()/advance()
const FOCUS_DONE = "focus_done";
const BREAK_DONE = "break_done";
const BREAK_STARTED = "break_started";
const FOCUS_STARTED = "focus_started";

class PomodoroPet {
  constructor({
    focusDuration = 25 * 60,
    breakDuration = 5 * 60,
    startEnergy = 85.0,
    focusCost = 45.0,
    breakRestore = 30.0,
  } = {}) {
    this.focusDuration = focusDuration;
    this.breakDuration = breakDuration;
    this.startEnergy = startEnergy;
    this.focusCost = focusCost;
    this.breakRestore = breakRestore;

    this.phase = FOCUS;
    this.remaining = this.focusDuration;
    this.running = false;
    this.awaiting = false;
    this.cycles = 0;
    this.energy = this.startEnergy;
  }

  start() {
    if (!this.awaiting) this.running = true;
  }

  pause() {
    this.running = false;
  }

  // Iniciar/pausar; se estiver aguardando, inicia a proxima fase.
  // Retorna o evento da transicao (ou null).
  toggle() {
    if (this.awaiting) return this.advance();
    this.running = !this.running;
    return null;
  }

  // Comeca a proxima fase a partir do estado 'aguardando'.
  advance() {
    if (!this.awaiting) return null;
    this.awaiting = false;
    this.running = true;
    if (this.phase === FOCUS) {
      this.phase = BREAK;
      this.remaining = this.breakDuration;
      return BREAK_STARTED;
    }
    this.phase = FOCUS;
    this.remaining = this.focusDuration;
    return FOCUS_STARTED;
  }

  // Nova sessao completa: volta para o foco com a energia inicial.
  reset() {
    this.phase = FOCUS;
    this.remaining = this.focusDuration;
    this.running = false;
    this.awaiting = false;
    this.cycles = 0;
    this.energy = this.startEnergy;
  }

  // Encerra a fase atual agora, deixando o bichinho aguardando.
  skip() {
    return this._finishPhase();
  }

  // Avanca `dt` segundos. Retorna a lista de eventos ocorridos.
  tick(dt) {
    if (!this.running || this.awaiting || dt <= 0) return [];

    const step = Math.min(dt, this.remaining);
    this._applyEnergy(step);
    if (this.remaining > dt) {
      this.remaining -= dt;
      return [];
    }
    return [this._finishPhase()];
  }

  _applyEnergy(seconds) {
    if (this.phase === FOCUS) {
      const rate = this.focusDuration ? this.focusCost / this.focusDuration : 0.0;
      this.energy -= rate * seconds;
    } else {
      const rate = this.breakDuration ? this.breakRestore / this.breakDuration : 0.0;
      this.energy += rate * seconds;
    }
    this.energy = Math.max(0.0, Math.min(100.0, this.energy));
  }

  _finishPhase() {
    this.running = false;
    this.awaiting = true;
    this.remaining = 0.0;
    if (this.phase === FOCUS) {
      this.cycles += 1;
      return FOCUS_DONE;
    }
    return BREAK_DONE;
  }

  get duration() {
    return this.phase === FOCUS ? this.focusDuration : this.breakDuration;
  }

  get nextPhase() {
    return this.phase === FOCUS ? BREAK : FOCUS;
  }

  // Fracao ja decorrida da fase atual (0..1).
  get progress() {
    if (this.duration <= 0) return 1.0;
    return Math.max(0.0, Math.min(1.0, 1.0 - this.remaining / this.duration));
  }

  get mood() {
    const energy = this.energy;
    if (energy <= EXHAUSTED_MAX) return "exhausted";
    if (energy <= TIRED_MAX) return "tired";
    if (this.phase === FOCUS) return "focus";
    if (energy <= OK_MAX) return "ok";
    return "happy";
  }

  get resting() {
    return this.phase === BREAK && this.running;
  }

  get phaseLabel() {
    return PHASE_LABELS[this.phase];
  }

  static formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
}
