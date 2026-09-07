import { CONFIG } from './config.js';
import { getTheme, setTheme, getSettings, saveSettings, getHistory, pushHistory, clearHistory } from './storage.js';
import { inspectReadiness } from './readiness.js';
import { probeHfModule, runCpuBenchmark, runHfKernelBenchmark, runRawWebGpuFallback, validateSettings } from './benchmark.js';
import { loadProductData, DATA_FILES } from './data.js';

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const state = {
  settings: getSettings(), readiness: null, hfProbe: { ok: false }, running: false,
  data: null, kernelPage: 1, kernelPageSize: 24
};

function escapeHtml(value='') { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function ms(value) { return Number.isFinite(value) ? `${value.toFixed(value < 10 ? 2 : 1)} ms` : '—'; }
function formatBytes(bytes) { if (!bytes) return '—'; const gb = bytes / 1024 ** 3; return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes/1024**2)} MB`; }
function toast(message, type='info') {
  const node = document.createElement('div'); node.className = `toast toast-${type}`; node.textContent = message;
  $('#toast-region').append(node); requestAnimationFrame(()=>node.classList.add('show'));
  setTimeout(()=>{ node.classList.remove('show'); setTimeout(()=>node.remove(),200); }, 3200);
}
function applyTheme(theme) { document.documentElement.dataset.theme = theme; $('#theme-select').value = theme; }
function syncSettingsForm(settings) {
  for (const key of ['rows','cols','warmup','iterations']) $(`#${key}`).value = settings[key];
  $('#matrix-summary').textContent = `${settings.rows.toLocaleString()} × ${settings.cols.toLocaleString()} · ${(settings.rows*settings.cols).toLocaleString()} elements`;
}
function settingsFromUrl() {
  const p = new URLSearchParams(location.search); const keys=['rows','cols','warmup','iterations'];
  const next={...state.settings}; let changed=false;
  for(const key of keys) if(p.has(key)){ next[key]=Number(p.get(key)); changed=true; }
  if(changed){ try { return validateSettings(next); } catch {} }
  return state.settings;
}
function writeSettingsToUrl(settings) {
  const url = new URL(location.href); for(const [k,v] of Object.entries(settings)) url.searchParams.set(k,String(v)); history.replaceState(null,'',url);
}
function setStatus(label, tone='idle') { const el=$('#run-status'); el.textContent=label; el.dataset.tone=tone; }
function setProgress(value, label) { $('#progress-bar').style.width=`${Math.max(0,Math.min(100,value))}%`; $('#progress-label').textContent=label; }
function updateChart(cpu, gpu) {
  const cpuEl=$('#cpu-bar'), gpuEl=$('#gpu-bar'); const max=Math.max(cpu||0,gpu||0,1);
  cpuEl.style.height=`${Math.max(8,(cpu/max)*100)}%`; gpuEl.style.height=`${Math.max(8,(gpu/max)*100)}%`;
  $('#cpu-value').textContent=ms(cpu); $('#gpu-value').textContent=ms(gpu);
  const speedup = cpu && gpu ? cpu/gpu : null;
  $('#speedup-value').textContent = speedup ? `${speedup.toFixed(2)}×` : '—';
  $('#speedup-caption').textContent = speedup ? (speedup >= 1 ? 'WebGPU가 더 빠름' : 'CPU가 더 빠름') : '측정 전';
}
function renderReadiness(result) {
  state.readiness=result; const { score, details }=result;
  $('#score-number').textContent=score; $('#score-ring').style.setProperty('--score', `${score*3.6}deg`);
  $('#gpu-name').textContent=details.gpuName || '확인 불가';
  $('#webgpu-status').textContent=details.webgpu && details.device ? '지원됨' : '지원 안 됨';
  $('#webgpu-status').dataset.ok=String(details.webgpu && details.device);
  $('#f16-status').textContent=details.shaderF16 ? '지원' : '미지원/미확인';
  $('#buffer-limit').textContent=formatBytes(details.maxBufferSize);
  $('#hf-status').textContent=details.kernelVerified ? '커널 실행 확인' : (details.hfModuleAvailable ? '로더 확인' : '아직 확인 안 됨');
  $('#score-grade').textContent = score >= 90 ? 'Excellent' : score >= 75 ? 'Ready' : score >= 55 ? 'Limited' : 'Unsupported';
}
function renderHistory() {
  const history=getHistory(); const body=$('#history-body'); const empty=$('#history-empty'); body.innerHTML=''; empty.hidden=history.length>0;
  for(const item of history){
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${new Date(item.createdAt).toLocaleString()}</td><td>${item.rows}×${item.cols}</td><td>${escapeHtml(item.engine)}</td><td>${ms(item.cpuMs)}</td><td>${ms(item.gpuMs)}</td><td>${item.speedup.toFixed(2)}×</td><td>${item.score}</td>`;
    body.append(tr);
  }
}
function benchmarkResultSummary(cpu,gpu,engine) {
  const speedup=cpu.avg/gpu.avg; return { speedup, text: speedup>=1 ? `WebGPU가 CPU보다 ${speedup.toFixed(2)}배 빠르게 측정되었습니다.` : `이 워크로드에서는 CPU가 ${(1/speedup).toFixed(2)}배 빠르게 측정되었습니다.` , engine };
}
async function runBenchmark() {
  if(state.running) return;
  let settings;
  try { settings=validateSettings(state.settings); } catch(error){ toast(error.message,'error'); return; }
  if(!('gpu' in navigator)){ setStatus('WebGPU 미지원','error'); toast('WebGPU를 지원하는 최신 브라우저 환경에서 실행하세요.','error'); return; }
  state.running=true; $('#run-button').disabled=true; $('#settings-button').disabled=true; $('#result-note').textContent='벤치마크를 준비하고 있습니다…';
  setStatus('실행 중','running'); setProgress(8,'CPU 워밍업 및 측정');
  try {
    const cpu=await runCpuBenchmark(settings); setProgress(38,'Hugging Face WebGPU 커널 로딩');
    let gpu; let hfError='';
    try { gpu=await runHfKernelBenchmark(settings); state.hfProbe={ok:true}; }
    catch(error){ hfError=error instanceof Error?error.message:String(error); setProgress(48,'Hugging Face 커널 실패 · Raw WebGPU fallback 실행'); gpu=await runRawWebGpuFallback(settings); }
    setProgress(85,'결과 검증 및 점수 계산');
    const readiness=await inspectReadiness({ hfModuleAvailable: state.hfProbe.ok, kernelVerified: gpu.kernelVerified }); renderReadiness(readiness);
    const summary=benchmarkResultSummary(cpu,gpu,gpu.engine); updateChart(cpu.avg,gpu.avg);
    const checksumDelta=(cpu.checksum!=null && gpu.checksum!=null)?Math.abs(cpu.checksum-gpu.checksum):null;
    const verified=checksumDelta==null ? '출력 샘플 확인 불가' : (checksumDelta<0.01?'결과 일치':'결과 차이 감지');
    $('#result-note').innerHTML=`<strong>${escapeHtml(summary.text)}</strong> ${escapeHtml(gpu.engine)} · ${escapeHtml(verified)}${hfError?`<br><span class="muted">Hugging Face 커널 로딩 실패로 fallback 사용: ${escapeHtml(hfError)}</span>`:''}`;
    $('#kernel-engine').textContent=gpu.engine; $('#kernel-id').textContent=CONFIG.kernelRepo.replace('webgpu-kernels/','');
    const entry={ createdAt:new Date().toISOString(), ...settings, cpuMs:cpu.avg, gpuMs:gpu.avg, speedup:summary.speedup, score:readiness.score, engine:gpu.engine, kernel:CONFIG.kernelRepo };
    pushHistory(entry); renderHistory(); setProgress(100,'완료'); setStatus('완료','success'); toast('벤치마크가 완료되었습니다.','success');
  } catch(error) {
    const msg=error instanceof Error?error.message:String(error); setStatus('오류','error'); setProgress(0,'실행 실패'); $('#result-note').textContent=msg; toast(msg,'error');
  } finally { state.running=false; $('#run-button').disabled=false; $('#settings-button').disabled=false; }
}
function openDialog(id){ const d=$(id); if(typeof d.showModal==='function') d.showModal(); else d.setAttribute('open',''); }
function closeDialog(id){ const d=$(id); if(typeof d.close==='function') d.close(); else d.removeAttribute('open'); }
function exportHistory(){
  const data={ product:CONFIG.productName, schema:'./data/schemas/benchmark-result.schema.json', exportedAt:new Date().toISOString(), history:getHistory() };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`localwebai-benchmarks-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url);
}
async function shareConfig(){ writeSettingsToUrl(state.settings); try{ await navigator.clipboard.writeText(location.href); toast('현재 설정 URL을 복사했습니다.','success'); } catch { prompt('아래 URL을 복사하세요.',location.href); } }

