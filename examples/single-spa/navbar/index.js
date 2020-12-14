let style, template;

export function bootstrap(props) {
  return Promise.resolve().then(() => {
    style = document.createElement('style');
    style.textContent = `nav { color: #000 }`;
    template = document.createElement('nav');
    template.innerHTML = `
    <a href="#/home">home</a>
    |
    <a href="#/sandbox-window-api">sandbox-window-api</a>
    |
    <a href="#/vue-todomvc">vue-todomvc</a>
    `;
  });
}

export function mount(props) {
  return Promise.resolve().then(() => {
    document.head.appendChild(style);
    document.querySelector('header').appendChild(template);
  });
}

export function unmount(props) {
  return Promise.resolve().then(() => {
    document.head.removeChild(style);
    document.querySelector('header').removeChild(template);
  });
}
