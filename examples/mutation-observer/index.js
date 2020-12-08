const template = document.createElement('div');
template.innerHTML = `
    <div><button id="add">Add Item</button></div>
    <textarea id="log" readonly style="width: 100%; ox-sizing: border-box; height: 200px; overflow: auto"></textarea>
    <ol id="list"></ol>
`;
document.body.appendChild(template);

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
