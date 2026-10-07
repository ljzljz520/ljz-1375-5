/* 边城服饰数字展 · 公开端（原生 JS，含离线回归 / 键盘细节查看） */
"use strict";

const state = { lang: localStorage.getItem("lang") || "zh", refs: null, ver: 0 };
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => (s == null ? "" :
  String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2600);
}

/* 语言：翻译缺失时回退中文并显式标注，绝不静默替换 */
function L(zh, en) {
  if (state.lang === "en") {
    if (en != null && en !== "") return esc(en);
    return `<span class="missing-i18n" title="暂无英文翻译">${esc(zh)}（中文原文 / EN pending）</span>`;
  }
  return esc(zh);
}

/* 网络优先 + 已发布快照回退（离线回归） */
async function api(path, { fallbackKey } = {}) {
  const cacheKey = "snap:" + (fallbackKey || path);
  try {
    const res = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const snap = { data, version: data.publication_version || state.ver || null, at: Date.now() };
    localStorage.setItem(cacheKey, JSON.stringify(snap));
    return data;
  } catch (e) {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      showOffline();
      const snap = JSON.parse(raw);
      snap.__offline = true;
      return snap.data;
    }
    throw e;
  }
}
function showOffline() {
  const b = $("#offlineBanner"); b.classList.add("show");
}
window.addEventListener("online", () => location.reload());
window.addEventListener("offline", showOffline);

/* 收藏：离线可打开 */
function favorites() { return JSON.parse(localStorage.getItem("favs") || "[]"); }
function toggleFav(id) {
  const f = new Set(favorites());
  f.has(id) ? f.delete(id) : f.add(id);
  localStorage.setItem("favs", JSON.stringify([...f]));
}

/* ------------------------------------------------------------------ 路由 */
function go() {
  const h = location.hash || "#/";
  const m = h.match(/^#\/exhibit\/(\d+)/);
  const mm = h.match(/^#\/motif\/(\d+)/);
  if (m) return renderExhibit(+m[1]);
  if (mm) return renderMotif(+mm[1]);
  return renderHome();
}
window.addEventListener("hashchange", go);

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-fav]");
  if (b) { toggleFav(+b.dataset.fav); b.textContent = "★ 已收藏"; toast("已加入离线收藏"); }
});
document.addEventListener("change", (e) => {
  if (e.target.name === "lang") { state.lang = e.target.value; localStorage.setItem("lang", state.lang); go(); }
});
document.querySelectorAll(".lang-toggle button").forEach(b => b.addEventListener("click", () => {
  state.lang = b.dataset.lang; localStorage.setItem("lang", state.lang);
  document.querySelectorAll(".lang-toggle button").forEach(x => x.classList.toggle("on", x === b));
  go();
}));

/* ------------------------------------------------------------------ 首页 */
async function renderHome() {
  if (!state.refs) state.refs = await api("/api/refs");
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const q = params.get("q") || "";
  const app = $("#app");
  app.innerHTML = `
    <div class="panel">
      <form class="filters" id="searchForm">
        <input type="search" name="q" value="${esc(q)}" placeholder="搜索展品、纹样、称呼、解释正文…">
        <select name="region"><option value="">全部地区</option>
          ${state.refs.regions.map(r => `<option value="${r.id}">${esc(r.name_zh)}</option>`).join("")}
        </select>
        <select name="era"><option value="">全部年代</option>
          ${state.refs.eras.map(r => `<option value="${r.id}">${esc(r.name_zh)}</option>`).join("")}
        </select>
        <select name="type"><option value="">全部类型</option>
          ${state.refs.types.map(r => `<option value="${r.id}">${esc(r.name_zh)}</option>`).join("")}
        </select>
        <button type="submit">筛选解释</button>
      </form>
      <p class="muted">范围匹配：地区按层级包含、年代按区间相交、类型必须一致；
        相似纹样在不同语境下的解释<b>不合并</b>。当前发布版本 v${state.refs.version}。</p>
    </div>
    <div class="grid" id="cards"><p class="muted">载入中…</p></div>`;
  const sf = $("#searchForm");
  sf.addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(sf);
    const p = new URLSearchParams();
    for (const [k, v] of fd) if (v) p.set(k, v);
    location.hash = "#/?" + p.toString();
  });
  ["region", "era", "type"].forEach(k => {
    if (params.get(k)) sf[k].value = params.get(k);
  });

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  ["region", "era", "type"].forEach(k => { const v = params.get(k); if (v) qs.set(k, v); });
  const url = q ? "/api/search?" + qs.toString() : "/api/exhibits?" + qs.toString();
  const data = await api(url);
  const items = data.results ? data.results.filter(r => r.kind === "exhibit") :
    (data.exhibits || []).map(e => ({ exhibit: e }));
  $("#cards").innerHTML = items.length ? items.map(it => card(it.exhibit)).join("") :
    `<p class="muted">没有符合该范围的展品/解释。</p>`;
}

