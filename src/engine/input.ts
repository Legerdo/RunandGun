// Keyboard + gamepad input with edge detection and a virtual override used by the test harness.

export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'fire' | 'bomb' | 'slide' | 'start';
export const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'jump', 'fire', 'bomb', 'slide', 'start'];

const KEYMAP: Record<string, Action> = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyX: 'jump', KeyK: 'jump', Space: 'jump',
  KeyZ: 'fire', KeyJ: 'fire',
  KeyC: 'bomb', KeyL: 'bomb',
  KeyV: 'slide', ShiftLeft: 'slide', ShiftRight: 'slide', Semicolon: 'slide',
  Enter: 'start', Escape: 'start', KeyP: 'start',
};

export class Input {
  private keys = new Set<Action>();
  private held: Record<Action, boolean> = Object.fromEntries(ACTIONS.map((a) => [a, false])) as Record<Action, boolean>;
  private prev: Record<Action, boolean> = { ...this.held };
  private pressBuf: Record<Action, number> = Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<Action, number>;
  virtual: Partial<Record<Action, boolean>> | null = null;
  anyKeyPressed = false;
  onFirstGesture: (() => void) | null = null;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      this.gesture();
      if (a) {
        this.keys.add(a);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) {
        this.keys.delete(a);
        e.preventDefault();
      }
    });
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', () => this.gesture());
  }

  private gesture() {
    this.anyKeyPressed = true;
    if (this.onFirstGesture) {
      const f = this.onFirstGesture;
      this.onFirstGesture = null;
      f();
    }
  }

  // Called once per fixed step.
  poll() {
    const now: Record<Action, boolean> = Object.fromEntries(ACTIONS.map((a) => [a, this.keys.has(a)])) as Record<Action, boolean>;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const b = (i: number) => !!p.buttons[i]?.pressed;
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (ax < -0.4 || b(14)) now.left = true;
      if (ax > 0.4 || b(15)) now.right = true;
      if (ay < -0.5 || b(12)) now.up = true;
      if (ay > 0.5 || b(13)) now.down = true;
      if (b(0)) now.jump = true;
      if (b(2) || b(7)) now.fire = true;
      if (b(1) || b(3)) now.bomb = true;
      if (b(4) || b(5) || b(6)) now.slide = true;
      if (b(9)) now.start = true;
    }
    if (this.virtual) for (const a of ACTIONS) now[a] = !!this.virtual[a];
    for (const a of ACTIONS) {
      this.prev[a] = this.held[a];
      this.held[a] = now[a];
      if (now[a] && !this.prev[a]) this.pressBuf[a] = 6; // 6-frame input buffer
      else if (this.pressBuf[a] > 0) this.pressBuf[a]--;
    }
  }

  down(a: Action) { return this.held[a]; }
  pressed(a: Action) { return this.held[a] && !this.prev[a]; }
  released(a: Action) { return !this.held[a] && this.prev[a]; }
  // Buffered press: true if pressed within the last few frames. Consume to avoid repeats.
  buffered(a: Action) { return this.pressBuf[a] > 0; }
  consume(a: Action) { this.pressBuf[a] = 0; }
}
