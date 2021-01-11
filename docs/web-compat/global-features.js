(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? (module.exports = factory())
    : typeof define === 'function' && define.amd
    ? define(factory)
    : ((global = global || self), (global.globalFeatures = factory()));
})(this, function() {
  const isEs = name =>
    [
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
  const isWebkit = name => /webkit/i.test(name);
  const isIgnoreInstance = name =>
    [
      '0',
      'window',
      'self',
      'parent',
      'top',
      'frames',
      'document',
      'globalThis'
    ].includes(name) || isWebkit(name);
  const isIgnoreStatic = name =>
    ['length', 'arguments', 'caller', 'prototype', 'name'].includes(name) ||
    isWebkit(name);
  const isIgnorePropertie = name =>
    ['constructor'].includes(name) || isWebkit(name);

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

  return window => {
    const features = {};
    Object.getOwnPropertyNames(window)
      .filter(name => !isEs(name) && !isIgnoreInstance(name))
      .sort(byName)
      .forEach(name => {
        const value = window[name];
        const type = Object.prototype.toString
          .call(value)
          .slice(8, -1)
          .toLowerCase();

        features[name] = { type };

        if (type === 'function') {
          features[name].prototype = Object.getOwnPropertyNames(
            value.prototype || {}
          )
            .filter(name => !isIgnorePropertie(name))
            .sort(byName);

          features[name].static = Object.getOwnPropertyNames(value || {})
            .filter(name => !isIgnoreStatic(name))
            .sort(byName);
        } else if (type === 'object') {
          features[name].properties = Object.getOwnPropertyNames(value || {})
            .filter(name => !isIgnorePropertie(name))
            .sort(byName);
        }
      });

    return features;
  };
});
