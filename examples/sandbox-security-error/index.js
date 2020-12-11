const testList = [
  `<script>alert('$xss')</script>`,
  `<script type="text/javascript">alert('$xss')</script>`,
  `<script type="text/ecmascript">alert('$xss')</script>`,
  `<script type="application/javascript">alert('$xss')</script>`,
  `<script type="module">alert('$xss')</script>`,
  `<script type="text/html">alert('$xss')</script>`,
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
  `<iframe SRCDOC="&lt;script&gt;alert('$xss')&lt;/script&gt;"></iframe>`
];

testList.forEach((html, index) => {
  html = html.replace(`$xss`, `${index}: xss`);
  const target = document.createElement('div');
  const log = document.createElement('div');

  document.body.appendChild(log);
  document.body.appendChild(target);

  try {
    target.dataset.test = index;
    target.innerHTML = html;
    log.textContent = `${index}: Successful: ${html}`;
  } catch (error) {
    log.textContent = `${index}: Error: ${error.message}`;
  }
});
