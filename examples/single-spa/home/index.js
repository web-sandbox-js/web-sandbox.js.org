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
        style.textContent = `body { color: red }`;
        template = document.createElement('div');
        template.textContent = `Examples: singleSpa & WebSandbox`;
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
