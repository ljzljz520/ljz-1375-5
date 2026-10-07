import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4319 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-token';
const H = { 'Content-Type': 'application/json', 'X-Editor': TOKEN };
let child;

before(async () => {
  child = spawn(process.execPath, ['scripts/seed.js', '--write'], { cwd: ROOT });
  await once(child, 'exit');
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT), BC_EDITOR_TOKEN: TOKEN }, stdio: 'ignore',
  });
  // 等待端口
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
});
after(() => child?.kill());

const j = async (path, opts) => {
  const res = await fetch(BASE + path, opts);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
};
const post = (path, payload, headers = H) => j(path, { method: 'POST', headers, body: JSON.stringify(payload) });

test('公开搜索只返回已发布陈述；草稿不可见', async () => {
  const { body } = await j('/api/search?q=' + encodeURIComponent('羽冠放大'));
  assert.equal(body.results.length, 0, '草稿陈述不得出现在搜索');
  const r = await j('/api/statements?scope=editor', { headers: { 'X-Editor': TOKEN } });
  assert.ok(r.body.some(s => s.interpretation.zh.includes('草稿')));
  // 无 token 的 editor scope 被忽略，只给已发布
  const denied = await j('/api/statements?scope=editor');
  assert.ok(denied.body.length >= 1 && denied.body.every(s => !s.retracted));
});

test('来源撤回：重新发布后旧解释从搜索与详情消失，记录保留', async () => {
  // 撤回一条已批准的非撤回陈述（s6 已在 seed 撤回，验证它本就不在快照；再撤回一条并重新发布）
  let r = await j('/api/statements?scope=editor', { headers: { 'X-Editor': TOKEN } });
  const target = r.body.find(s => s.interpretation.zh.includes('鱼网'));
  assert.ok(target);
  const pubBefore = (await j('/api/publication/version')).body;
  await post(`/api/statements/${target.id}/retract`, { reason: '作者单位撤回' });
  await post('/api/publish', {});
  const pubAfter = (await j('/api/publication/version')).body;
  assert.notEqual(pubBefore.id, pubAfter.id);
  // 搜索不再命中
  const s = await j('/api/search?q=' + encodeURIComponent('鱼网'));
  assert.equal(s.body.results.length, 0);
  // 详情也不再有
  const d = await j('/api/exhibits/ex_carrier_zhuang');
  assert.ok(!d.body.statements.some(x => x.id === target.id));
  // 编辑视图仍保留撤回记录
  const ed = await j('/api/statements?scope=editor', { headers: { 'X-Editor': TOKEN } });
  assert.ok(ed.body.find(x => x.id === target.id).retracted);
});

test('地区称呼改版：旧称仍可搜索到该地区相关陈述', async () => {
  await post('/api/regions/r_jinghong/rename', { newName: '西双版纳景洪', effectiveYear: 2026, reason: '规范' });
  await post('/api/publish', {});
  // 旧称「车里」命中（snapshot regionName 用当前名，倒排含旧称；搜索结果非空即可）
  const byOld = await j('/api/search?q=' + encodeURIComponent('车里'));
  assert.ok(byOld.body.results.length >= 1);
  const regions = (await j('/api/regions')).body;
  const jh = regions.find(r => r.id === 'r_jinghong');
  assert.equal(jh.currentName, '西双版纳景洪');
  assert.ok(jh.formerNames.includes('车里'));
});

test('图像渠道受拍摄许可控制；借出不改文字可见性', async () => {
  // 舞台服拍摄许可关闭
  const blocked = await j('/api/exhibits/ex_stage_dress/image');
  assert.equal(blocked.status, 403);
  // 但该展品详情文字（若有已发布陈述）与基本信息可读
  const d = await j('/api/exhibits/ex_stage_dress');
  assert.equal(d.status, 200);
  assert.equal(d.body.imageAvailable, false);
  // 借出中的背带：列表默认仍返回，?onSite=true 时过滤掉；详情文字完整
  const all = await j('/api/exhibits');
  assert.ok(all.body.some(e => e.id === 'ex_carrier_zhuang'));
  const onsite = await j('/api/exhibits?onSite=true');
  assert.ok(!onsite.body.some(e => e.id === 'ex_carrier_zhuang'));
  const img = await j('/api/exhibits/ex_carrier_zhuang/image');
  assert.equal(img.status, 200, '外借不影响拍摄许可图片渠道');
  assert.equal(img.headers.get('cache-control'), 'no-store');
  // 切换借出归还后现场恢复，历史说明 id 不变
  await post('/api/exhibits/ex_carrier_zhuang/loan', { active: false });
  const back = await j('/api/exhibits?onSite=true');
  assert.ok(back.body.some(e => e.id === 'ex_carrier_zhuang'));
  await post('/api/exhibits/ex_carrier_zhuang/loan', { active: true, borrower: '广西民族博物馆' });
});

