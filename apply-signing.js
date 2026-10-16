// Signing material must come from private CI secrets, never the repository.
const fs = require('node:fs');
const required = ['ANDROID_KEYSTORE_BASE64','ANDROID_KEYSTORE_PASSWORD','ANDROID_KEY_ALIAS','ANDROID_KEY_PASSWORD'];
for (const name of required) if (!process.env[name]) throw new Error('Missing signing secret: ' + name);
const gradlePath = 'android/app/build.gradle';
const g = fs.readFileSync(gradlePath, 'utf8');
if (!/android\s*\{/.test(g)) throw new Error('Android Gradle block not found');
if (g.includes('auditPrivateSigning')) throw new Error('Signing already configured');
fs.writeFileSync('android/private-signing.keystore', Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, 'base64'), {mode:0o600});
fs.writeFileSync(gradlePath, g.replace(/android\s*\{/, `android {
    // auditPrivateSigning
    signingConfigs {
        debug {
            storeFile file('../private-signing.keystore')
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }
    }`));
