// 展品：历史实物 / 舞台复原 / 当代日常 为互相独立的类型，
// 即便外观与纹样相同也不互相归并。
// 借出(loan) 只影响现场可见性；拍摄许可(photoPermission) 独立决定图片渠道。
// 二者是两条正交开关，任何一个都不改写历史说明（陈述）。
import { EXHIBIT_TYPES } from './statements.js';
import { badRequest, notFound } from './errors.js';

export function createExhibit(db, p) {
  if (!EXHIBIT_TYPES.includes(p.type)) throw badRequest('非法展品类型', { type: p.type });
  if (!p.title || !(p.title.zh || p.title.en)) throw badRequest('展品标题必填');
  const now = new Date().toISOString();
  const ex = {
    id: p.id || `ex_${Math.random().toString(36).slice(2, 10)}`,
    type: p.type,
    title: { zh: p.title.zh || '', en: p.title.en || null, tai: p.title.tai || null },
    motifIds: p.motifIds || [],
    regionId: p.regionId || null,
    era: p.era || null,
    summary: {
      zh: p.summary?.zh || '',
      en: p.summary?.en || null,
      tai: p.summary?.tai || null,
    },
    // 现场可见性
    loan: { active: false, outSince: null, returnExpected: null, borrower: null },
    // 图片渠道许可（与借出正交）
    photoPermission: { allowed: p.photoPermissionAllowed ?? true, note: null },
    imageId: p.imageId || null,
    createdAt: now,
    updatedAt: now,
  };
  db.exhibits.push(ex);
  return ex;
}

export function requireExhibit(db, id) {
  const ex = db.exhibits.find(x => x.id === id);
  if (!ex) throw notFound(`展品不存在: ${id}`);
  return ex;
}

// 登记/归还借出。只改可见性标记，不触碰任何陈述文本。
export function setLoan(db, id, { active, outSince, returnExpected, borrower }) {
  const ex = requireExhibit(db, id);
  ex.loan = {
    active: !!active,
    outSince: active ? (outSince || new Date().toISOString()) : null,
    returnExpected: active ? (returnExpected || null) : null,
    borrower: active ? (borrower || null) : null,
  };
  ex.updatedAt = new Date().toISOString();
  return ex;
}

// 拍摄许可独立变更，只影响图像渠道。
export function setPhotoPermission(db, id, { allowed, note }) {
  const ex = requireExhibit(db, id);
  ex.photoPermission = { allowed: !!allowed, note: note ?? ex.photoPermission.note };
  ex.updatedAt = new Date().toISOString();
  return ex;
}

export function isOnSite(ex) { return !ex.loan.active; }
export function imageChannelOpen(ex) { return !!ex.photoPermission.allowed; }
