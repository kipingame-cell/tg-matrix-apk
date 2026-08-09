const esbuild = require('esbuild');
const { NodeModulesPolyfillPlugin } = require('@esbuild-plugins/node-modules-polyfill');
const { NodeGlobalsPolyfillPlugin } = require('@esbuild-plugins/node-globals-polyfill');

esbuild.build({
    entryPoints: ['src/app.js'],
    bundle: true,
    outfile: 'www/js/bundle.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    // node-modules-polyfill отдаёт пустышку для crypto — подменяем на crypto-browserify
    alias: { crypto: 'crypto-browserify' },
    plugins: [NodeModulesPolyfillPlugin(), NodeGlobalsPolyfillPlugin({ process: true, buffer: true })],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info'
}).catch(() => process.exit(1));
