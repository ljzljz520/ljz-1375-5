// 发布：编辑批准后统一更新「搜索 + 展品详情」。
// 做法：生成一份 publication 快照（仅含 approved 且未撤回的陈述），
// 原子替换当前 publication；搜索索引从快照构建。旧索引立即失效，
// 不能再展示受限（未批准/已撤回）解释。
import { allKnownNames, currentName } from './regions.js';

export function publishableStatements(db) {
  return db.statements.filter(s => s.status === 'approved' && !s.retracted);
}

function statementSnapshot(db, s) {
  const region = db.regions.find(r => r.id === s.regionId) || null;
  return {
    id: s.id,
    subjectType: s.subjectType,
    subjectId: s.subjectId,
    regionId: s.regionId,
    regionName: region ? currentName(region)?.name : null,
    era: s.era,
    interpretation: s.interpretation,
    source: s.source,
    confidence: s.confidence,
    disputed: s.disputed,
    disputeNote: s.disputeNote,
    review: s.review ? { decision: s.review.decision, note: s.review.note, at: s.review.at } : null,
    updatedAt: s.updatedAt,
  };
}

export function publish(db, { by = 'editor' } = {}) {
  const snaps = publishableStatements(db).map(s => statementSnapshot(db, s));
  const pub = {
    id: `pub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    by,
    count: snaps.length,
    statements: snaps,
    prevId: db.publication?.id || null,
  };
  db.publication = pub; // 配合文件原子写实现整库换版
  return pub;
}

// 从已发布快照检索（搜索/详情统一走这里，杜绝旧索引漏网）。
export function publishedStatements(db) {
  return db.publication ? db.publication.statements : [];
}

export function currentVersion(db) {
  return db.publication ? { id: db.publication.id, createdAt: db.publication.createdAt, count: db.publication.count } : null;
}

// 构建倒排 token（含地区旧称，保证改版后曾用名仍可检索）。
export function buildSearchIndex(db) {
  const tokens = new Map(); // token -> statementId[]
  const add = (text, sid) => {
    if (!text) return;
    for (const t of tokenize(text)) {
      if (!tokens.has(t)) tokens.set(t, []);
      const arr = tokens.get(t);
      if (!arr.includes(sid)) arr.push(sid);
    }
  };
  for (const s of publishedStatements(db)) {
    add(s.interpretation.zh, s.id);
    add(s.interpretation.en, s.id);
    const region = db.regions.find(r => r.id === s.regionId);
    if (region) for (const name of allKnownNames(region)) add(name, s.id);
    add(s.source.title, s.id);
  }
  return { version: db.publication?.id || null, tokens: [...tokens.entries()].map(([t, ids]) => [t, ids]) };
}

export function tokenize(text) {
  return String(text).toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    // 中文按 2-gram 补切分，保证无空格中文可检索
    .flatMap(t => /[一-鿿]/u.test(t) && t.length > 1 ? bigrams(t) : [t]);
}

function bigrams(word) {
  const out = [word];
  for (let i = 0; i < word.length - 1; i++) out.push(word.slice(i, i + 2));
  return out;
}
