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

document.body.innerHTML = `
  <a href="https://web-sandbox.js.org/examples/single-spa/index.html">link</a>
  <button id="import-script">importScript()</button>  
`;

document.getElementById('import-script').addEventListener('click', () => {
  importScript('/examples/sandbox-attr/sub.js');
});
