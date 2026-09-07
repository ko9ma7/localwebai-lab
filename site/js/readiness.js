let cachedGpuContext;

async function adapterInfo(adapter) {
  try {
    if (adapter.info) return adapter.info;
    if (typeof adapter.requestAdapterInfo === 'function') return await adapter.requestAdapterInfo();
  } catch {}
  return {};
}

export async function getGpuContext() {
  if (cachedGpuContext) return cachedGpuContext;
  if (!('gpu' in navigator)) throw new Error('이 브라우저에서는 WebGPU API를 찾을 수 없습니다.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('사용 가능한 WebGPU 어댑터를 찾지 못했습니다.');
  const device = await adapter.requestDevice();
  const info = await adapterInfo(adapter);
  cachedGpuContext = { adapter, device, info };
  device.lost.then(() => { cachedGpuContext = undefined; }).catch(() => {});
  return cachedGpuContext;
}

export async function inspectReadiness({ hfModuleAvailable = false, kernelVerified = false } = {}) {
  const details = {
    webgpu: 'gpu' in navigator,
    adapter: false,
    device: false,
    shaderF16: false,
    maxBufferSize: 0,
    maxComputeWorkgroupsPerDimension: 0,
    hfModuleAvailable,
    kernelVerified,
    gpuName: '확인 불가',
    browser: navigator.userAgent
  };
  let score = details.webgpu ? 45 : 0;
  if (!details.webgpu) return { score, details };
  try {
    const { adapter, device, info } = await getGpuContext();
    details.adapter = !!adapter; score += 15;
    details.device = !!device; score += 10;
    details.shaderF16 = adapter.features?.has('shader-f16') || device.features?.has('shader-f16') || false;
    if (details.shaderF16) score += 5;
    details.maxBufferSize = Number(device.limits?.maxBufferSize || adapter.limits?.maxBufferSize || 0);
    if (details.maxBufferSize >= 268_435_456) score += 10;
    details.maxComputeWorkgroupsPerDimension = Number(device.limits?.maxComputeWorkgroupsPerDimension || 0);
    if (details.maxComputeWorkgroupsPerDimension >= 65_535) score += 8;
    details.gpuName = info.description || info.device || info.architecture || info.vendor || 'WebGPU Adapter';
  } catch (error) {
    details.error = error instanceof Error ? error.message : String(error);
  }
  if (hfModuleAvailable) score += 4;
  if (kernelVerified) score += 3;
  return { score: Math.min(100, score), details };
}
