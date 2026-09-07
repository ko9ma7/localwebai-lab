const DATA_FILES = Object.freeze({
  manifest: './data/data-manifest.json',
  project: './data/project.json',
  kernels: './data/kernel-catalog.json',
  presets: './data/benchmark-presets.json',
  rubric: './data/readiness-rubric.json',
  reference: './data/reference-benchmarks.json',
  compatibility: './data/compatibility.json',
  hardware: './data/hardware-profiles.json',
  roadmap: './data/roadmap.json',
  faq: './data/faq.json',
  sources: './data/sources.json'
});

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path} 로딩 실패 (${response.status})`);
  return response.json();
}

let productDataPromise;
export function loadProductData() {
  if (!productDataPromise) {
    productDataPromise = Promise.all(Object.entries(DATA_FILES).map(async ([key, path]) => [key, await fetchJson(path)]))
      .then(entries => Object.fromEntries(entries));
  }
  return productDataPromise;
}

export { DATA_FILES };
