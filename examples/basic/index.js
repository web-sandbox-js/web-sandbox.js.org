const button = document.createElement('button');
button.textContent = 'Click Me';
button.addEventListener('click', () => {
  const hello = document.createElement('p');
  hello.innerHTML = `Hello WebSandbox`;
  document.body.appendChild(hello);
});
document.body.appendChild(button);

const style = document.createElement('style');
style.textContent = `body { color: #003cb1 }`;
document.head.appendChild(style);