function typeBadge(ex) {
  const cls = { relic: "relic", stage: "stage", daily: "" }[ex.type_code] || "";
  return `<span class="badge ${cls}">${L(ex.type_name, ex.type_name)}</span>`;
}
function card(ex) {
  const img = ex.images && ex.images[0];
  return `<a class="card" href="#/exhibit/${ex.id}">
    ${img ? `<img src="${esc(img.url)}" alt="${esc(img.alt_zh || "")}">` :
      `<div class="thumb">图片不可用 · 文字解说照常开放</div>`}
    <div class="body">
      <h3>${L(ex.title_zh, ex.title_en)}</h3>
      <div class="muted">${esc(ex.region_name || "")} · ${esc(ex.era_name || "")} · ${esc(ex.year_detail || "")}</div>
      <div class="badges">${typeBadge(ex)}
        ${ex.is_on_loan ? `<span class="badge loan">外借中 · 现场暂不可见</span>` : ""}
      </div>
    </div></a>`;
}

/* ------------------------------------------------------------- 展品详情 */
async function renderExhibit(id) {
  const p = new URLSearchParams(location.hash.split("?")[1] || "");
  const qs = new URLSearchParams();
  ["region", "era", "type"].forEach(k => { if (p.get(k)) qs.set(k, p.get(k)); });
  const ex = await api(`/api/exhibit/${id}?${qs}`, { fallbackKey: `exhibit:${id}` });
  const fav = favorites().includes(id);
  const app = $("#app");
  app.innerHTML = `
    <p><a href="#/">← 返回展厅</a></p>
    <div class="panel">
      <h2 style="margin:0 0 4px">${L(ex.title_zh, ex.title_en)}
        <span class="sub">v${ex.publication_version}</span></h2>
      <div class="muted">${esc(ex.region_name)} · ${esc(ex.era_name)} · ${esc(ex.year_detail || "")}</div>
      <div class="badges" style="margin:8px 0">
        ${typeBadge(ex)}
        ${ex.is_on_loan ? `<span class="badge loan">外借中：现场暂不可见（历史文字说明不因此改写）</span>`
          : `<span class="badge">现场可见</span>`}
      </div>
      <p>${L(ex.summary_zh, ex.summary_en)}</p>
      <button class="ghost small" data-fav="${ex.id}">${fav ? "★ 已收藏" : "☆ 收藏（可离线回看）"}</button>
    </div>

    <div class="panel">
      <h3 style="margin:0 0 6px">地区称呼</h3>
      ${ex.appellations.map(a => `<div>
        <b>${esc(a.term_zh)}</b>${a.term_en ? " · " + esc(a.term_en) : ""}
        ${a.phonetic ? ` <span class="muted">${esc(a.phonetic)}</span>` : ""}
        ${a.superseded_by ? `<span class="badge retracted">旧称 · 已改版</span>` : ""}
        ${a.changed_note ? `<div class="muted">${esc(a.changed_note)} ${a.changed_at ? "（" + esc(a.changed_at) + "）" : ""}</div>` : ""}
      </div>`).join("")}
      <h3 style="margin:12px 0 6px">穿着场合</h3>
      <div class="badges">${ex.occasions.map(o =>
        `<span class="badge">${L(o.name_zh, o.name_en)}</span>`).join("")}</div>
    </div>

    ${ex.motifs.map(m => motifBlock(m)).join("") || ""}

    <div class="panel">
      <h3 style="margin:0 0 8px">媒体与细节图</h3>
      ${ex.media.map(m => mediaBlock(m)).join("")}
    </div>`;
  mountViewer(app);
}

