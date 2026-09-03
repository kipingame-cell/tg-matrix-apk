// Постоянная подпись debug-APK: один и тот же ключ на всех сборках -> APK ставится как обновление.
// Запускается в Actions ПОСЛЕ `npx cap add android`, ДО gradlew.
const fs = require('fs');
const path = require('path');

const b64 = fs.readFileSync(path.join(__dirname, 'tgk.keystore.b64'), 'utf8').replace(/\s+/g, '');
fs.writeFileSync(path.join(__dirname, 'android', 'tgk.keystore'), Buffer.from(b64, 'base64'));

const gradlePath = path.join(__dirname, 'android', 'app', 'build.gradle');
let g = fs.readFileSync(gradlePath, 'utf8');

if (!g.includes('tgk.keystore')) {
    g = g.replace(/android \{/,
`android {
    signingConfigs {
        debug {
            storeFile file('../tgk.keystore')
            storePassword 'tgmatrix2026'
            keyAlias 'tgk'
            keyPassword 'tgmatrix2026'
        }
    }`);
    fs.writeFileSync(gradlePath, g);
    console.log('signingConfig: tgk.keystore подключён');
} else {
    console.log('signingConfig уже на месте');
}
