import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'site');
const dist = resolve(root, 'dist');
const siteUrl = (process.env.SITE_URL || 'http://localhost:4173/').replace(/([^/])$/, '$1/');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(src, dist, { recursive: true });

for (const file of ['index.html', '404.html', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest']) {
  const path = resolve(dist, file);
  let text = await readFile(path, 'utf8');
  text = text.replaceAll('__SITE_URL__', siteUrl);
  await writeFile(path, text);
}

await writeFile(resolve(dist, '.nojekyll'), '');
console.log(`Built LocalWebAI Lab -> ${dist}`);
console.log(`SITE_URL=${siteUrl}`);
