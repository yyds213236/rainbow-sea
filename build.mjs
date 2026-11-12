// 彩虹海改动：默认构建将纹理独立交付，--offline 生成内嵌纹理的离线文件。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const offline = process.argv.includes('--offline');
const textures = [
  'earth-day', 'earth-night', 'earth-clouds', 'moon', 'mercury', 'venus-atmosphere',
  'mars', 'jupiter', 'saturn', 'saturn-rings', 'uranus', 'neptune', 'sun',
  'earth-day-8k', 'earth-night-8k',
];
const stylePaths = [
  'src/style.css', 'src/ui/earthsense.css', 'src/ui/trajectory.css', 'src/ui/compact.css',
  'src/ui/jwst.css', 'src/rainbow-sea.css',
];

const [result, shell, styles, textureEntries] = await Promise.all([
  esbuild.build({
    entryPoints: [path.join(root, 'src/universe.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    write: false,
    legalComments: 'inline',
  }),
  readFile(path.join(root, 'src/shell.html'), 'utf8'),
  Promise.all(stylePaths.map(file => readFile(path.join(root, file), 'utf8'))),
  Promise.all(textures.map(async name => {
    const png = name === 'saturn-rings';
    const asset = `assets/${name}.${png ? 'png' : 'jpg'}`;
    if (!offline) return [name, `./${asset}`];
    const source = await readFile(path.join(root, asset));
    return [name, `data:image/${png ? 'png' : 'jpeg'};base64,${source.toString('base64')}`];
  })),
]);

const noticeFiles = ['NOTICE', 'LICENSE', 'assets/CREDITS.md', 'assets/THREE-LICENSE.txt'];
let licenseMarkup = '<p class="dialog-note"><a href="./LICENSE" target="_blank" rel="noopener noreferrer">完整许可证</a> · <a href="./NOTICE" target="_blank" rel="noopener noreferrer">项目署名</a></p>';
if (offline) {
  const documents = await Promise.all(noticeFiles.map(file => readFile(path.join(root, file), 'utf8')));
  const noticeText = documents.map((document, index) => `${noticeFiles[index]}\n\n${document.trim()}`).join('\n\n');
  const escaped = noticeText.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  licenseMarkup = `<details class="license-copy"><summary>完整许可与署名</summary><pre>${escaped}</pre></details>`;
}

const html = shell
  .replace('<!-- LICENSE_NOTICES -->', () => licenseMarkup)
  .replace('/* INLINE_CSS */', () => styles.join('\n'))
  .replace('/* INLINE_ASSETS */', () => `window.ORBIT_ASSETS=${JSON.stringify(Object.fromEntries(textureEntries))};`)
  .replace('/* INLINE_JS */', () => result.outputFiles[0].text.replaceAll('</script', '<\\/script'));
const output = offline ? 'out/彩虹海.html' : 'index.html';
if (offline) await mkdir(path.join(root, 'out'), { recursive: true });
await writeFile(path.join(root, output), html);
console.log(`${output} · ${(Buffer.byteLength(html) / 1024).toFixed(0)} KiB · ${offline ? '内嵌纹理' : '独立纹理'}`);
