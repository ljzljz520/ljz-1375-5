import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_DB } from '../src/db.js';
import { renameRegion, currentName, allKnownNames } from '../src/regions.js';
import { createStatement, filterStatements, eraMatches, reviewStatement, retractStatement, sameMotifDifferentContext } from '../src/statements.js';
import { generateDetail, mapPoint } from '../src/media.js';
import { publish, publishedStatements, buildSearchIndex, tokenize } from '../src/publish.js';
import { keyToAction, detailReducer } from '../src/keyboard.js';
import { translate } from '../src/i18n.js';
import { addFavorite, offlineBundle } from '../src/favorites.js';
import { createExhibit, setLoan, setPhotoPermission } from '../src/exhibits.js';

function baseDb() {
  const db = EMPTY_DB();
  db.regions = [
    { id: 'r1', path: 'r1', names: [{ name: '车里', effectiveYear: 1296 }, { name: '景洪', effectiveYear: 1983 }] },
    { id: 'r1a', path: 'r1/r1a', names: [{ name: '勐海', effectiveYear: 1900 }] },
    { id: 'r2', path: 'r2', names: [{ name: '靖西', effectiveYear: 1900 }] },
  ];
  return db;
}
const mk = (db, over = {}) => createStatement(db, {
  subjectType: 'motif', subjectId: 'mf_x', regionId: 'r1',
  era: { start: 1800, end: 1900 },
  interpretation: { zh: '解释' }, source: { title: '来源A' }, ...over,
});

test('地区称呼改版：新增版本、旧称保留、历史陈述不被改写', () => {
  const db = baseDb();
  const before = currentName(db.regions[0], 1900).name;
  assert.equal(before, '车里');
  assert.equal(currentName(db.regions[0], 2000).name, '景洪');
  renameRegion(db, 'r1', '西双版纳·景洪', { effectiveYear: 2026, reason: '规范' });
  assert.equal(currentName(db.regions[0], 2026).name, '西双版纳·景洪');
  assert.ok(allKnownNames(db.regions[0]).includes('车里'), '旧称保留为曾用名');
  assert.ok(allKnownNames(db.regions[0]).includes('景洪'));
});

test('翻译缺失：回退到中文并标记 fellBack', () => {
  const missing = [];
  const en = translate({ zh: '中文', en: null }, 'en', missing);
  assert.equal(en.value, '中文');
  assert.equal(en.fellBack, true);
  assert.equal(missing.length, 1);
  const tai = translate({ zh: '中文', en: 'English', tai: null }, 'tai', []);
  assert.equal(tai.value, '中文'); // 傣语缺失也回退中文，而不是错误显示英文
});

test('图像裁切：标注坐标正确换算，区外标注为 outside（不偏移）', () => {
  const db = baseDb();
  db.images = [{ id: 'i1', width: 100, height: 100, annotations: [
    { id: 'a', x: 0.3, y: 0.3, label: '内' },
    { id: 'b', x: 0.9, y: 0.9, label: '外' },
  ] }];
  const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
  const p = mapPoint(0.3, 0.3, crop);
  assert.ok(Math.abs(p.x - 0.4) < 1e-9);
  assert.ok(Math.abs(p.y - 0.4) < 1e-9);
  const task = generateDetail(db, { imageId: 'i1', crop });
  const a = task.annotations.find(x => x.id === 'a');
  const b = task.annotations.find(x => x.id === 'b');
  assert.equal(a.status, 'mapped');
  assert.equal(b.status, 'outside');
  assert.equal(b.x, null);
});

test('同纹异义：相同纹样不同语境是两条独立陈述，不合并', () => {
  const db = baseDb();
  const a = mk(db, { regionId: 'r1', source: { title: '傣锦调查' }, interpretation: { zh: '稻作' } });
  const b = mk(db, { regionId: 'r2', source: { title: '壮锦图谱' }, interpretation: { zh: '守护' } });
  assert.equal(a.subjectId, b.subjectId);
  assert.ok(sameMotifDifferentContext(a, b));
  assert.equal(filterStatements(db, { subjectType: 'motif', includeUnapproved: true, includeRetracted: true }).length, 2);
  assert.notEqual(a.id, b.id);
});

