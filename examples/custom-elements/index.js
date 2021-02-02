document.body.innerHTML = `
  <h2>examples1</h2>
  <my-element name="hello"></my-element>
  <h2>examples2</h2>
  <ul is="expanding-list">
      <li>UK
          <ul>
              <li>Yorkshire
                  <ul>
                      <li>Leeds
                          <ul>
                              <li>Train station</li>
                              <li>Town hall</li>
                              <li>Headrow</li>
                          </ul>
                      </li>
                      <li>Bradford</li>
                      <li>Hull</li>
                  </ul>
              </li>
          </ul>
      </li>
      <li>USA
          <ul>
              <li>California
                  <ul>
                      <li>Los Angeles</li>
                      <li>San Francisco</li>
                      <li>Berkeley</li>
                  </ul>
              </li>
              <li>Nevada</li>
              <li>Oregon</li>
          </ul>
      </li>
  </ul>
`;

function importScript(url) {
  const script = document.createElement('script');
  script.src = url;
  document.head.appendChild(script);
}

importScript('/examples/custom-elements/my-element.js');
importScript('/examples/custom-elements/expanding-list.js');
