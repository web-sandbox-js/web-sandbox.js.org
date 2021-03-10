const path = require('path');
const fs = require('fs');

function copyFile(src, dist) {
  fs.writeFileSync(dist, fs.readFileSync(src));
}

class DonePlugin {
  // eslint-disable-next-line class-methods-use-this
  apply(compiler) {
    compiler.hooks.done.tap('copyFile', () => {
      copyFile(
        path.resolve(
          __dirname,
          '../..',
          'node_modules/react/dist/react.min.js'
        ),
        path.resolve(__dirname, 'dist/react.min.js')
      );
    });
  }
}

module.exports = {
  mode: 'production',
  entry: './src/js/mainApp.jsx',
  externals: {
    react: 'React'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bundle.js'
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-react']
            }
          }
        ]
      },
      {
        test: /\.css$/,
        use: [
          {
            loader: 'style-loader'
          },
          {
            loader: 'css-loader'
          }
        ]
      }
    ]
  },
  plugins: [new DonePlugin()]
};
