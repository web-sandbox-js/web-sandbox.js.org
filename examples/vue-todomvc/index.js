Promise.all([
  importScript('/examples/vue-todomvc/dist/vue.runtime.js'),
  importStyle('/examples/vue-todomvc/dist/app.css')
]).then(() => {
  document.body.innerHTML = `<div id="app"></div>`;
  importScript('/examples/vue-todomvc/dist/app.js');
});

function importScript(url) {
  const script = document.createElement('script');
  script.src = url;
  return loader(script);
}

function importStyle(url) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = url;
  return loader(stylesheet);
}

function loader(element) {
  return new Promise((resolve, reject) => {
    element.addEventListener('load', () => {
      resolve();
    });
    element.addEventListener('error', e => {
      reject(e);
    });
    document.head.appendChild(element);
  });
}
