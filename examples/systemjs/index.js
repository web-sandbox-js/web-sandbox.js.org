const importmap = document.createElement('script');
importmap.type = 'systemjs-importmap';
importmap.textContent = `{
  "imports": {
    "neptune": "/examples/systemjs/neptune.js"
  }
}`;
document.body.appendChild(importmap);

const app = document.createElement('script');
app.type = 'systemjs-module';
app.src = 'import:neptune';
document.body.appendChild(app);

const loader = document.createElement('script');
loader.src = '/examples/systemjs/dist/s.min.js';
document.body.appendChild(loader);
