const esbuild = require('esbuild');
const { polyfillNode } = require('esbuild-plugin-node-polyfills');

esbuild.build({
    entryPoints: ['src/app.js'],
    bundle: true,
    outfile: 'www/js/bundle.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    plugins: [polyfillNode({ globals: { Buffer: true, process: true } })],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info'
}).catch(() => process.exit(1));
