import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { EMPTY_DB } from '../src/db.js';
import { createExhibit } from '../src/exhibits.js';
import { createStatement, reviewStatement } from '../src/statements.js';
import { publish } from '../src/publish.js';
import { addFavorite, offlineBundle } from '../src/favorites.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Service Worker 预缓存清单中的所有壳文件均存在', () => {
  const sw = readFileSync(join(ROOT, 'public/sw.js'), 'utf8');
  const m = sw.match(/const SHELL = \[([^\]]+)\]/);
  assert.ok(m);
  const assets = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
  for (const a of assets) {
    const file = a === '/' ? join(ROOT, 'public/index.html') : join(ROOT, 'public', a.replace(/^\//, ''));
    assert.ok(existsSync(file), `SW 壳文件缺失: ${a}`);
  }
});

test('已收藏页面离线回归：文字在、受限图片不缓存；发布版本随离线包固定', () => {
  const db = EMPTY_DB();
  db.regions = [{ id: 'r1', path: 'r1', names: [{ name: '景洪', effectiveYear: 1900 }] }];
  const ex = createExhibit(db, {
    id: 'ex1', type: 'historical', title: { zh: '筒裙' }, regionId: 'r1',
    imageId: 'img1', photoPermissionAllowed: false,
  });
  const s = createStatement(db, {
    subjectType: 'exhibit', subjectId: 'ex1', regionId: 'r1', era: { start: 1850, end: 1900 },
    interpretation: { zh: '经授权的历史说明' }, source: { title: '馆藏档案' },
  });
  reviewStatement(db, s.id, { decision: 'approve' });
  publish(db, { by: 'test' });
  addFavorite(db, 'ex1');

  const bundle = offlineBundle(db, 'ex1');
  // 文字陈述保留
  assert.equal(bundle.statements.length, 1);
  assert.equal(bundle.statements[0].interpretation.zh, '经授权的历史说明');
  // 图片不可缓存（拍摄许可）
  assert.deepEqual(bundle.image, { imageId: null, cacheable: false, reason: 'no_photo_permission' });
  // 固定发布版本
  assert.ok(bundle.version);
  assert.equal(bundle.version, db.publication.id);
  // 这正是前端 cacheOffline() 写入 /offline/<id> 的内容结构
  assert.ok(ex.id === bundle.exhibitId);
});

test('离线包在无图展品上也可用（缺图片仍保留授权文字）', () => {
  const db = EMPTY_DB();
  db.regions = [{ id: 'r1', path: 'r1', names: [{ name: '景洪', effectiveYear: 1900 }] }];
  createExhibit(db, { id: 'ex2', type: 'contemporary_daily', title: { zh: '短衫' }, regionId: 'r1', imageId: null });
  const b = offlineBundle(db, 'ex2');
  assert.equal(b.image.cacheable, false);
  assert.equal(b.image.reason, 'no_image');
  assert.equal(b.title.zh, '短衫');
});
