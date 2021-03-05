class FancyButton extends HTMLButtonElement {
  constructor() {
    super();
    this.addEventListener('click', e => this.drawRipple(e.offsetX, e.offsetY));
  }

  drawRipple(x, y) {
    const div = document.createElement('div');
    div.classList.add('ripple');
    this.appendChild(div);
    div.style.top = `${y - div.clientHeight / 2}px`;
    div.style.left = `${x - div.clientWidth / 2}px`;
    div.style.backgroundColor = 'currentColor';
    div.classList.add('run');
    div.addEventListener('transitionend', () => div.remove());
  }
}

if (!customElements.get('fancy-button')) {
  customElements.define('fancy-button', FancyButton, { extends: 'button' });
}
