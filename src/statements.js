// 多来源陈述模型（对比单一权威标签，见 docs/statements.md）
// 一条陈述 = 一个解释 + 语境（地区/年代范围）+ 具体来源 + 审校状态 + 争议归属。
import { normYear } from './ids.js';
import { badRequest, notFound } from './errors.js';

export const SUBJECT_TYPES = ['motif', 'appellation', 'occasion', 'exhibit'];
export const STATUSES = ['draft', 'approved'];
// 独立展品类型（不复用为陈述状态，仅说明域）：
export const EXHIBIT_TYPES = ['historical', 'stage_reconstruction', 'contemporary_daily'];

export function requireStatement(db, id) {
  const s = db.statements.find(x => x.id === id);
  if (!s) throw notFound(`陈述不存在: ${id}`);
  return s;
}

function validateEra(era) {
  if (!era || era.start == null || era.end == null) throw badRequest('era.start / era.end 必填');
  const start = normYear(era.start);
  const end = normYear(era.end);
  if (start > end) throw badRequest('年代范围起点不能晚于终点', { start, end });
  return { start, end };
}

// 创建陈述。注意：同 motif 不同语境必须分别建陈述，本函数不做任何「图案相同即合并」。
export function createStatement(db, payload) {
  const { subjectType, subjectId, regionId, interpretation, source, confidence } = payload;
  if (!SUBJECT_TYPES.includes(subjectType)) throw badRequest('非法 subjectType', { subjectType });
  if (!subjectId) throw badRequest('subjectId 必填');
  if (!regionId || !db.regions.some(r => r.id === regionId)) throw badRequest('regionId 无效', { regionId });
  if (!source || !source.title) throw badRequest('source.title 必填（具体来源不可省略）');
  if (!interpretation || (!interpretation.zh && !interpretation.en)) throw badRequest('解释内容必填');

  const era = validateEra(payload.era || {});
  const now = new Date().toISOString();
  const stmt = {
    id: payload.id || `st_${Math.random().toString(36).slice(2, 10)}`,
    subjectType,
    subjectId,
    regionId,
    era,
    interpretation: {
      zh: interpretation.zh || '',
      en: interpretation.en || null,
      tai: interpretation.tai || null,
    },
    source: {
      kind: source.kind || 'document', // document | fieldwork | collection_record | other
      title: source.title,
      author: source.author || null,
      year: source.year != null ? normYear(source.year) : null,
      url: source.url || null,
    },
    confidence: confidence || 'medium', // high | medium | low
    status: 'draft',
    disputed: !!payload.disputed,
    disputeNote: payload.disputeNote || null,
    // 审校结论独立留痕：争议陈述经审校后可带结论发布。
    review: null,
    retracted: false,
    retraction: null,
    createdAt: now,
    updatedAt: now,
  };
  db.statements.push(stmt);
  return stmt;
}

// 审校：批准 / 退回；可对争议给出结论。批准不改变其他陈述（换版时统一生效）。
export function reviewStatement(db, id, { decision, note, reviewer }) {
  const s = requireStatement(db, id);
  if (!STATUSES.includes(`draft`) ) {/* noop */}
  if (!['approve', 'reject'].includes(decision)) throw badRequest('decision 须为 approve/reject');
  s.review = { decision, note: note || null, reviewer: reviewer || 'editor', at: new Date().toISOString() };
  if (decision === 'approve') {
    s.status = 'approved';
    if (s.retracted) throw badRequest('已撤回的陈述不能批准');
  } else {
    s.status = 'draft';
  }
  s.updatedAt = new Date().toISOString();
  return s;
}

// 来源撤回：陈述保留（审校痕迹），但任何渠道不再展示；需重新发布使搜索索引换版。
export function retractStatement(db, id, { reason, by } = {}) {
  const s = requireStatement(db, id);
  if (s.retracted) throw badRequest('该陈述已撤回');
  s.retracted = true;
  s.retraction = { reason: reason || '来源撤回', by: by || 'editor', at: new Date().toISOString() };
  s.status = 'draft'; // 撤回后即使旧快照外也不再有效
  s.updatedAt = new Date().toISOString();
  return s;
}

// 年代范围匹配：默认 overlap（与筛选区间有交集）；contain = 陈述区间被完全包含。
export function eraMatches(stmtEra, filterEra, mode = 'overlap') {
  if (!filterEra || (filterEra.start == null && filterEra.end == null)) return true;
  const fs = filterEra.start != null ? normYear(filterEra.start) : -Infinity;
  const fe = filterEra.end != null ? normYear(filterEra.end) : Infinity;
  if (fs > fe && Number.isFinite(fs) && Number.isFinite(fe)) return false;
  if (mode === 'contain') return stmtEra.start >= fs && stmtEra.end <= fe;
  return stmtEra.start <= fe && stmtEra.end >= fs;
}

// 地区匹配：支持「某地区及其子地区」（按 path 前缀），以适配跨省州/县的筛选。
export function regionMatches(stmtRegionId, filterRegionId, db) {
  if (!filterRegionId) return true;
  if (stmtRegionId === filterRegionId) return true;
  const target = db.regions.find(r => r.id === filterRegionId);
  const stmt = db.regions.find(r => r.id === stmtRegionId);
  if (!target || !stmt) return false;
  const prefix = (target.path || target.id) + '/';
  return (stmt.path || stmt.id).startsWith(prefix);
}

// 范围匹配的解释筛选：subject + 年代（overlap/contain）+ 地区层级 + 类型 + 可见性。
export function filterStatements(db, opts = {}) {
  const {
    subjectType, subjectId, regionId, era, eraMode = 'overlap',
    includeRetracted = false, includeUnapproved = false,
  } = opts;
  return db.statements.filter(s => {
    if (subjectType && s.subjectType !== subjectType) return false;
    if (subjectId && s.subjectId !== subjectId) return false;
    if (!includeRetracted && s.retracted) return false;
    if (!includeUnapproved && s.status !== 'approved') return false;
    if (!eraMatches(s.era, era || {}, eraMode)) return false;
    if (!regionMatches(s.regionId, regionId, db)) return false;
    return true;
  });
}

// 判断两条陈述是否因「图案相同」而可合并——系统立场：永不自动合并。
// 即便图形指纹一致，语境（地区/年代/来源）或解释不同即为不同陈述。
export function sameMotifDifferentContext(a, b) {
  return a.subjectType === 'motif' && b.subjectType === 'motif'
    && a.subjectId === b.subjectId
    && (a.regionId !== b.regionId
      || a.era.start !== b.era.start || a.era.end !== b.era.end
      || a.source.title !== b.source.title);
}
