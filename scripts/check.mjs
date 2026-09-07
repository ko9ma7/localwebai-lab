import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const dist = resolve('dist');
const required = [
  'index.html','404.html','styles.css','js/app.js','js/benchmark.js','js/config.js','js/data.js','js/readiness.js','js/storage.js',
  'workers/cpu.worker.js','manifest.webmanifest','service-worker.js','robots.txt','sitemap.xml',
  'assets/favicon.svg','assets/favicon-16x16.png','assets/favicon-32x32.png','assets/apple-touch-icon.png','assets/icon-192.png','assets/icon-512.png','assets/og-image.png','assets/social-preview.png','.nojekyll',
  'data/data-manifest.json','data/localwebai-complete.json','data/project.json','data/kernel-catalog.json','data/kernel-catalog.csv','data/benchmark-presets.json','data/readiness-rubric.json','data/reference-benchmarks.json','data/compatibility.json','data/hardware-profiles.json','data/roadmap.json','data/faq.json','data/sources.json','data/schemas/benchmark-result.schema.json','data/schemas/kernel-catalog.schema.json'
];
let failed = false;
const fail = message => { console.error(message); failed = true; };
for (const rel of required) {
  try { await stat(join(dist, rel)); } catch { fail(`Missing: ${rel}`); }
}

const html = await readFile(join(dist,'index.html'),'utf8');
for (const needle of ['LocalWebAI Lab','og:title','twitter:card','canonical','manifest.webmanifest','207 WebGPU Kernel Catalog','GitHub Pages 데이터 레이어']) {
  if (!html.includes(needle)) fail(`index.html missing ${needle}`);
}

const files = [];
async function walk(dir){ for(const name of await readdir(dir)){ const p=join(dir,name); const s=await stat(p); if(s.isDirectory()) await walk(p); else files.push(p); } }
await walk(dist);
for(const p of files.filter(f=>['.html','.css','.js','.json','.webmanifest','.xml','.txt'].includes(extname(f)))){
  const text=await readFile(p,'utf8');
  if(text.includes('__SITE_URL__')) fail(`Unreplaced SITE_URL in ${p}`);
  if(extname(p)==='.json' || extname(p)==='.webmanifest') {
    try { JSON.parse(text); } catch (error) { fail(`Invalid JSON: ${p} — ${error.message}`); }
  }
}

for (const rel of ['js/app.js','js/benchmark.js','js/config.js','js/data.js','js/readiness.js','js/storage.js','workers/cpu.worker.js','service-worker.js']) {
  try { execFileSync(process.execPath, ['--check', join(dist,rel)], { stdio:'pipe' }); }
  catch (error) { fail(`JavaScript syntax error: ${rel}\n${error.stderr?.toString() || error.message}`); }
}

const readJson = async rel => JSON.parse(await readFile(join(dist,rel),'utf8'));
const manifest = await readJson('data/data-manifest.json');
for (const item of manifest.files) {
  try { await stat(join(dist,'data',item.path)); } catch { fail(`Manifest target missing: data/${item.path}`); }
}
for (const rel of manifest.schemas) {
  try { await stat(join(dist,'data',rel)); } catch { fail(`Manifest schema missing: data/${rel}`); }
}

const kernels = await readJson('data/kernel-catalog.json');
if (kernels.count !== 207 || kernels.kernels.length !== 207) fail(`Kernel catalog must contain 207 items (count=${kernels.count}, items=${kernels.kernels.length})`);
const ids = kernels.kernels.map(k=>k.id);
if (new Set(ids).size !== ids.length) fail('Kernel catalog contains duplicate IDs');
if (!ids.includes('webgpu-kernels/ai.onnx.Add')) fail('Kernel catalog missing ai.onnx.Add');
if (kernels.namespaces?.['ai.onnx'] !== 175 || kernels.namespaces?.['com.microsoft'] !== 32) fail('Kernel namespace counts must be ai.onnx=175, com.microsoft=32');
for (const k of kernels.kernels) {
  if (!k.hub_url?.startsWith('https://huggingface.co/kernels/webgpu-kernels/')) fail(`Invalid Hub URL: ${k.id}`);
  if (!k.category) fail(`Missing derived category: ${k.id}`);
}

const rubric = await readJson('data/readiness-rubric.json');
const rubricTotal = rubric.criteria.reduce((sum,item)=>sum+Number(item.points||0),0);
if (rubric.total_points !== 100 || rubricTotal !== 100) fail(`Readiness rubric must total 100 (declared=${rubric.total_points}, actual=${rubricTotal})`);

const reference = await readJson('data/reference-benchmarks.json');
if (reference.total_operations !== 207 || reference.starting_test_cases !== 1756 || reference.comparable_cases !== 809) fail('Reference benchmark headline metrics do not match expected source snapshot');
if (reference.wins + reference.losses + reference.ties !== reference.comparable_cases) fail('Reference benchmark win/loss/tie total mismatch');

const presets = await readJson('data/benchmark-presets.json');
for (const preset of presets.presets) {
  if (preset.rows * preset.cols !== preset.elements) fail(`Preset element count mismatch: ${preset.id}`);
  if (preset.elements > presets.limits.max_elements) fail(`Preset exceeds max elements: ${preset.id}`);
}

const { validateSettings } = await import('../site/js/benchmark.js');
const valid = validateSettings({ rows: 1024, cols: 1024, warmup: 2, iterations: 5 });
if (valid.rows !== 1024 || valid.cols !== 1024) fail('Benchmark validation failed');
try { validateSettings({ rows: 4096, cols: 4096, warmup: 2, iterations: 5 }); fail('Oversized benchmark should fail'); } catch {}

if (failed) process.exit(1);
console.log(`Static checks passed (${files.length} files, ${kernels.kernels.length} kernels, ${1+manifest.files.length+manifest.schemas.length} data files).`);
