/* eslint-disable no-use-before-define, no-undef, no-restricted-globals, no-console  */
import globalFeatures from './global-features.js';

function render(element, hostGlobalFeatures, sandboxGlobalFeatures, filter) {
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

const sandbox = document.createElement('web-sandbox');
const iframe = document.createElement('iframe');
document.body.appendChild(sandbox);
document.body.appendChild(iframe);

const hostGlobalFeatures = globalFeatures(iframe.contentWindow);
console.log(hostGlobalFeatures);
const sandboxGlobalFeatures = globalFeatures(sandbox.contentWindow);

// document.body.removeChild(sandbox);
window.sandbox = sandbox.contentWindow;
document.body.removeChild(iframe);

const cores = [
  'Document',
  'cancelAnimationFrame',
  'CharacterData',
  'clearInterval',
  'clearTimeout',
  'close',
  'console',
  'customElements',
  'Document',
  'DocumentFragment',
  'Element',
  'Event',
  'EventTarget',
  'getComputedStyle',
  'HTMLElement',
  'location',
  'NamedNodeMap',
  'Navigator',
  'Node',
  'NodeList',
  'requestAnimationFrame',
  'setInterval',
  'setTimeout',
  'ShadowRoot',
  'Storage',
  'Text',
  'UIEvent',
  'Window'
];

const hashchange = () => {
  const url = location.hash.replace(/#!\//, '');
  const search = new URLSearchParams(url);
  console.log(hostGlobalFeatures);
  render(
    document.getElementById('list'),
    hostGlobalFeatures,
    sandboxGlobalFeatures,
    name => {
      let result = true;
      const map = { true: true, false: false };
      if (search.has('core')) {
        result = map[search.get('core')] === cores.includes(name);
      }

      if (result && search.has('compat')) {
        result = map[search.get('compat')] === !!sandboxGlobalFeatures[name];
      }

      return result;
    }
  );
};
hashchange();
window.addEventListener('hashchange', hashchange);
