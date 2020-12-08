const esIgnore = [
  'Infinity',
  'NaN',
  'undefined',
  'isFinite',
  'isNaN',
  'parseFloat',
  'parseInt',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'Array',
  'ArrayBuffer',
  'Boolean',
  'DataView',
  'EvalError',
  'Float32Array',
  'Float64Array',
  'Int8Array',
  'Int16Array',
  'Int32Array',
  'Map',
  'Number',
  'Object',
  'RangeError',
  'ReferenceError',
  'Set',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'Uint8Array',
  'Uint8ClampedArray',
  'Uint16Array',
  'Uint32Array',
  'URIError',
  'WeakMap',
  'WeakSet',
  'JSON',
  'Math',
  'Reflect',
  'escape',
  'unescape',
  'Date',
  'Error',
  'Promise',
  'Proxy',
  'RegExp',
  'Intl',
  'Realm',
  'eval',
  'Function'
];

const selfIgnore = ['window', 'self', 'document'];
const staticIgnore = ['length', 'prototype', 'name', 'toString'];
const prototypeIgnore = ['constructor'];

const api = Object.getOwnPropertyNames(window)
  .filter(name => !esIgnore.includes(name) && !selfIgnore.includes(name))
  .map(name => {
    const value = window[name];
    const type = typeof value;
    const desc = { name, type, prototype: [], property: [] };

    if (type === 'function' || (type === 'object' && value !== null)) {
      desc.prototype = Object.getOwnPropertyNames(value.prototype || {})
        .filter(name => !prototypeIgnore.includes(name))
        .map(name => ({
          name,
          descriptor:
            Reflect.getOwnPropertyDescriptor(value.prototype, name) || {}
        }));
      desc.property = Object.getOwnPropertyNames(value || {})
        .filter(name => !staticIgnore.includes(name))
        .map(name => ({
          name,
          descriptor: Reflect.getOwnPropertyDescriptor(value, name) || {}
        }));
    }

    return desc;
  });

const style = document.createElement('style');
style.textContent = `
  details {
      margin-bottom: 1rem;
      font-size: 14px;
  }
  /* 隐藏默认三角 */
  ::-webkit-details-marker {
      display: none;
  }
  ::-moz-list-bullet {
      font-size: 0;
      float: left;
  }
  summary {
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      outline: 0;
  }
  summary[focus] {
      outline: 1px dotted;
      outline: 5px auto -webkit-focus-ring-color;
  }
  dt {
      font-weight: bold;
  }
  dt::after {
      content: '';
      position: absolute;
      width: 12px; height: 12px;
      margin: 4px 0 0 .5ch;
      background: url(/examples/websandbox-environment/arrow-on.svg) no-repeat;
      background-size: 100% 100%;
      transition: transform .2s;
  }
  [open] dt::after {
      transform: rotate(90deg);
  }
  dd {
      margin: 0 0 0 1em;
  }
  `;

const template = document.createElement('div');
template.innerHTML = api
  .map(
    ({ name, type, prototype, property }) => `
    <details open>
      <summary><dt>${name}${type === 'function' ? '()' : ''}</dt></summary>
      ${prototype
        .map(
          ({ name, descriptor }) => `
      <dd>${name}${typeof descriptor.value === 'function' ? '()' : ''}</dd>
      `
        )
        .join('')}
      ${property
        .map(
          ({ name, descriptor }) => `
      <dd>${name}${typeof descriptor.value === 'function' ? '()' : ''}</dd>
      `
        )
        .join('')}
    </details>
  `
  )
  .join('');

document.head.appendChild(style);
document.body.appendChild(template);
