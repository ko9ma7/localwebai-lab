export const CONFIG = Object.freeze({
  productName: 'LocalWebAI Lab',
  kernelRepo: 'webgpu-kernels/ai.onnx.Add',
  kernelVersion: 1,
  hfModuleUrls: [
    'https://cdn.jsdelivr.net/npm/@huggingface/kernels@preview/+esm',
    'https://esm.sh/@huggingface/kernels@preview'
  ],
  defaultBenchmark: Object.freeze({ rows: 1024, cols: 1024, warmup: 2, iterations: 5 }),
  maxElements: 4_194_304,
  historyLimit: 20,
  storageKeys: Object.freeze({
    theme: 'localwebai.theme.v1',
    settings: 'localwebai.settings.v1',
    history: 'localwebai.history.v1'
  })
});
