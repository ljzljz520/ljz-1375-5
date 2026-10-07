import { toast } from '/ui.js';
const $ = s => document.querySelector(s);
const TYPE_LABEL = { historical: '历史实物', stage_reconstruction: '舞台复原', contemporary_daily: '当代日常' };

async function init() {
  const regions = await api('/api/regions');
  for (const r of regions) {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.currentName + (r.formerNames.length > 1 ? `（旧称：${r.formerNames.slice(0, -1).join('、')}）` : '');
    $('#fRegion').appendChild(o);
  }
  await runSearch();
  $('#btnSearch').addEventListener('click', runSearch);
  $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
}

async function runSearch() {
  const params = new URLSearchParams();
  if ($('#q').value.trim()) params.set('q', $('#q').value.trim());
  if ($('#fType').value) params.set('type', $('#fType').value);
  if ($('#fRegion').value) params.set('regionId', $('#fRegion').value);
  if ($('#fStart').value) params.set('eraStart', $('#fStart').value);
  if ($('#fEnd').value) params.set('eraEnd', $('#fEnd').value);
  if ($('#fOnSite').checked) params.set('onSite', 'true');
  params.set('eraMode', $('#fEraMode').value);

  const data = await api('/api/exhibits-search?' + params.toString());
  $('#searchMeta').textContent = `索引版本 ${data.version ?? '（未发布）'} · 展品 ${data.exhibits.length} 件`;

  const grid = $('#grid');
  grid.innerHTML = '';
  if (!data.exhibits.length) grid.innerHTML = '<p class="muted">没有符合范围条件的展品。</p>';
  for (const ex of data.exhibits) grid.appendChild(card(ex));
}

function card(ex) {
  const el = document.createElement('article');
  el.className = 'card';
  const badges = [`<span class="badge type">${TYPE_LABEL[ex.type]}</span>`];
  if (!ex.onSite) badges.push('<span class="badge loan">外借中·现场不可见</span>');
  if (!ex.imageAvailable) badges.push('<span class="badge restricted">图片受限/无图</span>');
  el.innerHTML = `
    <a class="thumb" href="/exhibit.html?id=${encodeURIComponent(ex.id)}" aria-label="查看 ${ex.title.zh}">
      ${ex.imageAvailable ? `<img src="/api/exhibits/${ex.id}/image" alt="">` : `<span>文字内容可阅</span>`}
    </a>
    <div class="body">
      <h3 style="margin:0"><a href="/exhibit.html?id=${encodeURIComponent(ex.id)}">${ex.title.zh}</a></h3>
      <div>${badges.join(' ')}</div>
      <div class="muted">${ex.region?.currentName ?? ''} · ${ex.era ? `${ex.era.start}–${ex.era.end}` : ''}</div>
      <div class="muted">范围内解释 ${ex.matchedStatementCount ?? ex.statements?.length ?? 0} 条</div>
    </div>`;
  return el;
}

export async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || res.statusText);
  }
  return res.json();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
init().catch(e => toast(e.message));
