const div = document.createElement('div');
document.body.appendChild(div);
div.innerHTML = `
  <div on:click="alert('xss')"></div>
`;

const div1 = document.createElement('div');
document.body.appendChild(div1);
div1.innerHTML = `
  <script>alert('xss')</script>
`;

const div2 = document.createElement('div');
document.body.appendChild(div2);
div2.innerHTML = `
  <img src="./404" onerror="alert('xss')" />
`;
