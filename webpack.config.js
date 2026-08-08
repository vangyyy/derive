const path = require('path');
const webpack = require('webpack');

module.exports = (env, argv) => ({
    entry: './src/app.js',
    // Only bundle.js is published, so no external map in production builds.
    devtool: argv.mode === 'production' ? false : 'eval-source-map',
    output: {
        path: __dirname,
        filename: 'bundle.js'
    },
    resolve: {
        // skiz-parser pulls in Node core modules; only the in-memory code
        // paths are reachable in the browser.
        fallback: {
            fs: false,
            assert: require.resolve('assert/'),
            buffer: require.resolve('buffer/'),
            events: require.resolve('events/'),
            stream: require.resolve('stream-browserify'),
            util: require.resolve('util/'),
            zlib: require.resolve('browserify-zlib')
        }
    },
    plugins: [
        new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: require.resolve('process/browser')
        })
    ],
    devServer: {
        static: {
            directory: path.resolve(__dirname)
        },
        port: 8080,
        hot: true
    }
});
