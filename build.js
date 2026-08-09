const esbuild = require('esbuild');
const { NodeGlobalsPolyfillPlugin } = require('@esbuild-plugins/node-globals-polyfill');

esbuild.build({
    entryPoints: ['src/app.js'],
    bundle: true,
    outfile: 'www/js/bundle.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    // Node-билтины подменяем явно: crypto → crypto-browserify (randomBytes/createHash),
    // net/fs/constants → пустышка (в браузере не вызываются: GramJS ходит через WebSocket)
    alias: {
        crypto: 'crypto-browserify',
        stream: 'stream-browserify',
        path: 'path-browserify',
        os: 'os-browserify',
        net: './src/empty.js',
        fs: './src/empty.js',
        constants: './src/empty.js'
    },
    plugins: [NodeGlobalsPolyfillPlugin({ process: true, buffer: true })],
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info'
}).catch(() => process.exit(1));
