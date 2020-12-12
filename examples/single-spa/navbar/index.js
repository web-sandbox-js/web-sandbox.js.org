(function(global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined'
    ? (module.exports = factory())
    : typeof define === 'function' && define.amd
    ? define(factory)
    : ((global = global || self), (global.Realm = factory()));
})(this, function() {
  let style, template;
  return {
    bootstrap: function bootstrap(props) {
      return Promise.resolve().then(() => {
        style = document.createElement('style');
        style.textContent = `nav { color: #000 }`;
        template = document.createElement('nav');
        template.innerHTML = `
        <a href="#/home">home</a>
        |
        <a href="#/sandbox-window-api">sandbox-window-api</a>
        |
        <a href="#/vue-todomvc">vue-todomvc</a>
        `;
      });
    },
    mount: function mount(props) {
      return Promise.resolve().then(() => {
        document.head.appendChild(style);
        document.body.appendChild(template);
      });
    },
    unmount: function unmount(props) {
      return Promise.resolve().then(() => {
        document.head.removeChild(style);
        document.body.removeChild(template);
      });
    }
  };
});
