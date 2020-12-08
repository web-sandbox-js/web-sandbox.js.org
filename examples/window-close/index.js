const number = document.createElement('strong');
document.body.appendChild(number);

setInterval(() => {
  number.textContent = Math.random();
}, 500);
