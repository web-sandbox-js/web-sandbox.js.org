document.body.innerHTML = `
  <div class="dddd">
    <button>click</button>  
  </div>
  <script>console.log("typeof alert", typeof alert)</script>
  你好  
`;

console.log(document.querySelector('.dddd'));
