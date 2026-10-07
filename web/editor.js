/* 编辑台：所有写操作进入审校队列；批准后统一发布。 */
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => (s == null ? "" :
  String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
let REF = null;
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");
  clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove("show"),2600);}

async function api(path, opts={}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
  return data;
}
const post = (p, body) => api(p, { method: "POST", body });

async function loadRefs() {
  REF = await api("/api/refs");
  $("#ver").textContent = "已发布 v" + REF.version;
}
const opt = (rows, id) => rows.map(r =>
  `<option value="${r.id}" ${r.id === id ? "selected" : ""}>${esc(r.name_zh)}</option>`).join("");

/* ------------------------------------------------------------- 审校队列 */
async function tabQueue() {
  const [rev, drafts, src] = await Promise.all([
    api("/api/admin/revisions"), api("/api/admin/drafts"), api("/api/admin/sources")]);
  const srcMap = Object.fromEntries(src.sources.map(s => [s.id, s.title]));
  $("#tab-queue").innerHTML = `
    <div class="panel" style="display:flex;align-items:center;gap:12px">
      <button id="publish">✓ 编辑批准并统一发布</button>
      <span class="muted">将所有“已批准”修订一次性应用：更新搜索索引、展品详情并提升版本；
        撤回来源关联的解释立刻从公开页与索引移除。</span>
    </div>
    <div class="panel">
      <h3 style="margin:0 0 8px">修订队列</h3>
      <table><thead><tr><th>#</th><th>对象</th><th>动作</th><th>内容</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rev.revisions.map(r => `<tr>
        <td>${r.id}</td><td>${esc(r.entity_table)}${r.entity_id ? "#" + r.entity_id : ""}</td>
        <td>${esc(r.action)}</td>
        <td class="muted" style="max-width:340px">${esc((r.note || r.payload).slice(0, 160))}</td>
        <td class="status-${r.status}">${r.status}</td>
        <td>${r.status === "pending" ? `
          <button class="small" onclick="decide(${r.id},'approve')">批准</button>
          <button class="small ghost" onclick="decide(${r.id},'reject')">驳回</button>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan=6 class="muted">暂无修订</td></tr>`}</tbody></table>
    </div>
    <div class="panel">
      <h3 style="margin:0 0 8px">当前陈述（含草稿/撤回）</h3>
      <table><thead><tr><th>#</th><th>主题</th><th>解释（节选）</th><th>来源</th><th>状态</th></tr></thead>
      <tbody>${drafts.statements.map(s => `<tr>
        <td>${s.id}</td><td>${esc(s.subject_type)}#${s.subject_id}</td>
        <td style="max-width:360px">${esc((s.claim_zh || "").slice(0, 80))}</td>
        <td>${esc(srcMap[s.source_id] || s.source_id)}</td>
        <td class="status-${s.status === "approved" ? "approved" : "pending"}">${s.status}</td>
      </tr>`).join("")}</tbody></table>
      <h3>发布历史</h3>
      <table><tbody>${drafts.publications.map(p =>
        `<tr><td>v${p.version}</td><td>${esc(p.note || "")}</td><td>${esc(p.created_at)}</td></tr>`)
        .join("")}</tbody></table>
    </div>`;
  $("#publish").onclick = async () => {
    const r = await post("/api/admin/publish", { note: "编辑批准统一发布" });
    toast(`已发布 v${r.version}：搜索与详情已统一更新，旧索引已清除`);
    await loadRefs(); tabQueue();
  };
}
async function decide(id, d) {
  await post(`/api/admin/revision/${id}/${d === "approve" ? "approve" : "reject"}`,
    { reviewer: "curator" });
  toast(d === "approve" ? "已批准（发布后生效）" : "已驳回");
  tabQueue();
}
window.decide = decide;

/* ------------------------------------------------------------- 新增解释 */
async function tabStatement() {
  const motifs = await api("/api/motifs");
  $("#tab-statement").innerHTML = `<div class="panel">
    <h3 style="margin:0 0 8px">新增多来源解释（不合并相似图案）</h3>
    <form id="f">
      <p><label>纹样</label><br><select name="subject_id">${motifs.motifs.map(m =>
        `<option value="${m.id}">${esc(m.name_zh)}</option>`).join("")}</select></p>
      <p><label>适用地区（留空=全域）</label><br>
        <select name="region_id"><option value="">全域/不限</option>${opt(REF.regions)}</select></p>
      <p><label>适用年代（留空=不限）</label><br>
        <select name="era_id"><option value="">不限</option>${opt(REF.eras)}</select></p>
      <p><label>适用类型（历史实物/舞台复原/当代日常独立）</label><br>
        <select name="type_id"><option value="">不限</option>${opt(REF.types)}</select></p>
      <p><label>具体来源</label><br><select name="source_id" id="sourceSel"></select></p>
      <p><label>解释正文（中文）</label><br>
        <textarea name="claim_zh" rows="3" cols="90" required></textarea></p>
      <p><label>英文（可留空，前台会标注翻译缺失）</label><br>
        <textarea name="claim_en" rows="2" cols="90"></textarea></p>
      <p><label>争议性质</label><br>
        <select name="confidence">
          <option value="single">单一说法</option>
          <option value="contested">存争议（与另一说并存）</option>
          <option value="resolved">审校已处理（结论写在下方）</option></select></p>
      <p><label>审校结论 / 争议说明</label><br>
        <textarea name="review_note" rows="2" cols="90"></textarea></p>
      <button>提交审校队列</button>
    </form></div>`;
  const srcs = await api("/api/admin/sources");
  $("#sourceSel").innerHTML = srcs.sources.map(s =>
    `<option value="${s.id}" ${s.is_retracted ? "disabled" : ""}>${esc(s.title)}
     ${s.is_retracted ? "（已撤回，不可选）" : ""}</option>`).join("");
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), p = {};
    for (const [k, v] of fd) p[k] = k.endsWith("_id") && v ? +v : (v || null);
    p.subject_type = "motif"; p.status = "draft";
    await post("/api/admin/queue", { table: "statements", action: "upsert", payload: p,
      note: "新增解释：" + (p.claim_zh || "").slice(0, 40) });
    toast("已进入审校队列"); switchTab("queue");
  };
}

/* ------------------------------------------------------------- 来源管理 */
async function tabSources() {
  const srcs = await api("/api/admin/sources");
  $("#tab-sources").innerHTML = `<div class="panel">
    <h3 style="margin:0 0 8px">来源撤回</h3>
    <p class="muted">撤回来源后，其名下所有解释在<b>下一次发布</b>时从公开页与搜索索引移除，
      仅保留撤回痕迹；修订队列里也能看到。</p>
    <table><thead><tr><th>#</th><th>名称</th><th>类型</th><th>著录</th><th>状态</th><th></th></tr></thead>
    <tbody>${srcs.sources.map(s => `<tr>
      <td>${s.id}</td><td>${esc(s.title)}</td><td>${esc(s.kind)}</td>
      <td class="muted">${esc(s.citation || "")}</td>
      <td>${s.is_retracted ? `<span class="badge retracted">已撤回</span>` : "正常"}</td>
      <td>${s.is_retracted ? "" :
        `<button class="small ghost" onclick="retractSource(${s.id})">撤回此来源</button>`}</td>
    </tr>`).join("")}</tbody></table>
    <h3>登记新来源</h3>
    <form id="srcForm" class="filters">
      <input name="title" placeholder="来源标题" required>
      <select name="kind"><option value="publication">文献</option>
        <option value="fieldwork">田野口述</option><option value="archive">档案</option>
        <option value="museum">博物馆</option><option value="stage">舞台资料</option></select>
      <input name="author" placeholder="作者/受访者">
      <input name="citation" placeholder="完整著录" style="min-width:260px">
      <button>提交审校</button></form></div>`;
  $("#srcForm").onsubmit = async (e) => {
    e.preventDefault();
    const p = Object.fromEntries(new FormData(e.target));
    await post("/api/admin/queue", { table: "sources", payload: p, note: "登记来源 " + p.title });
    toast("来源登记已进入审校队列"); switchTab("sources");
  };
}
async function retractSource(id) {
  if (!confirm("确认撤回该来源？发布后其解释将不再公开展示。")) return;
  await post("/api/admin/queue",
    { table: "sources", id, action: "retract", payload: { note: "来源撤回（编辑发起）" } });
  toast("撤回请求已进入审校队列"); switchTab("sources");
}
window.retractSource = retractSource;

/* ------------------------------------------------------------- 称呼改版 */
async function tabAppellation() {
  const ex = await api("/api/exhibits");
  $("#tab-appellation").innerHTML = `<div class="panel">
    <h3 style="margin:0 0 8px">地区称呼改版</h3>
    <p class="muted">新称呼不覆盖旧称呼：旧条目标记 superseded_by 并保留改名说明，
      旧称呼仍可被检索，公开页以“旧称·已改版”显示。</p>
    <form id="aForm">
      <p><label>地区</label><br><select name="region_id">${opt(REF.regions)}</select></p>
      <p><label>新称呼（中文）</label> <input name="term_zh" required>
         <label>英文</label> <input name="term_en">
         <label>读音</label> <input name="phonetic" placeholder="tiāo-huā xiù"></p>
      <p><label>变更说明</label><br><textarea name="changed_note" rows="2" cols="90"></textarea></p>
      <p><label>关联展品（可选）</label><br><select name="exhibit_id">
        <option value="">不关联</option>${ex.exhibits.map(x =>
          `<option value="${x.id}">${esc(x.title_zh)}</option>`).join("")}</select></p>
      <button>提交改版审校</button>
    </form></div>
    <div class="panel" id="aResult"></div>`;
  $("#aForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), p = {}, exhibit = +fd.get("exhibit_id") || null;
    for (const [k, v] of fd) if (k !== "exhibit_id") p[k] = (k === "region_id") ? +v : (v || null);
    const r = await post("/api/admin/queue",
      { table: "appellations", payload: p, note: "称呼改版：" + p.term_zh });
    if (exhibit) {
      // 展品-称呼关联在发布时由后端修订负载携带
      await post("/api/admin/queue", { table: "exhibit_appellations", action: "link",
        payload: { exhibit_id: exhibit, via_revision: r.revision_id },
        note: `发布时将新称呼关联到展品#${exhibit}` });
    }
    toast("称呼改版已进入审校队列"); switchTab("queue");
  };
}