function motifBlock(m) {
  const inScope = m.statements.filter(s => s.in_scope);
  const outScope = m.statements.filter(s => !s.in_scope);
  return `<div class="panel statement-group">
    <h3 style="margin:0 0 4px">纹样：${L(m.name_zh, m.name_en)}
      <span class="sub">位于 ${esc(m.placement || "")}</span>
      <a href="#/motif/${m.id}">查看跨语境全部解释 →</a></h3>
    <p class="muted">下列解释按 地区 / 年代 / 类型 分别成立；相同图案也<b>不合并</b>。</p>
    ${inScope.map(stmtCard).join("")}
    ${outScope.length ? `<details class="scope-off"><summary class="muted">另有 ${outScope.length} 条解释属于其他语境（舞台/实物/日常不同语境）</summary>
      ${outScope.map(stmtCard).join("")}</details>` : ""}
  </div>`;
}

function stmtCard(s) {
  if (s.redacted) {
    return `<div class="stmt redacted"><b>该解释因来源撤回而不再展示</b>
      <div class="meta"><span>来源：${esc(s.source_title)}（已撤回）</span></div></div>`;
  }
  const conf = { contested: ["contested", "存争议"], resolved: ["resolved", "审校已处理"],
    single: ["badge", "单一说法"], retracted: ["retracted", "已撤回"] }[s.confidence] || ["badge", s.confidence];
  const scopeBits = [s.region_name, s.era_name, s.type_name].filter(Boolean).join(" · ") || "全域";
  return `<div class="stmt ${s.in_scope ? "" : "scope-off"}">
    <div>${L(s.claim_zh, s.claim_en)}</div>
    <div class="meta">
      <span class="badge ${conf[0]}">${conf[1]}</span>
      <span>语境：${esc(scopeBits)}</span>
      <span>具体来源：${esc(s.source_title)}（${esc(s.source_kind)}）</span>
    </div>
    ${s.disputes_claim ? `<div class="dispute">争议针对：“${esc(s.disputes_claim.slice(0, 40))}…”——两说并存，未合并。</div>` : ""}
    ${s.review_note ? `<div class="review">审校结论：${esc(s.review_note)}</div>` : ""}
  </div>`;
}

function mediaBlock(m) {
  if (!m.image_available) {
    return `<div class="img-missing">
      ${m.has_shoot_grant ? "图像尚缺" : "🔒 未取得拍摄许可，图片渠道不展示"}
      <div class="muted">${L(m.alt_zh, m.alt_en)}</div>
      ${m.kind === "detail" ? `<div class="muted">文字解说仍可在上方纹样解释中阅读。</div>` : ""}
    </div>`;
  }
  const anns = m.annotations || [];
  const active = anns.filter(a => a.inside_crop);
  return `<div class="media-row">
    <div class="viewer" tabindex="0" role="application"
         aria-label="细节图查看器：使用 Tab 聚焦，← → 切换标注，Enter 查看说明，+ - 缩放，R 重置"
         data-asset="${m.id}">
      <div class="stage">
        <img src="${esc(m.url)}" alt="${esc(m.alt_zh || "")}" draggable="false">
        <div class="crop" id="crop-${m.id}"
          style="left:${anns[0] ? anns[0].crop_x / 10 : 0}%;top:${anns[0] ? anns[0].crop_y / 10 : 0}%;
                 width:${anns[0] ? anns[0].crop_w / 10 : 100}%;height:${anns[0] ? anns[0].crop_h / 10 : 100}%">
          <img src="${esc(m.url)}" alt="" aria-hidden="true"
            style="left:${anns[0] ? -anns[0].crop_x / 10 : 0}%;top:${anns[0] ? -anns[0].crop_y / 10 : 0}%;
                   width:${anns[0] ? 1000 / anns[0].crop_w * 100 : 100}%;
                   height:${anns[0] ? 1000 / anns[0].crop_h * 100 : 100}%">
          ${active.map((a, i) => `<button class="hotspot" data-i="${i}"
               data-label="${esc(state.lang === "en" ? (a.label_en || a.label_zh) : a.label_zh)}"
               style="left:${(a.x - anns[0].crop_x) / anns[0].crop_w * 100}%;
                      top:${(a.y - anns[0].crop_y) / anns[0].crop_h * 100}%;
                      width:${a.w / anns[0].crop_w * 100}%;height:${a.h / anns[0].crop_h * 100}%"
               aria-label="${esc(a.label_zh)}"></button>`).join("")}
        </div>
        <div class="focuslabel" id="label-${m.id}" hidden></div>
      </div>
    </div>
    <div>
      <h4 style="margin:0 0 6px">${L(m.alt_zh, m.alt_en)}</h4>
      <ul>${active.map((a, i) => `<li><b>${L(a.label_zh, a.label_en)}</b></li>`).join("")}</ul>
      <p class="kbd-help"><kbd>Tab</kbd> 聚焦 · <kbd>←</kbd><kbd>→</kbd> 切换标注 ·
        <kbd>Enter</kbd> 朗读/显示说明 · <kbd>+</kbd>/<kbd>-</kbd> 缩放 · <kbd>R</kbd> 重置
        <br>裁切框外的标注已自动隐藏，避免图像裁切导致标注偏移。</p>
    </div>
  </div>`;
}

