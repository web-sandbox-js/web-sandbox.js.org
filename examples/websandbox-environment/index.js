const getFeatures = window => {
  const esIgnore = name => {
    if (typeof name !== 'string') {
      return true;
    }
    return [
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
    ].includes(name);
  };
  const webkitIgnore = name => {
    if (typeof name !== 'string') {
      return true;
    }
    return /webkit/i.test(name);
  };
  const instanceIgnore = name => {
    if (typeof name !== 'string') {
      return true;
    }
    return (
      ['window', 'self', 'document', 'globalThis'].includes(name) ||
      webkitIgnore(name)
    );
  };
  const staticIgnore = name => {
    if (typeof name !== 'string') {
      return true;
    }
    return (
      ['length', 'arguments', 'caller', 'prototype', 'name'].includes(name) ||
      webkitIgnore(name)
    );
  };
  const prototypeIgnore = name => {
    if (typeof name !== 'string') {
      return true;
    }
    return ['constructor'].includes(name) || webkitIgnore(name);
  };
  const byName = function(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return 0;
    }

    const nameA = a.toUpperCase();
    const nameB = b.toUpperCase();
    if (nameA < nameB) {
      return -1;
    }
    if (nameA > nameB) {
      return 1;
    }
    return 0;
  };
  const isClass = value =>
    typeof value === 'function' && /^[A-Z]/.test(value.name);

  const features = {};

  Reflect.ownKeys(window)
    .filter(name => !esIgnore(name) && !instanceIgnore(name))
    .sort(byName)
    .forEach(name => {
      const value = window[name];
      if (isClass(value)) {
        features[name] = {
          prototype: Reflect.ownKeys(value.prototype || {})
            .filter(name => !prototypeIgnore(name))
            .sort(byName),
          static: Reflect.ownKeys(value || {})
            .filter(name => !staticIgnore(name))
            .sort(byName)
        };
      }
    });

  return features;
};

const render = features => {
  const document = window.document;
  const style = document.createElement('style');
  style.textContent = `
    details {
        margin-bottom: 1rem;
        font-size: 14px;
    }
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
    summary {
        font-weight: bold;
    }
    summary::after {
        content: '';
        position: absolute;
        width: 12px; height: 12px;
        margin: 4px 0 0 .5ch;
        background: url(/examples/websandbox-environment/arrow-on.svg) no-repeat;
        background-size: 100% 100%;
        transition: transform .2s;
    }
    [open] summary::after {
        transform: rotate(90deg);
    }
    dd {
        margin: 0 0 0 1em;
    }
    `;

  const template = document.createElement('div');
  template.innerHTML = Object.entries(features)
    .map(
      ([name, value]) => `
      <details open>
        <summary>${name}</summary>
        <ul>
        ${value.prototype.map(name => `<li>${name}</li>`).join('')}
        ${value.static.map(name => `<li>#${name}</li>`).join('')}
        </ul>
      </details>
    `
    )
    .join('');
  document.head.appendChild(style);
  document.body.appendChild(template);
};

render(getFeatures(window));