function bindFaq() {
  $$('.faq-question').forEach(btn=>btn.addEventListener('click',()=>{
    const expanded=btn.getAttribute('aria-expanded')==='true'; btn.setAttribute('aria-expanded',String(!expanded));
    const panel=document.getElementById(btn.getAttribute('aria-controls')); panel.hidden=expanded;
  }));
}

function renderDataFiles(data) {
  const root=$('#data-file-list');
  const all=[{path:'./data/data-manifest.json',kind:'manifest',description:'전체 데이터 파일 인덱스'}, ...data.manifest.files.map(x=>({...x,path:`./data/${x.path}`})), ...data.manifest.schemas.map(path=>({path:`./data/${path}`,kind:'json-schema',description:'JSON Schema'}))];
  root.innerHTML=all.map(item=>`<a class="data-file" href="${escapeHtml(item.path)}" target="_blank" rel="noopener"><span><strong>${escapeHtml(item.path.replace('./data/',''))}</strong><small>${escapeHtml(item.description)}</small></span><em>${escapeHtml(item.kind)}</em></a>`).join('');
}
function renderReference(reference) {
  $('#reference-summary').innerHTML=`
    <div class="reference-kpis"><div><strong>${reference.geometric_mean_speedup.toFixed(2)}×</strong><span>geometric mean</span></div><div><strong>${reference.median_speedup.toFixed(2)}×</strong><span>median</span></div><div><strong>${reference.comparable_cases.toLocaleString()}</strong><span>comparable cases</span></div></div>
    <p>${escapeHtml(reference.hardware)} · ${escapeHtml(reference.comparator)}</p>
    <div class="reference-record"><span>Wins <strong>${reference.wins}</strong></span><span>Losses <strong>${reference.losses}</strong></span><span>Ties <strong>${reference.ties}</strong></span></div>
    <p class="data-warning">${escapeHtml(reference.warning)}</p>`;
}
function renderRubric(rubric) {
  $('#rubric-list').innerHTML=rubric.criteria.map(item=>`<div class="rubric-row"><span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.condition)}</small></span><em>+${item.points}</em></div>`).join('');
}
function renderRoadmap(roadmap) {
  $('#roadmap-grid').innerHTML=roadmap.items.map((item,index)=>`<article class="feature"><span class="num">${String(index+1).padStart(2,'0')}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description)}</p><small class="feature-metrics">${item.metrics.map(escapeHtml).join(' · ')}</small></article>`).join('');
}
function renderFaq(faq) {
  $('#faq-list').innerHTML=faq.items.map((item,index)=>`<div class="faq-item"><button class="faq-question" aria-expanded="false" aria-controls="faq-data-${index}">${escapeHtml(item.question)}</button><div class="faq-answer" id="faq-data-${index}" hidden>${escapeHtml(item.answer)}</div></div>`).join('');
  bindFaq();
}
function renderPresets(presets) {
  const select=$('#preset-select');
  select.innerHTML='<option value="">직접 설정</option>'+presets.presets.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)} — ${escapeHtml(p.description)}</option>`).join('');
}
function kernelFiltered() {
  if(!state.data) return [];
  const q=$('#kernel-search').value.trim().toLowerCase(); const ns=$('#namespace-filter').value; const cat=$('#category-filter').value;
  return state.data.kernels.kernels.filter(k=>(!q || `${k.operation} ${k.namespace} ${k.id} ${k.category}`.toLowerCase().includes(q)) && (!ns || k.namespace===ns) && (!cat || k.category===cat));
}
function renderKernelCatalog() {
  if(!state.data) return;
  const filtered=kernelFiltered(); const pages=Math.max(1,Math.ceil(filtered.length/state.kernelPageSize)); state.kernelPage=Math.min(state.kernelPage,pages);
  const start=(state.kernelPage-1)*state.kernelPageSize; const visible=filtered.slice(start,start+state.kernelPageSize); const body=$('#kernel-body');
  body.innerHTML=visible.map(k=>`<tr><td>${k.index}</td><td><strong>${escapeHtml(k.operation)}</strong><small>${escapeHtml(k.id)}</small></td><td><code>${escapeHtml(k.namespace)}</code></td><td><span class="category-chip">${escapeHtml(k.category)}</span></td><td><a class="table-link" href="${escapeHtml(k.hub_url)}" target="_blank" rel="noopener">Kernel card ↗</a></td></tr>`).join('');
  $('#kernel-empty').hidden=filtered.length!==0; $('#kernel-count').textContent=`${filtered.length.toLocaleString()} / ${state.data.kernels.count.toLocaleString()} kernels`;
  $('#kernel-page').textContent=`${state.kernelPage} / ${pages}`; $('#kernel-prev').disabled=state.kernelPage<=1; $('#kernel-next').disabled=state.kernelPage>=pages;
}
function renderKernelFilters(kernels) {
  const ns=$('#namespace-filter'), cat=$('#category-filter');
  ns.innerHTML='<option value="">전체 namespace</option>'+Object.entries(kernels.namespaces).map(([name,count])=>`<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</option>`).join('');
  cat.innerHTML='<option value="">전체 category</option>'+Object.entries(kernels.categories).map(([name,count])=>`<option value="${escapeHtml(name)}">${escapeHtml(name)} (${count})</option>`).join('');
  renderKernelCatalog();
}
function renderProductData(data) {
  state.data=data;
  const stats=$$('#data-stats .data-stat strong');
  stats[0].textContent=data.kernels.count.toLocaleString(); stats[1].textContent=data.reference.comparable_cases.toLocaleString(); stats[2].textContent=`${data.reference.geometric_mean_speedup.toFixed(2)}×`; stats[3].textContent=String(1+data.manifest.files.length+data.manifest.schemas.length);
  renderDataFiles(data); renderReference(data.reference); renderRubric(data.rubric); renderRoadmap(data.roadmap); renderFaq(data.faq); renderPresets(data.presets); renderKernelFilters(data.kernels);
}
function renderDataError(error) {
  const message=error instanceof Error?error.message:String(error);
  for(const id of ['#data-file-list','#reference-summary','#rubric-list','#roadmap-grid','#faq-list']) { const node=$(id); if(node) node.innerHTML=`<div class="empty error-state">정적 데이터 로딩 실패: ${escapeHtml(message)}</div>`; }
  $('#kernel-count').textContent='Kernel data unavailable';
}
function bindDataControls() {
  for(const id of ['#kernel-search','#namespace-filter','#category-filter']) $(id).addEventListener(id==='#kernel-search'?'input':'change',()=>{ state.kernelPage=1; renderKernelCatalog(); });
  $('#kernel-prev').addEventListener('click',()=>{ state.kernelPage=Math.max(1,state.kernelPage-1); renderKernelCatalog(); document.querySelector('#kernels').scrollIntoView({behavior:'smooth',block:'start'}); });
  $('#kernel-next').addEventListener('click',()=>{ state.kernelPage+=1; renderKernelCatalog(); document.querySelector('#kernels').scrollIntoView({behavior:'smooth',block:'start'}); });
  $('#preset-apply').addEventListener('click',()=>{
    const id=$('#preset-select').value; const preset=state.data?.presets.presets.find(p=>p.id===id); if(!preset){ toast('적용할 preset을 선택하세요.'); return; }
    syncSettingsForm({rows:preset.rows,cols:preset.cols,warmup:preset.warmup,iterations:preset.iterations}); toast(`${preset.label} preset을 입력했습니다.`,'success');
  });
}

async function init() {
  state.settings=settingsFromUrl(); syncSettingsForm(state.settings); applyTheme(getTheme()); renderHistory(); bindDataControls();
  loadProductData().then(renderProductData).catch(renderDataError);
  $('#theme-select').addEventListener('change',e=>{ setTheme(e.target.value); applyTheme(e.target.value); });
  $('#run-button').addEventListener('click',runBenchmark); $('#settings-button').addEventListener('click',()=>openDialog('#settings-dialog'));
  $('#settings-close').addEventListener('click',()=>closeDialog('#settings-dialog'));
  $('#settings-form').addEventListener('submit',e=>{ e.preventDefault(); try { const next=validateSettings(Object.fromEntries(new FormData(e.currentTarget))); state.settings=next; saveSettings(next); syncSettingsForm(next); writeSettingsToUrl(next); closeDialog('#settings-dialog'); toast('벤치마크 설정을 저장했습니다.','success'); } catch(error){ toast(error.message,'error'); } });
  $('#settings-reset').addEventListener('click',()=>{ state.settings={...CONFIG.defaultBenchmark}; saveSettings(state.settings); syncSettingsForm(state.settings); writeSettingsToUrl(state.settings); $('#preset-select').value=''; toast('기본 설정으로 되돌렸습니다.'); });
  $('#share-button').addEventListener('click',shareConfig); $('#export-button').addEventListener('click',exportHistory);
  $('#clear-history').addEventListener('click',()=>openDialog('#clear-dialog')); $('#clear-cancel').addEventListener('click',()=>closeDialog('#clear-dialog')); $('#clear-confirm').addEventListener('click',()=>{ clearHistory(); renderHistory(); closeDialog('#clear-dialog'); toast('측정 기록을 삭제했습니다.'); });
  setStatus('환경 확인 중','running'); setProgress(5,'WebGPU 환경 확인');
  const initial=await inspectReadiness(); renderReadiness(initial);
  setProgress(0,'측정 대기'); setStatus(initial.details.device?'준비됨':'WebGPU 미지원',initial.details.device?'idle':'error');
  if (initial.details.device) {
    $('#hf-probe-note').textContent='백그라운드 확인 중';
    probeHfModule().then(async probe => {
      state.hfProbe=probe; const afterProbe=await inspectReadiness({hfModuleAvailable:probe.ok}); renderReadiness(afterProbe);
      $('#hf-probe-note').textContent=probe.ok?'@huggingface/kernels 로더 연결 가능':'벤치마크 실행 시 다시 시도';
    }).catch(()=>{ $('#hf-probe-note').textContent='벤치마크 실행 시 다시 시도'; });
  } else { state.hfProbe={ok:false}; $('#hf-probe-note').textContent='WebGPU 활성화 후 확인'; }
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}

init();