/* 键盘可访问的细节查看器（无鼠标可用） */
function mountViewer(root) {
  root.querySelectorAll(".viewer").forEach(v => {
    const id = v.dataset.asset, crop = $("#crop-" + id, v), label = $("#label-" + id, v);
    const spots = [...v.querySelectorAll(".hotspot")];
    let i = -1, scale = 1;
    function select(n) {
      if (!spots.length) return;
      i = (n + spots.length) % spots.length;
      spots.forEach((s, k) => s.classList.toggle("active", k === i));
      const s = spots[i];
      label.hidden = false;
      label.textContent = s.dataset.label || "";
      const r = s.getBoundingClientRect(), cr = crop.getBoundingClientRect();
      label.style.left = (r.left - cr.left + r.width / 2) + "px";
      label.style.top = (r.top - cr.top - 26) + "px";
    }
    v.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { select(i + 1); e.preventDefault(); }
      else if (e.key === "ArrowLeft") { select(i - 1); e.preventDefault(); }
      else if (e.key === "Enter" || e.key === " ") { select(i < 0 ? 0 : i); e.preventDefault(); }
      else if (e.key === "+" || e.key === "=") { scale = Math.min(3, scale + .2); crop.style.transform = `scale(${scale})`; }
      else if (e.key === "-") { scale = Math.max(1, scale - .2); crop.style.transform = `scale(${scale})`; }
      else if (e.key.toLowerCase() === "r") { scale = 1; crop.style.transform = ""; i = -1; spots.forEach(s => s.classList.remove("active")); label.hidden = true; }
    });
    spots.forEach((s, k) => s.addEventListener("click", () => select(k)));
  });
}

/* ------------------------------------------------------------- 纹样总览 */
async function renderMotif(id) {
  const p = new URLSearchParams(location.hash.split("?")[1] || "");
  const app = $("#app");
  if (id) {
    const qs = new URLSearchParams();
    ["region", "era", "type"].forEach(k => { if (p.get(k)) qs.set(k, p.get(k)); });
    const m = await api(`/api/motif/${id}?${qs}`, { fallbackKey: `motif:${id}` });
    app.innerHTML = `<p><a href="#/motifs">← 纹样总览</a></p>
      <div class="panel"><h2 style="margin:0">${L(m.name_zh, m.name_en)}</h2>
        <p class="muted">${esc(m.visual || "")} · 图案相似不等于含义相同。</p></div>
      <div class="panel">${m.statements.map(stmtCard).join("")}</div>
      <div class="panel"><h3 style="margin:0 0 8px">出现于</h3>
        <div class="grid">${m.used_by.map(card).join("")}</div></div>`;
    return;
  }
  const data = await api("/api/motifs");
  app.innerHTML = `<p><a href="#/">← 返回展厅</a></p>
    <div class="panel"><h2 style="margin:0">纹样总览</h2>
    <p class="muted">相似纹样在不同 地区/年代/类型 下可能含义不同，请进入查看分语境解释。</p></div>
    <div class="grid">${data.motifs.map(m =>
      `<a class="card" href="#/motif/${m.id}"><div class="body">
        <h3>${L(m.name_zh, m.name_en)}</h3><div class="muted">${esc(m.visual || "")}</div>
      </div></a>`).join("")}</div>`;
}

go();
