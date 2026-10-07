// 搜索：仅基于已发布快照；文本查询走倒排索引（含地区旧称，OR 命中），
// 再施加年代范围、地区层级、主题类型等结构化过滤。
import { tokenize } from './publish.js';
import { eraMatches, regionMatches } from './statements.js';

export function search(db, opts = {}) {
  if (!db.publication) return { version: null, results: [] };
  let pool = db.publication.statements;

  if (opts.q) {
    // 倒排索引：token -> statementId[]
    const index = buildTokenMap(db);
    const wanted = tokenize(opts.q);
    const hits = new Set();
    for (const w of wanted) for (const id of index.get(w) || []) hits.add(id);
    pool = pool.filter(s => hits.has(s.id));
  }
  const results = pool.filter(s => {
    if (opts.subjectType && s.subjectType !== opts.subjectType) return false;
    if (opts.subjectId && s.subjectId !== opts.subjectId) return false;
    if (!eraMatches(s.era, opts.era || {}, opts.eraMode || 'overlap')) return false;
    if (!regionMatches(s.regionId, opts.regionId, db)) return false;
    return true;
  });
  return { version: db.publication.id, results };
}

let tokenMapCache = null;
export function buildTokenMap(db) {
  const version = db.publication?.id;
  if (tokenMapCache && tokenMapCache.version === version) return tokenMapCache.map;
  const m = new Map();
  const add = (text, sid) => {
    for (const t of tokenize(text || '')) {
      if (!m.has(t)) m.set(t, new Set());
      m.get(t).add(sid);
    }
  };
  for (const s of db.publication.statements) {
    add(s.interpretation.zh, s.id);
    add(s.interpretation.en, s.id);
    add(s.interpretation.tai, s.id);
    add(s.source.title, s.id);
    add(s.source.author, s.id);
    const region = db.regions.find(r => r.id === s.regionId);
    if (region) for (const n of region.names) add(n.name, s.id); // 含曾用名
  }
  tokenMapCache = { version, map: m };
  return m;
}

// 数据变更后清缓存（发布换版本身版本号即变，测试注入 db 时也安全）。
export function invalidateSearchCache() { tokenMapCache = null; }
