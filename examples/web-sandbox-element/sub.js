console.log(this.window);
(() => {
  console.log('sandbox script');
  const x = document.createElement('p');
  x.innerHTML = '我是沙盒内的 script[src="./sub.js"] 插入的内容';
  document.body.appendChild(x);

  console.log(window.name, '<<<<<<');

  console.log(alert);

  console.log('ENV', ENV);

  window.__sub__ = true;
})();
