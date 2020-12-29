/* eslint-disable */
document.body.innerHTML = `
  <style>
    table {display: block; border-collapse: collapse;}
    td {border: 1px solid #888; padding: 0.5em;}
    .result {width: 100px;}
    .pass {background-color: green;}
    .fail {background-color: red;}
    #row {display: none;}
    .payload * {max-width: 64px; max-height: 64px; overflow: hidden}
  </style>
  <h1>WebSandbox Security Test</h1>
  <table>
    <thead>
      <tr>
        <th>Test case</th>
        <th>Name</th>
        <th>Payload</th>
        <th>Result</th>
      </tr>
    </thead>
    <tbody id=table>
      <tr id="row">
        <td class=id></td>
        <td class=name></td>
        <td class=payload></td>
        <td class=result>&nbsp;</td>
      </tr>
    </tbody>
  </table>
`;

let testNumber = 0;

function runTest(names, fn, shouldThrow) {
  let row;
  try {
    row = document.getElementById('row').cloneNode(true);
    row.id = '';
    document.getElementById('table').appendChild(row);
    row.querySelector('.id').innerText = ++testNumber;
    row.querySelector('.name').innerText = names.join(' ');
    row.querySelector('.name').title = fn.toString();
    fn(row.querySelector('.payload'));
    row.querySelector('.payload').title = row.querySelector('.payload').innerHTML;
    row.querySelector('.result').className += shouldThrow ? ' fail' : ' pass';
  } catch (e) {
    row.querySelector('.result').className += !shouldThrow ? ' fail' : ' pass';
    console.error(names, e);
  }
}

runTest(
  ['innerHTML', 'tag'],
  el => {
    el.innerHTML = `<h3>sandboxed</h3>`;
  },
  false
);

runTest(
  ['innerHTML', 'tag', 'img'],
  el => {
    el.innerHTML = `<img src="/examples/canvas/december-holidays-days-2-30-6753651837108830.3-law.png">`;
  },
  false
);

runTest(
  ['innerHTML', 'script'],
  el => {
    window.$sandbox_payload = time => {
      setTimeout(() => {
        el.innerHTML = '<h3>sandboxed</h3>';
      }, time);
    };
    el.innerHTML = `<script>window.$sandbox_payload(200)</script>`;
  },
  false
);

runTest(
  ['innerHTML', 'script', 'xss'],
  el => {
    el.innerHTML = `<script>alert('$xss')</script>`;
  },
  false
);

runTest(
  ['innerHTML', 'script[type="text/javascript"]', 'xss'],
  el => {
    el.innerHTML = `<script type="text/javascript">alert('$xss')</script>`;
  },
  false
);

runTest(
  ['innerHTML', 'script[type="text/JavaScript"]', 'xss'],
  el => {
    el.innerHTML = `<script type="text/JavaScript">alert('$xss')</script>`;
  },
  false
);

runTest(
  ['innerHTML', 'script[type="text/ecmascript"]', 'xss'],
  el => {
    el.innerHTML = `<script type="text/ecmascript">alert('$xss')</script>`;
  },
  false
);

runTest(
  ['innerHTML', 'script[type="application/javascript"]', 'xss'],
  el => {
    el.innerHTML = `<script type="application/javascript">alert('$xss')</script>`;
  },
  false
);

runTest(
  ['innerHTML', 'script[type="module"]', 'xss'],
  el => {
    el.innerHTML = `<script type="module">alert('$xss')</script>`;
  },
  false
);

runTest(
  ['innerHTML', 'script[type="text/html"]'],
  el => {
    el.innerHTML = `<script type="text/html">alert('$xss')</script>`;
  },
  false
);

runTest(
  ['innerHTML', 'a.href', 'javascript:', 'xss'],
  el => {
    el.innerHTML = `<a href="javascript:alert('$xss')">link</a>`;
  },
  false
);

runTest(
  ['innerHTML', 'a.href', 'JavaScript:', 'xss'],
  el => {
    el.innerHTML = `<a href="JavaScript:alert('$xss')">link</a>`;
  },
  false
);

runTest(
  ['innerHTML', 'a.HREF', 'javascript:', 'xss'],
  el => {
    el.innerHTML = `<a HREF="javascript:alert('$xss')">link</a>`;
  },
  false
);

runTest(
  ['innerHTML', 'img.src', 'javascript:', 'xss'],
  el => {
    el.innerHTML = `<img src="javascript:alert('$xss')" />`;
  },
  false
);

runTest(
  ['innerHTML', 'img.onerror', 'xss'],
  el => {
    el.innerHTML = `<img onerror="alert('$xss')" />`;
  },
  false
);

