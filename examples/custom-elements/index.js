document.body.innerHTML = `<my-element name="hello"></my-element>`;

class MyElement extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    const changeNameButton = document.createElement('button');
    changeNameButton.textContent = 'changeName()';
    changeNameButton.addEventListener('click', () => {
      this.changeName();
    });
    this.shadowRoot.appendChild(changeNameButton);
  }

  changeName() {
    this.name = Math.random()
      .toString(36)
      .slice(-6);
  }

  get name() {
    return this.getAttribute('name');
  }

  set name(value) {
    this.setAttribute('name', value);
  }

  connectedCallback() {
    const element = document.createElement('p');
    element.textContent = `connectedCallback`;
    this.shadowRoot.appendChild(element);
  }

  adoptedCallback() {
    const element = document.createElement('p');
    element.textContent = `adoptedCallback`;
    this.shadowRoot.appendChild(element);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    const element = document.createElement('p');
    element.textContent = `attributeChanged: name ${name}; oldValue ${oldValue}; newValue ${newValue}`;
    this.shadowRoot.appendChild(element);
  }

  static get observedAttributes() {
    return ['name'];
  }
}
customElements.define('my-element', MyElement);
