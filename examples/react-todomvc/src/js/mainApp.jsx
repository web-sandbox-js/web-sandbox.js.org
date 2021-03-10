import React from 'react';
import TodoModel from './todoModel.js';
import TodoApp from './todoApp.jsx';
import '../css/index.css';

(function() {
  'use strict';

  const model = new TodoModel('react-todos');

  function render() {
  	React.render(
  		<TodoApp model={model}/>,
  		document.body.getElementsByClassName('todo-appmvc')[0]
  	);
  }

  model.subscribe(render);
  render();
})();
