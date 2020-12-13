/* eslint-disable no-script-url */
const style = document.createElement('style');
style.textContent = `
  table {display: block; border-collapse: collapse;}
  td {border: 1px solid #888; padding: 0.5em;}
  .result {width: 100px;}
  .pass {background-color: green;}
  .fail {background-color: red;}
  #row {display: none;}
  iframe {width: 20px; height: 20px;}
  .payload img {max-width: 64px; max-height: 64px}
`;
document.head.appendChild(style);

document.body.innerHTML = `
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
    fn(row.querySelector('.payload'));
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
  true
);

runTest(
  ['innerHTML', 'a.href', 'JavaScript:', 'xss'],
  el => {
    el.innerHTML = `<a href="JavaScript:alert('$xss')">link</a>`;
  },
  true
);

runTest(
  ['innerHTML', 'a.HREF', 'javascript:', 'xss'],
  el => {
    el.innerHTML = `<a HREF="javascript:alert('$xss')">link</a>`;
  },
  true
);

runTest(
  ['innerHTML', 'img.src', 'javascript:', 'xss'],
  el => {
    el.innerHTML = `<img src="javascript:alert('$xss')" />`;
  },
  true
);

runTest(
  ['innerHTML', 'img.onerror', 'xss'],
  el => {
    el.innerHTML = `<img onerror="alert('$xss')" />`;
  },
  true
);

runTest(
  ['innerHTML', 'img.onError', 'xss'],
  el => {
    el.innerHTML = `<img onError="alert('$xss')" />`;
  },
  true
);

runTest(
  ['innerHTML', 'form.action', 'javascript:', 'xss'],
  el => {
    el.innerHTML = `<form action="javascript:alert('$xss')"></form>`;
  },
  true
);

runTest(
  ['innerHTML', 'iframe.src', 'xss'],
  el => {
    el.innerHTML = `<iframe src="javascript:alert('$xss')"></iframe>`;
  },
  true
);

runTest(
  ['innerHTML', 'iframe.srcdoc', 'xss'],
  el => {
    el.innerHTML = `<iframe srcdoc="&lt;script&gt;alert('$xss')&lt;/script&gt;"></iframe>`;
  },
  true
);

// runTest(
//   ['location'],
//   () => {
//     location.hash = `${location.hash}#/safe`;
//   },
//   false
// );

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
