'use strict';
// Minimal on-screen keyboard for typing a Wi-Fi password on the touch screen.

class OnScreenKeyboard {
  constructor(root, input, onEnter) {
    this.root = root;
    this.input = input;
    this.onEnter = onEnter;
    this.layout = 'lower';
    this.render();
    root.addEventListener('pointerdown', (e) => {
      const key = e.target.closest('button[data-key]');
      if (!key) return;
      e.preventDefault();
      key.classList.add('down');
      setTimeout(() => key.classList.remove('down'), 120);
      this.press(key.dataset.key);
    });
  }

  static LAYOUTS = {
    lower: ['1234567890', 'qwertyuiop', 'asdfghjkl', '⇧zxcvbnm⌫', '#  ⏎'],
    upper: ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', '⇧ZXCVBNM⌫', '#  ⏎'],
    sym: ['1234567890', '!@#$%^&*()', '-_=+[]{};:', "a'\",.<>/?⌫", '\\|`~  ⏎'],
  };

  render() {
    const rows = OnScreenKeyboard.LAYOUTS[this.layout];
    this.root.innerHTML = rows.map((row) => {
      const keys = [];
      for (let i = 0; i < row.length; i++) {
        const ch = row[i];
        if (ch === ' ' && row[i + 1] === ' ') { keys.push(['space', 'space', 'wide']); i++; continue; }
        if (ch === '⇧') keys.push(['shift', '⇧', this.layout === 'upper' ? 'mod on' : 'mod']);
        else if (ch === '⌫') keys.push(['back', '⌫', 'mod']);
        else if (ch === '⏎') keys.push(['enter', 'Connect', 'mod enter']);
        else if (ch === '#' && this.layout !== 'sym') keys.push(['sym', '#+=', 'mod']);
        else if (ch === 'a' && this.layout === 'sym' && i === 0) keys.push(['abc', 'abc', 'mod']);
        else keys.push([ch, ch, '']);
      }
      return '<div class="kb-row">' + keys.map(([k, label, cls]) =>
        `<button type="button" class="kb-key ${cls}" data-key="${k.replace(/"/g, '&quot;')}">${
          label.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</button>`).join('') + '</div>';
    }).join('');
  }

  press(key) {
    const v = this.input.value;
    switch (key) {
      case 'shift': this.layout = this.layout === 'upper' ? 'lower' : 'upper'; this.render(); return;
      case 'sym': this.layout = 'sym'; this.render(); return;
      case 'abc': this.layout = 'lower'; this.render(); return;
      case 'back': this.input.value = v.slice(0, -1); break;
      case 'space': this.input.value = v + ' '; break;
      case 'enter': this.onEnter && this.onEnter(); return;
      default:
        this.input.value = v + key;
        if (this.layout === 'upper') { this.layout = 'lower'; this.render(); } // one-shot shift
    }
    this.input.dispatchEvent(new Event('input'));
  }
}
