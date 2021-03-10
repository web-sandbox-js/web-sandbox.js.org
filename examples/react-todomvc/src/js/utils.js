const Utils = {
  uuid() {
    /* jshint bitwise:false */
    let i, random;
    let uuid = '';

    for (i = 0; i < 32; i++) {
      random = (Math.random() * 16) | 0;
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        uuid += '-';
      }
      uuid += (i === 12 ? 4 : i === 16 ? (random & 3) | 8 : random).toString(
        16
      );
    }

    return uuid;
  },

  pluralize(count, word) {
    return count === 1 ? word : `${word}s`;
  },

  store(namespace, data) {
    if (data) {
      return localStorage.setItem(namespace, JSON.stringify(data));
    }

    const store = localStorage.getItem(namespace);
    return (store && JSON.parse(store)) || [];
  },

  extend() {
    const newObj = {};
    for (let i = 0; i < arguments.length; i++) {
      const obj = arguments[i];
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          newObj[key] = obj[key];
        }
      }
    }
    return newObj;
  }
};

export default Utils;
