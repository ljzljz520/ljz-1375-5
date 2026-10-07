import { api, toast, localize, TYPE_LABEL } from '/ui.js';
import { keyToAction, detailReducer } from '/src/keyboard.js';

const LANG = location.hash.replace('#', '') || 'zh';
const id = new URLSearchParams(location.search).get('id');
let ex = null;
let tasks = [];
let ui = { open: false, index: 0 };

const scope = new URLSearchParams(location.search);
function detailUrl() {
  const p = new URLSearchParams();
  for (const k of ['regionId', 'eraStart', 'eraEnd', 'eraMode']) if (scope.get(k)) p.set(k, scope.get(k));
  const qs = p.toString();
  return '/api/exhibits/' + id + (qs ? '?' + qs : '');
}
async function init() {
  const regions = await api('/api/regions').catch(() => []);
  const sel = document.querySelector('#scopeRegion');
  for (const r of regions) {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.currentName;
    sel.appendChild(o);
  }
  sel.value = scope.get('regionId') || '';
  document.querySelector('#scopeStart').value = scope.get('eraStart') || '';
  document.querySelector('#scopeEnd').value = scope.get('eraEnd') || '';
  document.querySelector('#scopeMode').value = scope.get('eraMode') || 'overlap';
  document.querySelector('#scopeBar').hidden = false;
  document.querySelector('#scopeApply').onclick = () => {
    for (const [k, v] of [
      ['regionId', sel.value], ['eraStart', document.querySelector('#scopeStart').value],
      ['eraEnd', document.querySelector('#scopeEnd').value], ['eraMode', document.querySelector('#scopeMode').value],
    ]) v ? scope.set(k, v) : scope.delete(k);
    history.replaceState(null, '', location.pathname + '?' + scope.toString() + '#' + LANG);
    reloadDetail();
  };
  document.querySelector('#scopeClear').onclick = () => {
    ['regionId','eraStart','eraEnd','eraMode'].forEach(k => scope.delete(k));
    location.search = '?id=' + encodeURIComponent(id);
  };
  await reloadDetail();
}
async function reloadDetail() {
  try {
    ex = await api(detailUrl());
  } catch (e) {
    if (e.status === 404 && navigator.onLine === false) return renderOffline();
    throw e;
  }
  tasks = ex.mediaTasks;
  render();
}

function render() {
  const root = document.querySelector('#detail');
  const badges = [`<span class="badge type">${TYPE_LABEL[ex.type]}</span>`];
  if (!ex.onSite) badges.push('<span class="badge loan">外借中：现场不可见（历史说明不变）</span>');
  if (!ex.imageAvailable) badges.push('<span class="badge restricted">拍摄许可未开放图片渠道</span>');

  const imageBlock = ex.imageAvailable
    ? `<div class="img-stage" id="imgStage">
         <img src="/api/exhibits/${ex.id}/image" alt="${ex.title.zh}" id="mainImg">
         <div id="hotspots"></div>
       </div>
       ${tasks.length ? `<h3>细节图（媒体任务）</h3><div id="taskList"></div>` : ''}`
    : `<div class="muted">本展品图片渠道受限或暂无图片，以下经授权文字内容照常展示。</div>`;

  root.innerHTML = `
    <h2>${ex.title.zh} <button class="ghost fav" id="favBtn" aria-pressed="false">☆ 收藏（离线可读）</button></h2>
    <div>${badges.join(' ')}</div>
    <p class="muted">${ex.region ? ex.region.currentName : ''} · ${ex.era ? ex.era.start + '–' + ex.era.end : ''}</p>
    <div class="pubmeta">发布版本：${ex.publicationVersion ?? '（未发布）'}</div>
    <section class="block">${imageBlock}</section>
    <section class="block">
      <h3>本展品语境的解释（${ex.statements.length}${ex.unfilteredStatementCount != null && ex.unfilteredStatementCount !== ex.statements.length ? ' / 共 ' + ex.unfilteredStatementCount + '，已按范围筛选' : ''}）</h3>
      <div id="stmts"></div>
      <h3>相似纹样的跨语境对照（${(ex.comparableStatements || []).length}）</h3>
      <p class="muted">图形相似但语境不同的独立解释，来源与含义并列对照，不与本展品解释合并。</p>
      <div id="comparable"></div>
    </section>`;

  // 热点（以任务中标注 mapped 的坐标叠到主图上）
  if (ex.imageAvailable) renderHotspots();
  if (ex.imageAvailable && tasks.length) renderTasks();
  renderStatements(ex.statements, 'stmts');
  renderStatements(ex.comparableStatements || [], 'comparable');
  bindFav();
}

function renderHotspots() {
  // 用第一个细节任务的 mapped 标注，经裁切逆变换反算回「原图坐标」覆盖在主图上。
  const host = document.querySelector('#hotspots');
  if (!tasks.length || !host) return;
  const task = tasks[0];
  const mapped = task.annotations.filter(a => a.status === 'mapped');
  host.innerHTML = '';
  mapped.forEach((a, i) => {
    // orig = crop.start + detail * crop.size（修复图像裁切导致的标注偏移）
    const ox = task.crop.x + a.x * task.crop.w;
    const oy = task.crop.y + a.y * task.crop.h;
    const b = document.createElement('button');
    b.className = 'hotspot';
    b.textContent = i + 1;
    b.setAttribute('aria-label', `标注：${a.label}，按 Enter 查看细节`);
    b.style.left = `${ox * 100}%`;
    b.style.top = `${oy * 100}%`;
    b.addEventListener('click', () => openDetail(i));
    b.addEventListener('keydown', onKey);
    host.appendChild(b);
  });
}

