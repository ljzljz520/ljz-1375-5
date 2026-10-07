// 零依赖 HTTP 服务：静态前端 + JSON API。
import { createServer as createHttp } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { AppError } from './errors.js';
import { loadDb, saveDb, EMPTY_DB } from './db.js';
import { renameRegion, currentName, allKnownNames } from './regions.js';
import { createMotif } from './motifs.js';
import { createExhibit, requireExhibit, setLoan, setPhotoPermission, isOnSite, imageChannelOpen } from './exhibits.js';
import { createStatement, reviewStatement, retractStatement, filterStatements, eraMatches, regionMatches } from './statements.js';
import { createAppellation, createOccasion } from './terms.js';
import { generateDetail } from './media.js';
import { publish, buildSearchIndex, currentVersion, publishedStatements } from './publish.js';
import { search } from './search.js';
import { addFavorite, removeFavorite, offlineBundle } from './favorites.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };

export function createApp(options = {}) {
  // db 可注入（测试）；默认文件持久化。
  const dbFile = options.dbFile || join(ROOT, 'data/db.json');
  let db = options.db || (existsSync(dbFile) ? loadDb(dbFile) : EMPTY_DB());
  const persist = options.persist !== false;
  const editorToken = options.editorToken || process.env.BC_EDITOR_TOKEN || 'editor-token';
  const save = () => { if (persist && !options.db) saveDb(db, dbFile); };

  // 图像渠道授权：图像必须被至少一件「拍摄许可=允许」的展品引用才可取用。
  // 借出现场不可见不影响图片渠道（两开关正交）。
  function imageAccessible(imageId) {
    const owners = db.exhibits.filter(e => e.imageId === imageId);
    if (owners.length === 0) return { ok: false, reason: 'no_owner' };
    const allowed = owners.some(e => e.photoPermission.allowed);
    return { ok: allowed, reason: allowed ? null : 'no_photo_permission', owners };
  }

  const requireEditor = req => {
    if (req.headers['x-editor'] !== editorToken) throw new AppError(401, 'UNAUTHORIZED', '需要编辑权限（X-Editor 头）');
  };

  const server = createHttp(async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (err instanceof AppError) return json(res, err.status, { error: err.code, message: err.message, details: err.details });
      console.error(err);
      json(res, 500, { error: 'INTERNAL', message: err.message });
    }
  });

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p.startsWith('/api/')) return api(req, res, url);
    return staticFiles(req, res, p);
  }

  async function api(req, res, url) {
    const p = url.pathname;
    const q = url.searchParams;
    const body = req.method === 'POST' || req.method === 'DELETE' ? await readJson(req) : {};

    // ---- 公开读 ----
    if (p === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, version: currentVersion(db) });
    if (p === '/api/regions' && req.method === 'GET') {
      return json(res, 200, db.regions.map(r => ({ id: r.id, path: r.path, currentName: currentName(r)?.name, formerNames: allKnownNames(r) })));
    }
    if (p === '/api/motifs' && req.method === 'GET') return json(res, 200, db.motifs);
    if (p === '/api/exhibits' && req.method === 'GET') {
      let list = db.exhibits;
      if (q.get('type')) list = list.filter(e => e.type === q.get('type'));
      if (q.get('onSite') === 'true') list = list.filter(isOnSite);
      return json(res, 200, list.map(listView));
    }
    const mEx = p.match(/^\/api\/exhibits\/([\w-]+)$/);
    if (mEx && req.method === 'GET') {
      const era = (q.get('eraStart') || q.get('eraEnd'))
        ? { start: q.get('eraStart') ? Number(q.get('eraStart')) : null, end: q.get('eraEnd') ? Number(q.get('eraEnd')) : null }
        : null;
      return json(res, 200, detailView(requireExhibit(db, mEx[1]), {
        era, eraMode: q.get('eraMode') || 'overlap', regionId: q.get('regionId') || null,
      }));
    }

    // 图像渠道（拍摄许可隔离；借出现场不可见不影响）
    const mImg = p.match(/^\/api\/exhibits\/([\w-]+)\/image$/);
    if (mImg && req.method === 'GET') {
      const ex = requireExhibit(db, mImg[1]);
      if (!ex.imageId) throw new AppError(404, 'NO_IMAGE', '该展品无图片');
      if (!imageChannelOpen(ex)) throw new AppError(403, 'IMAGE_RESTRICTED', '拍摄许可未开放图片渠道');
      return serveImage(res, ex.imageId);
    }
    const mMTImg = p.match(/^\/api\/media-tasks\/([\w-]+)\/image$/);
    if (mMTImg && req.method === 'GET') {
      const task = db.mediaTasks.find(t => t.id === mMTImg[1]);
      if (!task) throw new AppError(404, 'NOT_FOUND', '媒体任务不存在');
      const acc = imageAccessible(task.imageId);
      if (!acc.ok) throw new AppError(403, 'IMAGE_RESTRICTED', '拍摄许可未开放图片渠道');
      return serveImage(res, task.imageId, task.crop);
    }
    const mMT = p.match(/^\/api\/media-tasks\/([\w-]+)$/);
    if (mMT && req.method === 'GET') return json(res, 200, db.mediaTasks.find(t => t.id === mMT[1]) ?? null);

    if (p === '/api/exhibits-search' && req.method === 'GET') {
      // 范围匹配筛选：先在已发布快照上按文本/地区/年代检索，再聚合到展品；
      // 返回每个展品在该范围内匹配的解释（同纹异义各条独立出现）。
      const era = (q.get('eraStart') || q.get('eraEnd'))
        ? { start: q.get('eraStart') ? Number(q.get('eraStart')) : null, end: q.get('eraEnd') ? Number(q.get('eraEnd')) : null }
        : null;
      const r = search(db, {
        q: q.get('q') || '', subjectType: q.get('subjectType') || undefined,
        regionId: q.get('regionId') || undefined, era, eraMode: q.get('eraMode') || 'overlap',
      });
      const matchedIds = new Set(r.results.map(x => x.id));
      let list = db.exhibits;
      if (q.get('type')) list = list.filter(e => e.type === q.get('type'));
      if (q.get('onSite') === 'true') list = list.filter(isOnSite);
      const out = list.map(ex => {
        const scoped = detailView(ex, { era, eraMode: q.get('eraMode') || 'overlap', regionId: q.get('regionId') || null });
        const matchedStatements = (q.get('q') || q.get('subjectType'))
          ? scoped.statements.filter(st => matchedIds.has(st.id))
          : scoped.statements;
        return { ...listView(ex), matchedStatementCount: matchedStatements.length, matchedStatements };
      }).filter(e => {
        const anyFilter = (q.get('q') || q.get('subjectType') || q.get('regionId') || era);
        return anyFilter ? e.matchedStatementCount > 0 : true;
      });
      return json(res, 200, { version: r.version, exhibits: out });
    }
    if (p === '/api/search' && req.method === 'GET') {
      const era = (q.get('eraStart') || q.get('eraEnd'))
        ? { start: q.get('eraStart') ? Number(q.get('eraStart')) : null, end: q.get('eraEnd') ? Number(q.get('eraEnd')) : null }
        : null;
      return json(res, 200, search(db, {
        q: q.get('q') || '', subjectType: q.get('subjectType') || undefined,
        subjectId: q.get('subjectId') || undefined, regionId: q.get('regionId') || undefined,
        era, eraMode: q.get('eraMode') || 'overlap',
      }));
    }
    if (p === '/api/search-index' && req.method === 'GET') return json(res, 200, buildSearchIndex(db));
    if (p === '/api/publication/version' && req.method === 'GET') return json(res, 200, currentVersion(db));

    if (p === '/api/statements' && req.method === 'GET') {
      // 编辑可在发布前看草稿/撤回（?scope=editor）；访客只看到已发布。
      const editor = req.headers['x-editor'] === editorToken;
      const scope = q.get('scope');
      if (scope === 'editor' && editor) {
        return json(res, 200, filterStatements(db, {
          subjectType: q.get('subjectType') || undefined,
          subjectId: q.get('subjectId') || undefined,
          regionId: q.get('regionId') || undefined,
          era: parseEra(q), eraMode: q.get('eraMode') || 'overlap',
          includeRetracted: true, includeUnapproved: true,
        }));
      }
      let pool = publishedStatements(db);
      if (q.get('subjectType')) pool = pool.filter(s => s.subjectType === q.get('subjectType'));
      if (q.get('subjectId')) pool = pool.filter(s => s.subjectId === q.get('subjectId'));
      if (q.get('regionId')) pool = pool.filter(s => s.regionId === q.get('regionId'));
      return json(res, 200, pool);
    }

    // 收藏 / 离线
    if (p === '/api/favorites' && req.method === 'GET') return json(res, 200, db.favorites);
    if (p === '/api/favorites' && req.method === 'POST') {
      json(res, 201, addFavorite(db, body.exhibitId)); save(); return;
    }
    const mFav = p.match(/^\/api\/favorites\/([\w-]+)$/);
    if (mFav && req.method === 'DELETE') { json(res, 200, removeFavorite(db, mFav[1])); save(); return; }
    const mOff = p.match(/^\/api\/exhibits\/([\w-]+)\/offline$/);
    if (mOff && req.method === 'GET') return json(res, 200, offlineBundle(db, mOff[1]));

    // ---- 以下为编辑写操作 ----
    requireEditor(req);

    if (p === '/api/regions' && req.method === 'POST') {
      if (!body.id || !body.name?.zh) throw new AppError(400, 'BAD_REQUEST', '地区 id/name 必填');
      const region = { id: body.id, path: body.path || body.id, names: [{ name: body.name.zh, effectiveYear: body.effectiveYear ?? 1900 }] };
      db.regions.push(region); save(); return json(res, 201, region);
    }
    const mRen = p.match(/^\/api\/regions\/([\w-]+)\/rename$/);
    if (mRen && req.method === 'POST') {
      const r = renameRegion(db, mRen[1], body.newName, { effectiveYear: body.effectiveYear, reason: body.reason });
      save(); return json(res, 200, r.region);
    }
    if (p === '/api/motifs' && req.method === 'POST') { const m = createMotif(db, body); save(); return json(res, 201, m); }
    if (p === '/api/exhibits' && req.method === 'POST') { const e = createExhibit(db, body); save(); return json(res, 201, e); }
    if (p === '/api/appellations' && req.method === 'POST') { const a = createAppellation(db, body); save(); return json(res, 201, a); }
    if (p === '/api/occasions' && req.method === 'POST') { const o = createOccasion(db, body); save(); return json(res, 201, o); }
    if (p === '/api/statements' && req.method === 'POST') { const s = createStatement(db, body); save(); return json(res, 201, s); }

    const mRev = p.match(/^\/api\/statements\/([\w-]+)\/review$/);
    if (mRev && req.method === 'POST') { const s = reviewStatement(db, mRev[1], body); save(); return json(res, 200, s); }
    const mRet = p.match(/^\/api\/statements\/([\w-]+)\/retract$/);
    if (mRet && req.method === 'POST') { const s = retractStatement(db, mRet[1], body); save(); return json(res, 200, s); }

    const mLoan = p.match(/^\/api\/exhibits\/([\w-]+)\/loan$/);
    if (mLoan && req.method === 'POST') { const e = setLoan(db, mLoan[1], body); save(); return json(res, 200, e); }
    const mPhoto = p.match(/^\/api\/exhibits\/([\w-]+)\/photo-permission$/);
    if (mPhoto && req.method === 'POST') { const e = setPhotoPermission(db, mPhoto[1], body); save(); return json(res, 200, e); }

    if (p === '/api/media-tasks' && req.method === 'POST') { const t = generateDetail(db, body); save(); return json(res, 201, t); }
    if (p === '/api/publish' && req.method === 'POST') { const pub = publish(db, { by: body.by || 'editor' }); save(); return json(res, 200, pub); }

    throw new AppError(404, 'NOT_FOUND', `未找到接口: ${req.method} ${p}`);
  }

  function parseEra(q) {
    if (!q.get('eraStart') && !q.get('eraEnd')) return null;
    return { start: q.get('eraStart') ? Number(q.get('eraStart')) : null, end: q.get('eraEnd') ? Number(q.get('eraEnd')) : null };
  }

  function listView(ex) {
    return {
      id: ex.id, type: ex.type, title: ex.title, regionId: ex.regionId, era: ex.era,
      onSite: isOnSite(ex), loan: ex.loan,
      imageAvailable: imageChannelOpen(ex) && !!ex.imageId, photoAllowed: ex.photoPermission.allowed,
      imageId: ex.imageId,
    };
  }
  function detailView(ex, scope = {}) {
    const snap = publishedStatements(db);
    const exRegion = ex.regionId ? db.regions.find(r => r.id === ex.regionId) : null;
    const ownOrSameContext = s =>
      s.subjectType === 'exhibit' ? s.subjectId === ex.id
      : ex.motifIds.includes(s.subjectId) && (!exRegion || regionMatches(s.regionId, exRegion.id, db));
    const crossContext = s =>
      s.subjectType === 'motif' && ex.motifIds.includes(s.subjectId)
      && exRegion && !regionMatches(s.regionId, exRegion.id, db);
    // 展品自身语境的解释（同纹异义中属于本展品语境的那些）
    let stmts = snap.filter(ownOrSameContext);
    // 跨语境对照：同图形在其他地区/年代的独立解释，单独成组、绝不并入本展品解释
    let comparable = snap.filter(crossContext);
    // 范围匹配的筛选解释：年代（overlap/contain）+ 地区层级（对两组同时生效）
    const unfilteredCount = stmts.length;
    if (scope.era) {
      stmts = stmts.filter(s => eraMatches(s.era, scope.era, scope.eraMode || 'overlap'));
      comparable = comparable.filter(s => eraMatches(s.era, scope.era, scope.eraMode || 'overlap'));
    }
    if (scope.regionId) {
      stmts = stmts.filter(s => regionMatches(s.regionId, scope.regionId, db));
      comparable = comparable.filter(s => regionMatches(s.regionId, scope.regionId, db));
    }
    const region = ex.regionId ? db.regions.find(r => r.id === ex.regionId) : null;
    return {
      ...listView(ex),
      summary: ex.summary, motifIds: ex.motifIds,
      region: region ? { id: region.id, currentName: currentName(region)?.name, formerNames: allKnownNames(region) } : null,
      statements: stmts,
      comparableStatements: comparable,
      statementScope: { era: scope.era || null, eraMode: scope.eraMode || 'overlap', regionId: scope.regionId || null },
      unfilteredStatementCount: unfilteredCount,
      mediaTasks: db.mediaTasks.filter(t => {
        const img = db.images.find(i => i.id === t.imageId);
        return img && ex.imageId === img.id;
      }),
      publicationVersion: db.publication?.id || null,
    };
  }

  function serveImage(res, imageId, crop = null) {
    const img = db.images.find(i => i.id === imageId);
    if (!img) throw new AppError(404, 'NOT_FOUND', '图像缺失');
    const file = join(ROOT, 'data', 'images', img.filename);
    if (!existsSync(file)) throw new AppError(404, 'NO_IMAGE_FILE', '图像文件缺失');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-store'); // 受许可图片不允许共享缓存
    if (!crop) return createReadStream(file).pipe(res);
    // 裁切：用 viewBox 输出细节图（不改动原图）。
    res.setHeader('X-Detail-Crop', JSON.stringify(crop));
    readFile(file, 'utf8').then(svg => {
      const iw = img.width || 800, ih = img.height || 600;
      const vb = `${crop.x * iw} ${crop.y * ih} ${crop.w * iw} ${crop.h * ih}`;
      res.end(svg.replace(/viewBox="[^"]*"/, `viewBox="${vb}"`));
    });
  }

  async function staticFiles(req, res, p) {
    let rel = p === '/' ? 'index.html' : p.slice(1);
    rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    // /media 下不开放静态读取（图像走许可接口）
    if (rel.startsWith('media/')) throw new AppError(403, 'IMAGE_RESTRICTED', '图片须经拍摄许可接口获取');
    const file = join(ROOT, 'public', rel);
    if (!existsSync(file) || !file.startsWith(join(ROOT, 'public'))) {
      // SPA 回退到 index
      const fallback = join(ROOT, 'public', 'index.html');
      if (existsSync(fallback) && extname(p) === '') return sendFile(res, fallback, 'text/html; charset=utf-8');
      throw new AppError(404, 'NOT_FOUND', '文件不存在');
    }
    return sendFile(res, file, MIME[extname(file)] || 'application/octet-stream');
  }

  server._getDb = () => db;
  return server;
}

function sendFile(res, file, type) {
  res.setHeader('Content-Type', type);
  createReadStream(file).pipe(res);
}
async function readJson(req) {
  if (req.headers['content-type'] && !req.headers['content-type'].includes('application/json')) return {};
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
