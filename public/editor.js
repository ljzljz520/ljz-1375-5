import { api, toast } from '/ui.js';
let token = localStorage.getItem('bc_token') || '';
document.querySelector('#token').value = token;
document.querySelector('#token').addEventListener('change', e => {
  token = e.target.value; localStorage.setItem('bc_token', token);
});
const auth = () => ({ 'Content-Type': 'application/json', 'X-Editor': token });
let selectedEx = null;

async function load() {
  await loadRegions();
  await loadExhibits();
  await loadStmts();
  const v = await api('/api/publication/version');
  document.querySelector('#pubVersion').textContent = v ? `当前发布版本：${v.id}（${v.count} 条）` : '尚未发布';
}
async function loadRegions() {
  const regions = await api('/api/regions');
  for (const id of ['sRegion', 'rRegion']) {
    const sel = document.querySelector('#' + id);
    sel.innerHTML = regions.map(r => `<option value="${r.id}">${r.currentName}</option>`).join('');
  }
}
async function loadExhibits() {
  const list = await api('/api/exhibits');
  const ul = document.querySelector('#exList');
  ul.innerHTML = '';
  for (const ex of list) {
    const li = document.createElement('li');
    li.textContent = `${ex.title.zh} [${ex.type}]${ex.onSite ? '' : '（外借）'}${ex.imageAvailable ? '' : '（图片受限）'}`;
    li.dataset.id = ex.id;
    li.onclick = () => { selectedEx = ex; document.querySelector('#exOps').hidden = false;
      ul.querySelectorAll('li').forEach(x => x.classList.toggle('active', x === li)); };
    ul.appendChild(li);
  }
}
async function loadStmts() {
  let stmts;
  try {
    stmts = await api('/api/statements?scope=editor', { headers: { 'X-Editor': token } });
  } catch { stmts = []; toast('需正确令牌才能查看草稿/撤回'); }
  const ul = document.querySelector('#stmtList');
  ul.innerHTML = '';
  for (const s of stmts) {
    const li = document.createElement('li');
    const status = s.retracted ? '已撤回' : s.status === 'approved' ? '已批准' : '草稿';
    li.innerHTML = `<strong>[${status}]</strong> ${s.interpretation.zh.slice(0, 40)}…
      <span class="muted">${s.subjectType}:${s.subjectId} / ${s.regionId} / ${s.era.start}-${s.era.end}${s.disputed ? ' / 争议' : ''}</span>
      <div class="muted">${s.source.title}${s.retraction ? '｜撤回：' + s.retraction.reason : ''}</div>`;
    const row = document.createElement('div');
    if (s.status === 'draft' && !s.retracted) row.appendChild(btn('批准', async () => { await act(s.id, 'review', { decision: 'approve' }); reload(); }));
    if (!s.retracted) row.appendChild(btn('来源撤回', async () => { await act(s.id, 'retract', { reason: '来源方撤回' }); reload(); }));
    li.appendChild(row);
    ul.appendChild(li);
  }
}
function btn(label, fn) { const b = document.createElement('button'); b.textContent = label; b.style.marginRight = '6px'; b.onclick = fn; return b; }
async function act(id, action, payload) {
  await api(`/api/statements/${id}/${action}`, { method: 'POST', headers: auth(), body: JSON.stringify(payload) });
}
const reload = () => { loadStmts(); loadExhibits(); };

document.querySelector('#addStmt').onclick = async () => {
  try {
    await api('/api/statements', { method: 'POST', headers: auth(), body: JSON.stringify({
      subjectType: document.querySelector('#sSubjectType').value,
      subjectId: document.querySelector('#sSubjectId').value,
      regionId: document.querySelector('#sRegion').value,
      era: { start: Number(document.querySelector('#sStart').value), end: Number(document.querySelector('#sEnd').value) },
      source: { kind: document.querySelector('#sSourceKind').value, title: document.querySelector('#sSourceTitle').value },
      interpretation: { zh: document.querySelector('#sText').value, en: document.querySelector('#sTextEn').value || null },
      disputed: document.querySelector('#sDisputed').checked,
      disputeNote: document.querySelector('#sDisputeNote').value || null,
    }) });
    toast('已创建草稿（批准并发布后才对访客可见）'); reload();
  } catch (e) { toast(e.message); }
};
document.querySelector('#renameBtn').onclick = async () => {
  try {
    await api(`/api/regions/${document.querySelector('#rRegion').value}/rename`, { method: 'POST', headers: auth(), body: JSON.stringify({
      newName: document.querySelector('#rNewName').value,
      effectiveYear: Number(document.querySelector('#rYear').value),
      reason: document.querySelector('#rReason').value,
    }) });
    toast('称呼已改版，旧称保留为曾用名'); loadRegions();
  } catch (e) { toast(e.message); }
};
document.querySelector('#loanBtn').onclick = async () => {
  const detail = await api('/api/exhibits/' + selectedEx.id);
  await api(`/api/exhibits/${selectedEx.id}/loan`, { method: 'POST', headers: auth(), body: JSON.stringify({ active: !detail.loan.active, borrower: '外部展馆' }) });
  reload(); toast('借出状态已更新（仅影响现场可见性）');
};
document.querySelector('#photoBtn').onclick = async () => {
  const detail = await api('/api/exhibits/' + selectedEx.id);
  await api(`/api/exhibits/${selectedEx.id}/photo-permission`, { method: 'POST', headers: auth(), body: JSON.stringify({ allowed: !detail.photoAllowed }) });
  reload(); toast('拍摄许可已更新（仅影响图片渠道）');
};
document.querySelector('#detailBtn').onclick = async () => {
  if (!selectedEx.imageId) return toast('该展品无图像');
  if (!selectedEx.photoAllowed) return toast('拍摄许可未开放，不能生成图片渠道任务');
  const x = Number(prompt('裁切起点 x（0-1）', '0.1'));
  const y = Number(prompt('裁切起点 y（0-1）', '0.1'));
  const w = Number(prompt('裁切宽 w（0-1）', '0.5'));
  const h = Number(prompt('裁切高 h（0-1）', '0.5'));
  await api('/api/media-tasks', { method: 'POST', headers: auth(), body: JSON.stringify({ imageId: selectedEx.imageId, crop: { x, y, w, h }, title: '自定义细节图' }) });
  toast('媒体任务已生成（标注按裁切换算，区外标注标 outside）');
};
document.querySelector('#publishBtn').onclick = async () => {
  try {
    const pub = await api('/api/publish', { method: 'POST', headers: auth(), body: '{}' });
    toast(`已发布 ${pub.count} 条陈述，版本 ${pub.id}`); load();
  } catch (e) { toast(e.message); }
};

load().catch(e => toast(e.message));