function renderTasks() {
  const list = document.querySelector('#taskList');
  tasks.forEach((t, ti) => {
    const box = document.createElement('div');
    box.innerHTML = `<figure>
      <img src="/api/media-tasks/${t.id}/image" alt="${t.title}" style="max-width:300px;border-radius:8px">
      <figcaption class="muted">${t.title} · 裁切 ${JSON.stringify(t.crop)}</figcaption>
      <ul>${t.annotations.map(a => `<li>${a.status === 'mapped'
        ? `✓ ${a.label} → (${a.x}, ${a.y})`
        : `<span style="color:var(--warn)">⊘ ${a.label}：${a.reason}</span>`}</li>`).join('')}</ul>
    </figure>`;
    list.appendChild(box);
  });
}

function renderStatements(stmts, hostId = 'stmts') {
  const host = document.querySelector('#' + hostId);
  if (!stmts.length) { host.innerHTML = '<p class="muted">当前发布版本暂无解释。</p>'; return; }
  host.innerHTML = stmts.map(s => {
    const loc = localize(s.interpretation, LANG);
    const fb = loc.fellBack ? '<div class="fallback-note">⚠ 该语言翻译缺失，回退显示中文原文。</div>' : '';
    const disp = s.disputed ? '<span class="badge disputed">争议</span>' : '';
    const review = s.review?.note ? `<div class="muted">审校结论：${s.review.note}</div>` : '';
    return `<div class="statement">
      ${disp}<div>${loc.text}</div>${fb}
      <div class="source">来源：${s.source.kind}｜${s.source.title}${s.source.author ? '，' + s.source.author : ''}${s.source.year ? '，' + s.source.year : ''}
        ｜地区：${s.regionName}｜年代：${s.era.start}–${s.era.end}｜可信度：${s.confidence}</div>
      ${s.disputed && s.disputeNote ? `<div class="source">争议说明：${s.disputeNote}</div>` : ''}
      ${review}
    </div>`;
  }).join('');
}

// ---- 键盘查看细节 ----
function onKey(e) {
  const count = document.querySelectorAll('.hotspot').length;
  const action = keyToAction(e.key, { open: ui.open });
  if (!action) return;
  e.preventDefault();
  ui = detailReducer(ui, action, count);
  applyUi();
}
function openDetail(i) { ui = detailReducer({ open: false, index: i }, 'open'); applyUi(); }

function applyUi() {
  const dlg = document.querySelector('#detailDialog');
  const mapped = tasks[0]?.annotations.filter(a => a.status === 'mapped') ?? [];
  document.querySelectorAll('.hotspot').forEach((h, i) => h.classList.toggle('active', i === ui.index));
  if (ui.open) {
    const a = mapped[ui.index];
    document.querySelector('#detailLabel').textContent = a ? `${ui.index + 1}. ${a.label}` : '';
    const img = document.querySelector('#detailImg');
    img.innerHTML = `<img src="/api/media-tasks/${tasks[0].id}/image" alt="${a?.label ?? ''}">`;
    if (!dlg.open) dlg.showModal();
  } else if (dlg.open) dlg.close();
}
document.addEventListener('keydown', e => {
  if (document.querySelector('#detailDialog').open) {
    const action = keyToAction(e.key, { open: true });
    if (action) { e.preventDefault(); ui = detailReducer(ui, action, document.querySelectorAll('.hotspot').length); applyUi(); }
  }
});
document.querySelector('#closeDetail').addEventListener('click', () => { ui = detailReducer(ui, 'close'); applyUi(); });

// ---- 收藏 / 离线 ----
async function bindFav() {
  const favs = await api('/api/favorites');
  const btn = document.querySelector('#favBtn');
  const on = favs.some(f => f.exhibitId === id);
  btn.textContent = on ? '★ 已收藏' : '☆ 收藏（离线可读）';
  btn.setAttribute('aria-pressed', String(on));
  btn.onclick = async () => {
    if (btn.getAttribute('aria-pressed') === 'true') {
      await api('/api/favorites/' + id, { method: 'DELETE' });
      toast('已取消收藏');
    } else {
      await api('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exhibitId: id }) });
      toast('已收藏，离线可读（仅缓存已授权内容）');
    }
    await cacheOffline();
    bindFav();
  };
}
async function cacheOffline() {
  const bundle = await api('/api/exhibits/' + id + '/offline');
  const cache = await caches.open('bc-exhibit-v1');
  await cache.put('/offline/' + id, new Response(JSON.stringify(bundle), { headers: { 'Content-Type': 'application/json' } }));
  // 仅当图片许可时缓存图片；无许可图片永不进缓存
  if (bundle.image.cacheable && bundle.image.imageId) {
    try { await cache.add('/api/exhibits/' + id + '/image'); } catch { /* 离线时可能失败，忽略 */ }
  }
}

async function renderOffline() {
  document.querySelector('#offlineBanner').hidden = false;
  const cache = await caches.open('bc-exhibit-v1');
  const resp = await cache.match('/offline/' + id);
  if (!resp) { document.querySelector('#detail').innerHTML = '<p>离线且该展品未被收藏，无法显示。</p>'; return; }
  ex = await resp.json();
  ex.imageAvailable = false; // 离线回归：不尝试受限图片
  render();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
init().catch(e => toast(e.message));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
