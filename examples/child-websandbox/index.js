document.body.innerHTML = `
  <web-sandbox
    src="/examples/vue-todomvc/index.js"
    csp="
      default-src 'none';
      script-src 'self' 'unsafe-inline' 'unsafe-eval';
      style-src 'self' 'unsafe-inline';
      navigate-to 'self' google.com web-sandbox.js.org;
    ">
  </web-sandbox>
  <a href="https://google.com">google</a>
  <a href="https://web-sandbox.js.org">web-sandbox</a>
`;

const sandbox = document.querySelector('web-sandbox');
sandbox.evaluate(
  (() => {
    const nav = document.createElement('nav');
    nav.innerHTML = `
    <a href="https://google.com">google</a>
    <a href="https://web-sandbox.js.org">web-sandbox</a>
  `;
    document.body.appendChild(nav);
  }).toString()
);
