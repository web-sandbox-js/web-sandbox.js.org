import '/dist/web-sandbox.umd.js';

export default {
  import(name, url, view = window.document.body) {
    return new Promise((resolve, reject) => {
      url = new URL(url, window.document.baseURI).href;
      window.fetch(url).then(res => {
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

            const sandbox = window.document.createElement('web-sandbox');
            sandbox.name = name;
            view.appendChild(sandbox);

            sandbox.evaluate(source, {
              module,
              exports
            });

            resolve(module.exports);
          })
          .catch(reject);
      }, reject);
    });
  }
};
