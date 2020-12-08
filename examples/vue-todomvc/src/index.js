import Vue from 'vue';
import App from './App.vue';

// eslint-disable-next-line no-new
new Vue({
  el: '#app',
  components: { App },
  render: h => {
    return h(App);
  }
});
