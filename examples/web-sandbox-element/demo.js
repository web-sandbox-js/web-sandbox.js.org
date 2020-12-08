document.body.id = 'sandbox-demo';
const element = document.createElement('p');
element.id = 'vh';
element.innerHTML = `demo loaded! <slot name="slot-demo"><p>默认文本</p></slot>`;
document.body.appendChild(element);

const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = '/examples/web-sandbox-element/demo.css';
document.head.appendChild(link);

const template = document.createElement('template');
template.innerHTML = `
<style>
::slotted(div) {
  color: #FFF;
  background-color: #666;
  padding: 5px;
}
</style>
<div class="tab-labels"><slot name="tab-label"></slot></div>
<p class="tab-contents"><slot name="tab-content"></slot></p>
`;

// console.log(template);
document.body.appendChild(template.content.cloneNode(true));

const script = document.createElement('script');
script.src = `/examples/web-sandbox-element/sub.js?v=${window.name}`;
window.ENV = { debug: true };
document.body.appendChild(script);

try {
  document.createElement(' s sf f');
} catch (e) {
  window.error = e;
  // console.error(e);
}

document.body.className = 'aaa bbb cc dd';
document.body.setAttribute('style', 'color: red');

window.__demo__ = true;

const btn = document.createElement('nav');
btn.innerHTML = 'click';
btn.onclick = function() {
  console.log(this, 'click');
};
btn.addEventListener('click', () => {
  console.log('click', this);
});
document.body.appendChild(btn);

console.log('document.body >>>', document.body);

const nav = document.createElement('nav-ssssss');
document.body.appendChild(nav);
