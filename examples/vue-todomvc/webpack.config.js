const path = require('path');
const fs = require('fs');
const VueLoaderPlugin = require('vue-loader/lib/plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

function copyFile(src, dist) {
  fs.writeFileSync(dist, fs.readFileSync(src));
}

class DonePlugin {
  // eslint-disable-next-line class-methods-use-this
  apply(compiler) {
    compiler.hooks.done.tap('Hello World Plugin', stats => {
      copyFile(
        path.resolve(
          __dirname,
          '../..',
          'node_modules/vue/dist/vue.runtime.min.js'
        ),
        path.resolve(__dirname, 'dist/vue.runtime.js')
      );
    });
  }
}

module.exports = {
  mode: 'production',
  target: 'web',
  externals: {
    vue: 'Vue'
  },
  entry: {
    app: path.resolve(__dirname, 'src/index.js')
  },
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js'
  },
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader'
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      }
    ]
  },
  plugins: [
    new VueLoaderPlugin(),
    new MiniCssExtractPlugin({
      filename: 'app.css'
    }),
    new DonePlugin()
  ]
};
