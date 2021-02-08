document.body.innerHTML = `
  <div id="ball"></div>
  <div id="box" title="Chilk Me"></div>
  <style>
    #ball {
      width: 32px;
      height: 32px;
      border-radius: 32px;
      position: absolute;
      left: 0px;
      top: 0px;
      background: #003cb1;
      transition: left 0.3s, top 0.3s;
    }
    #box {
      width: 100%;
      height: 300px;
      background: #fafbfc;
    }
  </style>
`;

const ball = document.getElementById('ball');
const box = document.getElementById('box');
box.addEventListener('mousedown', function(e) {
  const moveX = e.clientX;
  const moveY = e.clientY;
  ball.style.left = `${moveX}px`;
  ball.style.top = `${moveY}px`;
});
