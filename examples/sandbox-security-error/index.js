try {
    document.body.innerHTML = `<img onerror="alert('xss')" />`;
} catch(error) {
    document.body.innerHTML = error;
    console.error(error);
    debugger;
}

