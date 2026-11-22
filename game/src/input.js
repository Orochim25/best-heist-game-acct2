// Night Ledger — keyboard and mouse: WASD/arrows, C sneak, Shift sprint,
// 1-4 pick a gadget, Q or click uses it, M mute, P/Esc pause.
export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, clicked: false };
    this.pressed = new Set();
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!this.keys.has(e.key)) this.pressed.add(e.key);
      this.keys.add(e.key);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * canvas.width;
      this.mouse.y = ((e.clientY - r.top) / r.height) * canvas.height;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.mouse.clicked = true;
    });
  }

  /** Movement vector, -1..1 on each axis. */
  move() {
    let x = 0;
    let y = 0;
    if (this.keys.has('a') || this.keys.has('A') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('D') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('w') || this.keys.has('W') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('s') || this.keys.has('S') || this.keys.has('ArrowDown')) y += 1;
    return { x, y };
  }

  gait() {
    if (this.keys.has('c') || this.keys.has('C') || this.keys.has('Control')) return 'sneak';
    if (this.keys.has('Shift')) return 'sprint';
    return 'walk';
  }

  wasPressed(key) {
    return this.pressed.has(key);
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.clicked = false;
  }
}
