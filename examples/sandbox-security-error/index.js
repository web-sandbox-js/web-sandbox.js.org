const testList = [
  `<h3>tag is sandboxed</h3>`,
  `<img src="/examples/canvas/december-holidays-days-2-30-6753651837108830.3-law.png">`,
  `<script>alert('$xss')</script>`,
  `<script type="text/javascript">alert('$xss')</script>`,
  `<script type="text/ecmascript">alert('$xss')</script>`,
  `<script type="application/javascript">alert('$xss')</script>`,
  `<script type="module">alert('$xss')</script>`,
  `<script type="text/html">alert('$xss')</script>`,
  `<script>
    const el = document.createElement('h3');
    el.textContent = 'script is sandboxed';
    document.body.appendChild(el);
  </script>`,
  `<a href="javascript:alert('$xss')">link</a>`,
  `<a href=" javascript:alert('$xss') ">link</a>`,
  `<a HREF="javascript:alert('$xss')">link</a>`,
  `<a HREF="JavaScript:alert('$xss')">link</a>`,
  `<a HREF=" JavaScript:alert('$xss') ">link</a>`,
  `<img src="javascript:alert('$xss')" />`,
  `<form action="javascript:alert('$xss')"></form>`,
  `<img onerror="alert('$xss')" />`,
  `<img onError=" alert('$xss') " />`,
  `<IMG ONERROR="alert('$xss')" />`,
  `<iframe src="javascript:alert('$xss')"></iframe>`,
  `<iframe srcdoc="&lt;script&gt;alert('$xss')&lt;/script&gt;"></iframe>`,
  `<iframe SRCDOC="&lt;script&gt;alert('$xss')&lt;/script&gt;"></iframe>`,
  () => {
    location.href = `javascript:alert('$xss')`;
  },
  () => {
    location.protocol = `javascript:`;
  },
  () => {
    location.assign(`javascript:alert('$xss')`);
  },
  () => {
    location.replace(`javascript:alert('$xss')`);
  },
  () => {
    location.href = '#safe';
    const el = document.createElement('h3');
    el.textContent = 'location is sandboxed';
    document.body.appendChild(el);
  }
];

testList.forEach((test, index) => {
  const target = document.createElement('div');
  const log = document.createElement('div');

  target.setAttribute('html', index);
  log.setAttribute('log', index);

  document.body.appendChild(log);
  document.body.appendChild(target);

  try {
    if (typeof test === 'string') {
      test = test.replace(`$xss`, `${index}: xss`);
      target.innerHTML = test;
      log.textContent = `${index}: Successful: ${test}`;
    } else {
      test();
      log.textContent = `${index}: Successful: ${test.toString()}`;
    }
  } catch (error) {
    log.textContent = `${index}: Error: ${error.name}: ${error.message}`;
  }
});
