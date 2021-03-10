async function bootstrap() {
  document.body.innerHTML = `<section class="todo-appmvc"></section>`;
  await importScript('/examples/react-todomvc/dist/react.min.js');
  await importScript('/examples/react-todomvc/dist/bundle.js');
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
