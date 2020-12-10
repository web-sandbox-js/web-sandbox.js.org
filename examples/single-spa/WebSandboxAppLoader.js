import '/src/index.js';

export default {
  import(name, url, view = document.body) {
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
};