/* ------------------------------------------------- 借出/拍摄许可/媒体任务 */
async function tabMedia() {
  const ex = await api("/api/exhibits");
  const d = await api("/api/admin/drafts");
  $("#tab-media").innerHTML = `<div class="panel">
    <h3 style="margin:0 0 8px">展品借出与授权（两条独立渠道）</h3>
    <table><thead><tr><th>展品</th><th>现场借出</th><th>文字授权</th><th>操作</th></tr></thead>
    <tbody>${ex.exhibits.map(x => `<tr>
      <td>${esc(x.title_zh)}</td>
      <td>${x.is_on_loan ? '<span class="badge loan">外借中</span>' : "在展"}</td>
      <td>${x.has_text_grant ? "有" : "无"}</td>
      <td>
        <button class="small" onclick="setLoan(${x.id},${x.is_on_loan ? 0 : 1})">
          ${x.is_on_loan ? "标记归还" : "标记借出（仅现场可见性）"}</button>
        <button class="small ghost" onclick="setTextGrant(${x.id},${x.has_text_grant ? 0 : 1})">
          ${x.has_text_grant ? "撤销文字授权" : "恢复文字授权"}</button>
      </td></tr>`).join("")}</tbody></table>
    <p class="muted">借出只改变“现场是否可见”，不会改写历史文字说明；
      文字授权独立决定解释正文是否公开。</p></div>

  <div class="panel"><h3 style="margin:0 0 8px">拍摄许可（独立影响图片渠道）</h3>
    <form id="grantForm" class="filters">
      <input type="number" name="asset_id" placeholder="媒体资源 ID" style="width:130px" required>
      <select name="has_shoot_grant"><option value="1">授予拍摄许可</option>
        <option value="0">撤销拍摄许可（图片渠道立即下线，发布后生效）</option></select>
      <button>提交审校</button>
    </form></div>

  <div class="panel"><h3 style="margin:0 0 8px">媒体任务（生成细节图）</h3>
    <form id="taskForm" class="filters">
      <select name="exhibit_id">${ex.exhibits.map(x =>
        `<option value="${x.id}">${esc(x.title_zh)}</option>`).join("")}</select>
      <input name="instruction" placeholder="细节图生成要求，如 4 倍放大、保留针脚方向"
        style="min-width:340px" required>
      <button>创建任务</button>
    </form>
    <table style="margin-top:10px"><thead><tr><th>#</th><th>展品</th><th>要求</th><th>状态</th></tr></thead>
      <tbody>${d.media_tasks.map(t => `<tr><td>${t.id}</td><td>${t.exhibit_id}</td>
        <td>${esc(t.instruction)}</td><td>${t.status}</td></tr>`).join("")}</tbody></table>
  </div>`;
  $("#grantForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await post("/api/admin/queue", {
      table: "media_assets", id: +fd.get("asset_id"), action: "media_grant",
      payload: { has_shoot_grant: +fd.get("has_shoot_grant"),
                 is_visible: +fd.get("has_shoot_grant") ? 1 : 0 } });
    toast("拍摄许可变更已进入审校队列（需统一发布）");
  };
  $("#taskForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await post("/api/admin/queue", { table: "media_tasks",
      payload: { exhibit_id: +fd.get("exhibit_id"), motif_id: null,
                 instruction: fd.get("instruction"), status: "requested" } });
    toast("媒体任务已创建，等待生成细节图"); switchTab("media");
  };
}
async function setLoan(id, on) {
  await post("/api/admin/queue", { table: "exhibits", id, action: "loan",
    payload: { is_on_loan: on, loan_note: on ? "编辑标记借出（不影响历史说明）" : null } });
  toast("借出状态修订已入队"); switchTab("media");
}
async function setTextGrant(id, on) {
  await post("/api/admin/queue", { table: "exhibits", id, action: "text_grant",
    payload: { has_text_grant: on } });
  toast("文字授权修订已入队（发布后正文显隐变化）"); switchTab("media");
}
window.setLoan = setLoan; window.setTextGrant = setTextGrant;

/* ----------------------------------------------------------------- tabs */
const RENDERERS = { queue: tabQueue, statement: tabStatement, sources: tabSources,
  appellation: tabAppellation, media: tabMedia };
function switchTab(t) {
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === t));
  ["queue", "statement", "sources", "appellation", "media"].forEach(k =>
    $("#tab-" + k).hidden = k !== t);
  RENDERERS[t]();
}
window.switchTab = switchTab;
document.querySelectorAll("#tabs button").forEach(b =>
  b.addEventListener("click", () => switchTab(b.dataset.tab)));
(async () => { await loadRefs(); tabQueue(); })();
