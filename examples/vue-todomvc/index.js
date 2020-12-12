async function bootstrap() {
  document.body.innerHTML = `<div id="app"></div>`;
  await importScript('/examples/vue-todomvc/dist/vue.runtime.js');
  await importScript('/examples/vue-todomvc/dist/app.js');
}

function importScript(url) {
  const script = document.createElement('script');
  script.src = url;
  return loader(script);
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

bootstrap();