test('缺图片展品保留授权文字；拍摄许可关闭后图片 403 但文字 200', async () => {
  const d = await j('/api/exhibits/ex_modern_blouse');
  assert.equal(d.body.imageAvailable, false);
  const img = await j('/api/exhibits/ex_modern_blouse/image');
  assert.equal(img.status, 404); // 无图
  // 文字标题仍可读
  assert.ok(d.body.title.zh.includes('短衫'));
});

test('批准原子换版：先批准草稿，发布前访客不可见，发布后搜索与详情同步可见', async () => {
  const ed = await j('/api/statements?scope=editor', { headers: { 'X-Editor': TOKEN } });
  const draft = ed.body.find(s => s.interpretation.zh.includes('羽冠放大'));
  const v0 = (await j('/api/publication/version')).body.id;
  // 发布前搜索为空
  assert.equal((await j('/api/search?q=' + encodeURIComponent('羽冠放大'))).body.results.length, 0);
  await post(`/api/statements/${draft.id}/review`, { decision: 'approve' });
  // 批准后、发布前：仍走旧索引，访客不可见
  assert.equal((await j('/api/search?q=' + encodeURIComponent('羽冠放大'))).body.results.length, 0);
  const v1 = (await j('/api/publication/version')).body.id;
  assert.equal(v1, v0);
  await post('/api/publish', {});
  const v2 = (await j('/api/publication/version')).body.id;
  assert.notEqual(v2, v1);
  const sr = await j('/api/search?q=' + encodeURIComponent('羽冠放大'));
  assert.equal(sr.body.version, v2);
  assert.equal(sr.body.results.length, 1);
  const d = await j('/api/exhibits/ex_stage_dress');
  assert.ok(d.body.statements.some(s => s.id === draft.id));
  assert.equal(d.body.publicationVersion, v2);
});

test('范围匹配筛选 API：地区层级 + 年代 overlap', async () => {
  const r = await j('/api/search?regionId=r_yunnan&eraStart=1900&eraEnd=2000');
  assert.ok(r.body.results.length >= 1);
  assert.ok(r.body.results.every(s => s.regionId.startsWith('r_')));
  // 云南层级下不应出现广西陈述（鱼网那条已撤回）；用未撤回的孔雀/筒裙验证
  assert.ok(r.body.results.every(s => ['r_jinghong', 'r_yunnan'].includes(s.regionId)));
  // contain 模式更严格
  const c = await j('/api/search?regionId=r_jinghong&eraStart=1860&eraEnd=1900&eraMode=contain');
  assert.ok(c.body.results.every(s => s.era.start >= 1860 && s.era.end <= 1900));
});

test('媒体细节图：裁切接口输出细节图且受拍摄许可约束，区外标注 outside', async () => {
  const list = await j('/api/statements?scope=editor', { headers: { 'X-Editor': TOKEN } });
  void list;
  // seed 已生成一个任务；直接取展品详情里的任务
  const d = await j('/api/exhibits/ex_skirt_dai');
  const task = d.body.mediaTasks[0];
  assert.ok(task);
  const outside = task.annotations.find(a => a.status === 'outside');
  const mapped = task.annotations.find(a => a.status === 'mapped');
  assert.ok(outside);
  assert.ok(mapped.x >= 0 && mapped.x <= 1);
  // 精确数值：an_1 原图(0.25,0.30)，crop=(0.10,0.15,0.45,0.40)
  // -> 细节坐标 ((0.25-0.10)/0.45, (0.30-0.15)/0.40) = (1/3, 3/8)
  const an1 = task.annotations.find(a => a.id === 'an_1');
  assert.ok(Math.abs(an1.x - 1 / 3) < 1e-6, `x=${an1.x}`);
  assert.ok(Math.abs(an1.y - 0.375) < 1e-6, `y=${an1.y}`);
  // an_3 在裁切区外
  assert.equal(task.annotations.find(a => a.id === 'an_3').status, 'outside');
  const img = await j(`/api/media-tasks/${task.id}/image`);
  assert.equal(img.status, 200);
  // 为舞台服（无拍摄许可）图像建任务后图像应 403
  const t2 = await post('/api/media-tasks', { imageId: 'img_stage', crop: { x: 0, y: 0, w: 1, h: 1 } });
  const blocked = await j(`/api/media-tasks/${t2.body.id}/image`);
  assert.equal(blocked.status, 403);
});

