// 纹样：记录图形指纹（仅用于"看起来相同"的分组展示），不承载含义。
// 含义全部存在 Statement(subjectType='motif') 上；相同指纹在不同语境可有不同陈述。
import { badRequest } from './errors.js';

export function createMotif(db, { id, name, fingerprint, svg }) {
  if (!name || !(name.zh || name.en)) throw badRequest('纹样名称必填');
  const motif = {
    id: id || `mf_${Math.random().toString(36).slice(2, 10)}`,
    name: { zh: name.zh || '', en: name.en || null, tai: name.tai || null },
    fingerprint: fingerprint || null,
    svg: svg || null,
    createdAt: new Date().toISOString(),
  };
  db.motifs.push(motif);
  return motif;
}

// 找到同图形的纹样（用于提示编辑"存在相似纹样"），但不合并其解释。
export function findSimilar(db, fingerprint, excludeId = null) {
  if (!fingerprint) return [];
  return db.motifs.filter(m => m.fingerprint === fingerprint && m.id !== excludeId);
}
