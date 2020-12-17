async function bootstrap() {
  await importScript('/examples/lit-element-todomvc/dist/app.js');
  const myTodo = document.createElement('my-todo');
  document.body.appendChild(myTodo);
  // document.body.innerHTML = `<my-todo></my-todo>`;
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
