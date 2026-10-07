// 称呼（appellation）与穿着场合（occasion）实体；其含义/语用同样由 Statement 承载，
// 因此一个称呼在不同地区、年代、来源下可以有不同的语用解释，分条保存。
import { badRequest } from './errors.js';

export function createAppellation(db, p) {
  if (!p.name?.zh) throw badRequest('称呼名称必填');
  const a = {
    id: p.id || `ap_${Math.random().toString(36).slice(2, 10)}`,
    name: { zh: p.name.zh, en: p.name.en || null, tai: p.name.tai || null },
    regionId: p.regionId || null,
    refersTo: p.refersTo || null, // 指向展品/服饰类别 id
    createdAt: new Date().toISOString(),
  };
  db.appellations.push(a);
  return a;
}

export function createOccasion(db, p) {
  if (!p.name?.zh) throw badRequest('场合名称必填');
  const o = {
    id: p.id || `oc_${Math.random().toString(36).slice(2, 10)}`,
    name: { zh: p.name.zh, en: p.name.en || null, tai: p.name.tai || null },
    note: p.note || null,
    createdAt: new Date().toISOString(),
  };
  db.occasions.push(o);
  return o;
}
