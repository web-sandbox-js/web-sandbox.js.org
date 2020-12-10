Promise.all([
  importScript('https://cdn.jsdelivr.net/npm/single-spa@5.8.2/lib/umd/single-spa.min.js'),
  importScript('/dist/web-sandbox.umd.js')
]).then(() => {
  singleSpa.registerApplication(
    'navbar',
    ({ name }) => importSandboxApp(name, 'navbar/index.js'),
    location => true
  );

  singleSpa.registerApplication(
    'app1',
    ({ name }) => importSandboxApp(name, 'app1/index.js'),
    location => location.hash.startsWith('#/app1')
  );

  singleSpa.registerApplication(
    'app2',
    ({ name }) => importSandboxApp(name, 'app2/index.js'),
    location => location.hash.startsWith('#/app2')
  );

  singleSpa.registerApplication(
    'vue-todomvc',
    ({ name }) => importSandboxApp(name, 'vue-todomvc/dist/app.js'),
    location => location.hash.startsWith('#/vue-todomvc')
  );

  singleSpa.start();
});

function importSandboxApp(name, url, view = document.body) {
  url = new URL(url, document.baseURI).href;
  return new Promise((resolve, reject) => {
    fetch(url).then(res => {
      if (!res.ok) {
        throw Error([res.status, res.statusText, url].join(', '));
      }

      const contentType = res.headers.get('content-type');
      const jsContentTypeRegEx = /^(text|application)\/(x-)?javascript(;|$)/;

      if (!contentType || !jsContentTypeRegEx.test(contentType)) {
        throw Error(contentType);
      }

      return res
        .text()
        .then(source => {
          if (source.indexOf('//# sourceURL=') < 0) {
            source += `\n//# sourceURL=${url}`;
          }

          const exports = {};
          const module = { exports };

          const sandbox = document.createElement('web-sandbox');
          sandbox.name = name;
          view.appendChild(sandbox);

          try {
            sandbox.evaluate(source, {
              module,
              exports
            });
          } catch (error) {
            console.error(error);
            return reject(error);
          }

          resolve(module.exports);
        })
        .catch(reject);
    }, reject);
  });
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
