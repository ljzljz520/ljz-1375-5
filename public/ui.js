// 共享 UI 小工具
export function toast(msg) {
  let t = document.querySelector('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2600);
}

export async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || res.statusText), { status: res.status, data });
  return data;
}

// 翻译缺失回退：缺 en/tai 时显示中文，并标注「（暂无译文，显示中文）」。
export function localize(record, lang) {
  if (!record) return { html: '<span class="muted">—</span>' };
  if (lang === 'zh' || !lang) return { text: record.zh || '', fellBack: false };
  const v = record[lang];
  if (v) return { text: v, fellBack: false };
  return { text: record.zh || '', fellBack: true };
}

export const TYPE_LABEL = { historical: '历史实物', stage_reconstruction: '舞台复原', contemporary_daily: '当代日常' };