test('收藏与离线包：无许可图片标记不可缓存', async () => {
  await post('/api/favorites', { exhibitId: 'ex_stage_dress' });
  const b = await j('/api/exhibits/ex_stage_dress/offline');
  assert.equal(b.body.image.cacheable, false);
  assert.equal(b.body.image.reason, 'no_photo_permission');
  assert.ok(b.body.title.zh);
});

test('写操作需要编辑令牌', async () => {
  const no = await post('/api/publish', {}, { 'Content-Type': 'application/json' });
  assert.equal(no.status, 401);
});

test('展品三类型独立存在且可按类型筛选', async () => {
  for (const t of ['historical', 'stage_reconstruction', 'contemporary_daily']) {
    const r = await j('/api/exhibits?type=' + t);
    assert.ok(r.body.length >= 1);
    assert.ok(r.body.every(e => e.type === t));
  }
});

test('展品详情支持范围匹配筛选解释（年代 + 地区）', async () => {
  const all = await j('/api/exhibits/ex_skirt_dai');
  const n0 = all.body.statements.length;
  assert.ok(n0 >= 2); // 孔雀纹 + 筒裙展品陈述
  // 仅看 1900-2000 与陈述区间相交
  const era = await j('/api/exhibits/ex_skirt_dai?eraStart=1900&eraEnd=2000');
  assert.ok(era.body.statements.length <= n0);
  assert.ok(era.body.statements.every(s => s.era.start <= 2000 && s.era.end >= 1900));
  assert.equal(era.body.unfilteredStatementCount, n0);
  // 完全包含模式更严格
  const contain = await j('/api/exhibits/ex_skirt_dai?eraStart=1840&eraEnd=1920&eraMode=contain');
  assert.ok(contain.body.statements.every(s => s.era.start >= 1840 && s.era.end <= 1920));
  // 地区：限定景洪仍命中，限定广西则该展品陈述不命中
  const gx = await j('/api/exhibits/ex_skirt_dai?regionId=r_guangxi');
  assert.equal(gx.body.statements.length, 0);
  const yn = await j('/api/exhibits/ex_skirt_dai?regionId=r_yunnan');
  assert.ok(yn.body.statements.length >= 1);
});

test('展品搜索聚合：文本 + 年代 + 地区 + 类型 + 在场，返回范围内匹配解释', async () => {
  // 先前验收撤回了「鱼网」陈述；此处演示恢复发布后同纹异义并列（记录仍可重新生效）
  // 先前验收已撤回一条靖西来源；这里用另一独立来源补录同纹解释，验证不与傣泐解释合并。
  // 新建一条靖西语境的同纹独立解释并发布
  const created = await post('/api/statements', {
    subjectType: 'motif', subjectId: 'mf_rhombus', regionId: 'r_jingxi',
    era: { start: 1900, end: 1980 },
    interpretation: { zh: '菱形纹在靖西背带上象征守护之眼与鱼网（补录来源，独立于傣泐解释）。' },
    source: { kind: 'fieldwork', title: '靖西织绣补访记录', year: 2026 },
  });
  await post(`/api/statements/${created.body.id}/review`, { decision: 'approve' });
  await post('/api/publish', {});

  const r = await j('/api/exhibits-search?q=' + encodeURIComponent('菱形') + '&eraMode=overlap');
  assert.equal(r.status, 200);
  const ids = r.body.exhibits.map(e => e.id);
  assert.ok(ids.includes('ex_skirt_dai'));
  assert.ok(ids.includes('ex_carrier_zhuang'));
  // 同纹异义：两个展品的匹配解释文本不同、来源不同，未被合并
  const skirt = r.body.exhibits.find(e => e.id === 'ex_skirt_dai');
  const carrier = r.body.exhibits.find(e => e.id === 'ex_carrier_zhuang');
  assert.ok(skirt.matchedStatements.some(s => s.interpretation.zh.includes('水田')));
  assert.ok(carrier.matchedStatements.some(s => s.interpretation.zh.includes('守护之眼')));
  // 二者来源标题不同，是两条陈述
  const srcs = [...skirt.matchedStatements, ...carrier.matchedStatements].map(s => s.source.title);
  assert.ok(new Set(srcs).size >= 2);
  // 类型过滤：只要历史实物
  const onlyHist = await j('/api/exhibits-search?type=historical');
  assert.ok(onlyHist.body.exhibits.every(e => e.type === 'historical'));
  // 在场过滤排除借出
  const onsite = await j('/api/exhibits-search?onSite=true');
  assert.ok(!onsite.body.exhibits.some(e => e.id === 'ex_carrier_zhuang'));
  // 无结果情形
  const none = await j('/api/exhibits-search?q=' + encodeURIComponent('不存在的词XYZ'));
  assert.equal(none.body.exhibits.length, 0);
});
