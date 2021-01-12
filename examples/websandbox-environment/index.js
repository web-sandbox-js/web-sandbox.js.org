importScript('/examples/websandbox-environment/get-global-features.js').then(
  getGlobalFeatures => {
    render(getGlobalFeatures(window));
  }
);

function importScript(url) {
  if (typeof module !== 'object') {
    window.exports = {};
    window.module = { exports };
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.addEventListener('load', () => {
      resolve(window.module.exports);
    });
    script.addEventListener('error', e => {
      reject(e);
    });
    script.src = url;
    document.head.appendChild(script);
  });
}

function render(features) {
  const document = window.document;
  const style = document.createElement('style');
  style.textContent = `
    details {
        margin-bottom: 1rem;
        font-size: 14px;
    }
    ::-webkit-details-marker {
        display: none;
    }
    ::-moz-list-bullet {
        font-size: 0;
        float: left;
    }
    summary {
        -webkit-user-select: none;
        -moz-user-select: none;
        -ms-user-select: none;
        user-select: none;
        outline: 0;
    }
    summary[focus] {
        outline: 1px dotted;
        outline: 5px auto -webkit-focus-ring-color;
    }
    summary {
        font-weight: bold;
    }
    summary::after {
        content: '';
        position: absolute;
        width: 12px; height: 12px;
        margin: 4px 0 0 .5ch;
        background: url(/examples/websandbox-environment/arrow-on.svg) no-repeat;
        background-size: 100% 100%;
        transition: transform .2s;
    }
    [open] summary::after {
        transform: rotate(90deg);
    }
    dd {
        margin: 0 0 0 1em;
    }
    `;

  const template = document.createElement('div');
  template.innerHTML = Object.entries(features)
    .map(
      ([name, value]) => `
      <details open>
        <summary>${name}</summary>
        <ul>
        ${(value.properties || []).map(name => `<li>${name}</li>`).join('')}
        ${(value.prototype || []).map(name => `<li>${name}</li>`).join('')}
        ${(value.static || []).map(name => `<li>#${name}</li>`).join('')}
        </ul>
      </details>
    `
    )
    .join('');
  document.head.appendChild(style);
  document.body.appendChild(template);
}
