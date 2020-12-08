const style = document.createElement('style');
style.textContent = `html { color: red }`;
document.head.appendChild(style);

const hello = document.createElement('h1');
hello.innerHTML = `hello world`;
document.body.appendChild(hello);