test('范围匹配：年代 overlap/contain 与地区层级', () => {
  const db = baseDb();
  mk(db, { regionId: 'r1', era: { start: 1800, end: 1900 } });
  mk(db, { regionId: 'r1a', era: { start: 1850, end: 1950 } });
  mk(db, { regionId: 'r2', era: { start: 1700, end: 1750 } });
  // overlap: 1880-1920 命中前两条
  const overlap = filterStatements(db, { subjectType: 'motif', era: { start: 1880, end: 1920 }, includeUnapproved: true, includeRetracted: true });
  assert.equal(overlap.length, 2);
  // contain: 只有 1850-1950 被 1840-1960 完全包含
  const contain = filterStatements(db, { subjectType: 'motif', era: { start: 1840, end: 1960 }, eraMode: 'contain', includeUnapproved: true, includeRetracted: true });
  assert.deepEqual(contain.map(s => s.regionId), ['r1a']);
  // 地区层级：筛选 r1 命中子地区 r1a
  const hier = filterStatements(db, { subjectType: 'motif', regionId: 'r1', includeUnapproved: true, includeRetracted: true });
  assert.deepEqual(hier.map(s => s.regionId).sort(), ['r1', 'r1a']);
});

test('争议可随审校结论发布；来源撤回后不再发布但保留记录', () => {
  const db = baseDb();
  const s = mk(db, { disputed: true, disputeNote: '两说' });
  reviewStatement(db, s.id, { decision: 'approve', note: '两说并列' });
  publish(db);
  assert.equal(publishedStatements(db).length, 1);
  assert.equal(publishedStatements(db)[0].review.note, '两说并列');
  retractStatement(db, s.id, { reason: '来源撤稿' });
  publish(db);
  assert.equal(publishedStatements(db).length, 0);
  // 记录仍在（审校痕迹）
  assert.equal(db.statements[0].retracted, true);
  assert.equal(db.statements[0].retraction.reason, '来源撤稿');
});

test('键盘 reducer：Enter 打开、方向切换、Esc 关闭、首尾', () => {
  let st = { open: false, index: 0 };
  assert.equal(keyToAction('Enter', { open: false }), 'open');
  st = detailReducer(st, 'open', 3);
  assert.deepEqual(st, { open: true, index: 0 });
  st = detailReducer(st, 'next', 3);
  assert.equal(st.index, 1);
  st = detailReducer(st, 'prev', 3);
  assert.equal(st.index, 0); // 回绕
  st = detailReducer(st, 'last', 3);
  assert.equal(st.index, 2);
  st = detailReducer(st, 'close', 3);
  assert.equal(st.open, false);
});

test('借出与拍摄许可正交；离线包只含文字、不含受限图', () => {
  const db = baseDb();
  const ex = createExhibit(db, { id: 'ex1', type: 'historical', title: { zh: '裙' }, regionId: 'r1', imageId: 'i1', photoPermissionAllowed: true });
  addFavorite(db, 'ex1');
  setLoan(db, 'ex1', { active: true }); // 外借
  let bundle = offlineBundle(db, 'ex1');
  assert.equal(bundle.onSite, false);
  assert.equal(bundle.image.cacheable, true); // 外借不影响图片
  setPhotoPermission(db, 'ex1', { allowed: false }); // 撤拍摄许可
  bundle = offlineBundle(db, 'ex1');
  assert.equal(bundle.image.cacheable, false);
  assert.equal(bundle.image.reason, 'no_photo_permission');
  assert.ok(bundle.title.zh); // 文字仍在
});

test('中文分词（bigram）保证旧称可检索', () => {
  assert.ok(tokenize('景洪车里').includes('车里'));
  assert.ok(tokenize('菱形纹释义').includes('菱形'));
});

test('公开拷贝 keyboard.js 与 src 版本保持一致', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const here = dirname(fileURLToPath(import.meta.url));
  const a = readFileSync(join(here, '..', 'src', 'keyboard.js'), 'utf8');
  const b = readFileSync(join(here, '..', 'public', 'keyboard.js'), 'utf8');
  assert.equal(a, b);
});
