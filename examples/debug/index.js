console.log('debug...');

try {
  document.createElement('#error1');
} catch (error) {
  debugger;
  document.createElement('#error2');
}
