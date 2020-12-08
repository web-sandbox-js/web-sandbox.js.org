const callback = function(event) {
  console.log(event.composedPath());
  event.stopPropagation();
  event.preventDefault();
  const target = event.target;
  console.log(target);
  const elem = document.createElement('p');
  elem.innerHTML = 'chicked';
  document.body.appendChild(elem);
  window.setTimeout(() => {
    console.log(event.target);
  }, 1000);
};

const add = document.createElement('button');
add.innerHTML = 'addEventListener';
add.addEventListener('click', function(event) {
  document.addEventListener('click', callback);
});
document.body.appendChild(add);

const remove = document.createElement('button');
remove.innerHTML = 'removeEventListener';
remove.addEventListener('click', function(event) {
  document.removeEventListener('click', callback);
});
document.body.appendChild(remove);

const log = document.createElement('span');
const input = document.createElement('input');
document.body.appendChild(input);
document.body.appendChild(log);
input.addEventListener('input', function(event) {
  log.textContent = event.target.value;
});

window.addEventListener('DOMContentLoaded', function(event) {
  console.log('DOMContentLoaded');
  console.log(event);
  console.log(this);
});
