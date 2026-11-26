'use strict';

const path = require('node:path');
const { tmpdir } = require('node:os');
const { copyFileSync, mkdirSync, mkdtempSync, readdirSync, statSync } = require('node:fs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const stage = mkdtempSync(path.join(tmpdir(), 'munetios-beta-'));
const assets = path.join(stage, 'assets');
const maxAssetBytes = 25 * 1024 * 1024;
const publicTypes = new Set(['.css', '.gif', '.html', '.ico', '.jpg', '.js', '.json', '.png', '.svg', '.ttf', '.txt', '.webmanifest', '.xml']);
const protectedPages = new Set(['account/index.html', 'mail/index.html', 'webfilter/index.html']);

function copyAsset(relative, target = relative) {
    const source = path.join(root, relative);
    if (statSync(source).size > maxAssetBytes) throw new Error('Static asset exceeds the Workers limit: ' + relative);
    const destination = path.join(assets, target);
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
}

function copyDirectory(relative, target = relative) {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const file = relative + '/' + entry.name;
        if (entry.isDirectory()) copyDirectory(file, target + '/' + entry.name);
        else if (entry.isFile() && publicTypes.has(path.extname(entry.name)) && !protectedPages.has(file)) copyAsset(file, target + '/' + entry.name);
    }
}

for (const file of ['index.html', '404.html', '404.css', '404-i18n.js', 'favicon-ganetios.ico', 'ganetios-logo-icon.png', 'munetios-logo-icon.png', 'munetios-logo.png', 'ganetios-ui.css', 'ganetios-ui.js',
    'ganetios-features.js', 'ganetios-features-i18n.js', 'ganetios-locales.js', 'tone.js', 'videos.js']) copyAsset(file);
for (const directory of ['account', 'blocked', 'calendar', 'fonts', 'mail', 'maps', 'munetios-ui', 'omniwrite', 'photos', 'shared', 'signin', 'supanotes', 'tasks', 'weather', 'webfilter']) copyDirectory(directory);
// The new Meals replaces the Meals page inside Calendar (calendar.munetios.com/calendar/meals/); meals-sync.js stays.
copyDirectory('meals', 'calendar/meals');

const music = path.join(root, 'music.mp3');
if (statSync(music).size > maxAssetBytes) {
    const output = path.join(assets, 'music.mp3');
    execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', music, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', output], { stdio: 'inherit' });
    if (statSync(output).size > maxAssetBytes) throw new Error('Encoded beta audio exceeds the Workers limit');
} else {
    copyAsset('music.mp3');
}

for (const file of ['wrangler.toml', 'worker.mjs', 'weather-api.mjs', 'maps-api.mjs']) copyFileSync(path.join(__dirname, file), path.join(stage, file));
copyFileSync(path.join(__dirname, '_headers'), path.join(assets, '_headers'));
process.stdout.write(path.join(stage, 'wrangler.toml') + '\n');
