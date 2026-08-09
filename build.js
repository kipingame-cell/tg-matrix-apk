const esbuild = require('esbuild');
const fs = require('fs');
const { NodeGlobalsPolyfillPlugin } = require('@esbuild-plugins/node-globals-polyfill');

// В бандле живут два разных Buffer: полифилл глобалов (v4) и buffer@6 из crypto-browserify.
// GramJS проверяет `instanceof Buffer` при сериализации (2FA/SRP) и падает на чужом конструкторе.
// Патчим исходники telegram на лету: принимаем любой Uint8Array (оба Buffer — его наследники).
const gramjsBufferFix = {
    name: 'gramjs-buffer-fix',
    setup(build) {
        build.onLoad({ filter: /node_modules[\/\\]telegram[\/\\].*\.js$/ }, (args) => {
            let contents = fs.readFileSync(args.path, 'utf8');
            contents = contents.replace(
                /(\b[\w$]+) instanceof Buffer(?!\s*\|\|)/g,
                '($1 instanceof Buffer || $1 instanceof Uint8Array)'
            );
            return { contents, loader: 'js' };
        });
    }
};

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
    plugins: [gramjsBufferFix, NodeGlobalsPolyfillPlugin({ process: true, buffer: true })],
    define: { 'process.env.NODE_ENV': '"production"', 'global': 'window' },
    logLevel: 'info'
}).catch(() => process.exit(1));
