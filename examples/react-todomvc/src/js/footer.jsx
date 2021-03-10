import React from "react";
import Utils from "./utils.js";

const ALL_TODOS = 'all';
const ACTIVE_TODOS =  'active';
const COMPLETED_TODOS = 'completed';

let TodoFooter = React.createClass({
  render: function () {
    var activeTodoWord = Utils.pluralize(this.props.count, 'item');
    var clearButton = null;

    if (this.props.completedCount > 0) {
      clearButton = (
        <div
          className="clear-completed"
          onClick={this.props.onClearCompleted}>
          Clear completed
        </div>
      );
    }

    var nowShowing = this.props.nowShowing;
    var originClassName = nowShowing === ALL_TODOS? 'selected': '';
    var activeClassName = nowShowing === ACTIVE_TODOS ? 'selected': '';
    var completedClassName =  nowShowing === COMPLETED_TODOS? 'selected': '';
    return (
      <footer className="footer">
        <span className="todo-count">
          <strong>{this.props.count}</strong> {activeTodoWord} left
        </span>
        <ul className="filters">
          <li
              onClick={() => {this.props.onChangeRouter(ALL_TODOS)}}
              className={originClassName}>
                All
          </li>
          {' '}
          <li
              onClick={() => {this.props.onChangeRouter(ACTIVE_TODOS)}}
              className={activeClassName}>
                Active
          </li>
          {' '}
          <li
              onClick={() => {this.props.onChangeRouter(COMPLETED_TODOS)}}
              className={completedClassName}>
                Completed
          </li>
        </ul>
        {clearButton}
      </footer>
    );
  }
});

export default TodoFooter;
