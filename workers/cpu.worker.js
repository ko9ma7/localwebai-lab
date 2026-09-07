self.onmessage = ({ data }) => {
  const { rows, cols, warmup, iterations } = data;
  const n = rows * cols;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = ((i % 1024) - 512) / 256;
    b[i] = ((i % 257) - 128) / 128;
  }
  const add = () => { for (let i = 0; i < n; i++) c[i] = a[i] + b[i]; };
  for (let i = 0; i < warmup; i++) add();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    add();
    samples.push(performance.now() - start);
  }
  let checksum = 0;
  const step = Math.max(1, Math.floor(n / 32));
  for (let i = 0; i < n; i += step) checksum += c[i];
  const avg = samples.reduce((sum, v) => sum + v, 0) / samples.length;
  self.postMessage({ avg, samples, checksum, n });
};
