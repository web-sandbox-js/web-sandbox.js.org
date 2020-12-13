const sandbox = document.createElement('web-sandbox');
sandbox.sandbox = '';
sandbox.name = 'sub-sandbox';
sandbox.src = '/examples/sandbox-attr/links.js';
document.body.appendChild(sandbox);

const sandbox2 = document.createElement('web-sandbox');
sandbox2.sandbox = 'allow-top-navigation allow-import-scripts';
sandbox2.name = 'sub-sandbox';
sandbox2.src = '/examples/sandbox-attr/links.js';
document.body.appendChild(sandbox2);