runTest(
  ['innerHTML', 'img.onError', 'xss'],
  el => {
    el.innerHTML = `<img onError="alert('$xss')" />`;
  },
  false
);

runTest(
  ['innerHTML', 'form.action', 'javascript:', 'xss'],
  el => {
    el.innerHTML = `<form action="javascript:alert('$xss')"></form>`;
  },
  false
);

runTest(
  ['innerHTML', 'iframe.src', 'xss'],
  el => {
    el.innerHTML = `<iframe src="javascript:alert('$xss')"></iframe>`;
  },
  false
);

runTest(
  ['innerHTML', 'iframe.srcdoc', 'xss'],
  el => {
    el.innerHTML = `<iframe srcdoc="&lt;script&gt;alert('$xss')&lt;/script&gt;"></iframe>`;
  },
  false
);

runTest(
  ['innerHTML', 'object.data', 'xss'],
  el => {
    el.innerHTML = `<object type="application/pdf" data="javascript:alert('$xss')" width="64" height="64"></object>`;
  },
  false
);

runTest(
  ['innerHTML', 'input.formaction', 'xss'],
  el => {
    el.innerHTML = `<button formaction="javascript:alert('$xss')">submit</button>`;
  },
  false
);

runTest(
  ['innerHTML', 'video.poster', 'xss'],
  el => {
    el.innerHTML = `<video controls poster="javascript:alert('$xss')" width="64" height="64">
    <source src="movie.mp4" type="video/mp4">
    <source src="movie.ogg" type="video/ogg">
    Your browser does not support the video tag.
 </video> `;
  },
  false
);

runTest(
  ['innerHTML', 'noscript', 'xss'],
  el => {
    el.innerHTML = `
      <b><noscript><a alt="</noscript><img src=x onerror=alert('$xss')>"></noscript>
    `;
  },
  false
);

runTest(
  ['innerHTML', 'math', 'xss'],
  el => {
    el.innerHTML = `
      <form><math><mtext></form><form><mglyph><style><img src=x onerror=alert('$xss')>
    `;
  },
  false
);

runTest(
  ['outerHTML', 'xss'],
  el => {
    el = el.appendChild(document.createElement('div'));
    el.outerHTML = `<script>alert('$xss')</script>`;
  },
  false
);

runTest(
  ['template', 'cloneNode', 'xss'],
  el => {
    const template = document.createElement('template');
    template.innerHTML = `
      <img onerror="alert('$xss')" />
      <a href="javascript:alert('$xss')">link</a>
      <script>alert('$xss: cloneNode')</script>
    `;
    el.appendChild(template.content.cloneNode(true));
  },
  false
);

runTest(
  ['location'],
  () => {
    location.hash = `${location.hash}#/safe`;
  },
  false
);

runTest(
  ['location', 'href', 'xss'],
  () => {
    location.href = `javascript:alert('$xss')`;
  },
  true
);

runTest(
  ['location', 'protocol', 'xss'],
  () => {
    location.protocol = `javascript:`;
  },
  true
);

runTest(
  ['location', 'assign()', 'xss'],
  () => {
    location.assign(`javascript:alert('$xss')`);
  },
  true
);

runTest(
  ['location', 'replace()', 'xss'],
  () => {
    location.replace(`javascript:alert('$xss')`);
  },
  true
);

runTest(
  ['Function', 'xss'],
  () => {
    new Function(`alert('$xss')`)();
  },
  true
);

runTest(
  ['eval', 'xss'],
  () => {
    const e = 'eval';
    window[e](`alert('$xss')`)();
  },
  true
);

runTest(
  ['Object', 'constructor.constructor', 'xss'],
  () => {
    ({}.constructor.constructor(`alert('$xss')`)());
  },
  true
);

runTest(
  ['Function', 'eval', 'xss'],
  () => {
    new Function(`window['ev' + 'al']("alert('$xss')")`)();
  },
  true
);

runTest(
  ['localStorage'],
  el => {
    const PARENT_VALUE = 'parent-value';
    const CHILD_VALUE = 'child-value';

    localStorage.test = PARENT_VALUE;

    const sandbox = document.createElement('web-sandbox');
    sandbox.name = 'child2';
    sandbox.srcdoc = `
      localStorage.test = ${JSON.stringify(CHILD_VALUE)};
    `;

    el.appendChild(sandbox);

    if (localStorage.test !== PARENT_VALUE) {
      throw new Error(`parent: Local storage is contaminated`);
    }

    // if (sandbox.contentWindow.localStorage.test !== CHILD_VALUE) {
    //   throw new Error(`child: Local storage is contaminated`);
    // }
  },
  false
);
