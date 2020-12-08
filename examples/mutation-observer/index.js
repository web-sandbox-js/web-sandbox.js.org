const template = `
    <p>Log:</p>
    <textarea id="log" readonly style="width: 100%; ox-sizing: border-box; height: 100px; overflow: auto"></textarea>
    <div><button id="add">Add Node</button></div>
    <ol id="list"></ol>
`;
document.body.innerHTML = template;

document.querySelector('#add').addEventListener('click', () => {
  const li = document.createElement('li');
  li.textContent = `ITEM: ${Math.random()}`;
  document.querySelector('#list').appendChild(li);
});

/** ----------------------------------- */

const observer = new MutationObserver(function(records) {
  console.log(records);
  records.forEach(function(record) {
    document.querySelector(
      '#log'
    ).textContent += `${new Date()} Mutation type: ${
      record.type
    }; Mutation target: ${record.target}\n`;
  });
});

observer.observe(document.querySelector('#list'), {
  childList: true,
  subtree: true,
  attributes: true
});
