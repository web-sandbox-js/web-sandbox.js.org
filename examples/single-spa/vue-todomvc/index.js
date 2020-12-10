Promise.all([
  importScript('/examples/single-spa/vue-todomvc/dist/vue.runtime.js'),
  importStyle('/examples/single-spa/vue-todomvc/dist/app.css')
]).then(() => {
  window.exports = {};
  window.module = { exports };

  const $module = module;
  const $exports = exports;

  importScript('/examples/single-spa/vue-todomvc/dist/app.js').then(() => {
    $module.exports = exports;
  });
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
