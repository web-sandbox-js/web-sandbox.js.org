importScript('/docs/web-compat/global-features.js').then(globalFeatures => {
  const sandbox = document.querySelector('web-sandbox[name=api]');
  console.time('globalFeatures');
  const hostGlobalFeatures = globalFeatures(window);
  console.timeEnd('globalFeatures');
  const sandboxGlobalFeatures = globalFeatures(sandbox.contentWindow);

  const hashchange = () => {
    const url = location.hash.replace(/#!\//, '') || '?compat=all';
    const search = new URLSearchParams(url);
    const filter = search.get('compat');
    console.log(hostGlobalFeatures);
    render(
      document.getElementById('list'),
      hostGlobalFeatures,
      sandboxGlobalFeatures,
      filter
    );
  };
  hashchange();
  window.addEventListener('hashchange', hashchange);
});

function importScript(url) {
  if (typeof module !== 'object') {
    window.exports = {};
    window.module = { exports };
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.addEventListener('load', () => {
      resolve(window.module.exports);
    });
    script.addEventListener('error', e => {
      reject(e);
    });
    script.src = url;
    document.head.appendChild(script);
  });
}

function render(
  element,
  hostGlobalFeatures,
  sandboxGlobalFeatures,
  compat = 'all'
) {
  const filter = name => {
    if (compat === 'all') {
      return true;
    }
    return (
      { true: true, false: false }[compat] === !!sandboxGlobalFeatures[name]
    );
  };
  element.innerHTML = Object.entries(hostGlobalFeatures)
    .filter(([name]) => filter(name))
    .map(
      ([name, value, compat = !!sandboxGlobalFeatures[name]]) => `
      <details open compat="${compat}">
        <summary>
          <strong>${compat ? '✔︎' : '✖︎'}</strong>
          <a href="https://developer.mozilla.org/en-US/docs/Web/API/${name}">
            ${name}
          </a>  
        </summary>
        <ul>
        ${[
          ...(value.properties || [])
            .filter(() => filter)
            .map(propertie => ({
              prefix: typeof window[name] === 'function' ? '#' : '',
              compat:
                compat &&
                sandboxGlobalFeatures[name].properties.includes(propertie),
              propertie
            })),
          ...(value.prototype || [])
            .filter(() => filter)
            .map(propertie => ({
              prefix: '',
              compat:
                compat &&
                sandboxGlobalFeatures[name].prototype.includes(propertie),
              propertie
            }))
        ]
          .map(
            ({ prefix, propertie, compat }) =>
              `<li compat="${compat}">
                <strong>${compat ? '✔︎' : '✖︎'}</strong>
                <a href="https://developer.mozilla.org/en-US/docs/Web/API/${name}/${propertie}">
                ${prefix}${propertie}
                </a>
              </li>`
          )
          .join('')}
        </ul>
      </details>
    `
    )
    .join('');
}
