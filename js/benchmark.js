import { CONFIG } from './config.js';
import { getGpuContext } from './readiness.js';

const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 시간 초과`)), ms))
]);

function makeInputs(n) {
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = ((i % 1024) - 512) / 256;
    b[i] = ((i % 257) - 128) / 128;
  }
  return { a, b };
}

function checksum(view) {
  if (!view?.length) return null;
  let total = 0;
  const step = Math.max(1, Math.floor(view.length / 32));
  for (let i = 0; i < view.length; i += step) total += Number(view[i] || 0);
  return total;
}

export function runCpuBenchmark(settings) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./workers/cpu.worker.js', { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('CPU 벤치마크 시간 초과')); }, 30_000);
    worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
    worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message || 'CPU Worker 오류')); };
    worker.postMessage(settings);
  });
}

let hfModulePromise;
async function importHfModule() {
  if (!hfModulePromise) {
    hfModulePromise = (async () => {
      let lastError;
      for (const url of CONFIG.hfModuleUrls) {
        try {
          const mod = await withTimeout(import(url), 12_000, 'Hugging Face 모듈 로딩');
          if (typeof mod.getKernel !== 'function') throw new Error('getKernel export 없음');
          return { module: mod, url };
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error('@huggingface/kernels 모듈을 불러오지 못했습니다.');
    })();
  }
  try {
    return await hfModulePromise;
  } catch (error) {
    hfModulePromise = undefined;
    throw error;
  }
}

export async function probeHfModule() {
  try {
    const { url } = await importHfModule();
    return { ok: true, url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runHfKernelBenchmark(settings) {
  const n = settings.rows * settings.cols;
  const { a, b } = makeInputs(n);
  const { module, url } = await importHfModule();
  const getKernel = module.getKernel;
  const kernel = await withTimeout(getKernel(CONFIG.kernelRepo, { version: CONFIG.kernelVersion }), 20_000, '커널 로딩');
  const invoke = () => kernel({
    a: { data: a, shape: [settings.rows, settings.cols] },
    b: { data: b, shape: [settings.rows, settings.cols] }
  });
  let last;
  for (let i = 0; i < settings.warmup; i++) last = await withTimeout(invoke(), 20_000, 'GPU 워밍업');
  const samples = [];
  for (let i = 0; i < settings.iterations; i++) {
    const start = performance.now();
    last = await withTimeout(invoke(), 20_000, 'GPU 실행');
    samples.push(performance.now() - start);
  }
  const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  const c = last?.c;
  const output = ArrayBuffer.isView(c) ? c : (ArrayBuffer.isView(c?.data) ? c.data : null);
  return { avg, samples, checksum: checksum(output), n, engine: 'Hugging Face @huggingface/kernels', sourceUrl: url, kernelVerified: true };
}

const RAW_SHADER = `
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> c: array<f32>;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i < arrayLength(&c)) { c[i] = a[i] + b[i]; }
}`;

export async function runRawWebGpuFallback(settings) {
  const { device } = await getGpuContext();
  const n = settings.rows * settings.cols;
  const byteLength = n * 4;
  const { a, b } = makeInputs(n);
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const aBuffer = device.createBuffer({ size: byteLength, usage });
  const bBuffer = device.createBuffer({ size: byteLength, usage });
  const cBuffer = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
  const readBuffer = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  device.queue.writeBuffer(aBuffer, 0, a);
  device.queue.writeBuffer(bBuffer, 0, b);
  const shader = device.createShaderModule({ code: RAW_SHADER });
  const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: shader, entryPoint: 'main' } });
  const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: aBuffer } },
    { binding: 1, resource: { buffer: bBuffer } },
    { binding: 2, resource: { buffer: cBuffer } }
  ] });
  const dispatch = async () => {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.dispatchWorkgroups(Math.ceil(n / 256)); pass.end();
    encoder.copyBufferToBuffer(cBuffer, 0, readBuffer, 0, byteLength);
    device.queue.submit([encoder.finish()]);
    await readBuffer.mapAsync(GPUMapMode.READ);
    const copy = new Float32Array(readBuffer.getMappedRange().slice(0));
    readBuffer.unmap();
    return copy;
  };
  let last;
  for (let i = 0; i < settings.warmup; i++) last = await dispatch();
  const samples = [];
  for (let i = 0; i < settings.iterations; i++) {
    const start = performance.now(); last = await dispatch(); samples.push(performance.now() - start);
  }
  aBuffer.destroy(); bBuffer.destroy(); cBuffer.destroy(); readBuffer.destroy();
  return { avg: samples.reduce((s,v)=>s+v,0)/samples.length, samples, checksum: checksum(last), n, engine: 'Raw WebGPU fallback', kernelVerified: false };
}

export function validateSettings(settings) {
  const rows = Number(settings.rows), cols = Number(settings.cols), warmup = Number(settings.warmup), iterations = Number(settings.iterations);
  if (![rows, cols, warmup, iterations].every(Number.isFinite)) throw new Error('설정 값은 숫자여야 합니다.');
  if (rows < 64 || cols < 64 || rows > 4096 || cols > 4096) throw new Error('행/열은 64~4096 범위여야 합니다.');
  if (rows * cols > CONFIG.maxElements) throw new Error(`총 원소 수는 ${CONFIG.maxElements.toLocaleString()}개 이하여야 합니다.`);
  if (warmup < 0 || warmup > 10 || iterations < 1 || iterations > 20) throw new Error('워밍업 0~10회, 측정 1~20회로 설정하세요.');
  return { rows: Math.floor(rows), cols: Math.floor(cols), warmup: Math.floor(warmup), iterations: Math.floor(iterations) };
}
