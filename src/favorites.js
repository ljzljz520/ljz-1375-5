// 收藏：记录访客收藏的展品页。离线回归时据此提供已缓存的文字快照；
// 无拍摄许可的图像永远不进入离线缓存（文字与图像渠道分离）。
import { notFound } from './errors.js';
import { isOnSite, imageChannelOpen, requireExhibit } from './exhibits.js';
import { publishedStatements } from './publish.js';
import { currentName } from './regions.js';
import { regionMatches } from './statements.js';

export function addFavorite(db, exhibitId) {
  requireExhibit(db, exhibitId);
  if (!db.favorites.some(f => f.exhibitId === exhibitId)) {
    db.favorites.push({ exhibitId, at: new Date().toISOString() });
  }
  return db.favorites;
}

export function removeFavorite(db, exhibitId) {
  db.favorites = db.favorites.filter(f => f.exhibitId !== exhibitId);
  return db.favorites;
}

// 离线包：仅文字（已发布、未撤回陈述）。图像是否可缓存由 photoPermission 决定。
export function offlineBundle(db, exhibitId) {
  const ex = requireExhibit(db, exhibitId);
  const region = ex.regionId ? db.regions.find(r => r.id === ex.regionId) : null;
  const exRegion = region;
  const own = s =>
    (s.subjectType === 'exhibit' && s.subjectId === ex.id) ||
    (s.subjectType === 'motif' && ex.motifIds.includes(s.subjectId)
      && (!exRegion || regionMatches(s.regionId, exRegion.id, db)));
  const other = s =>
    s.subjectType === 'motif' && ex.motifIds.includes(s.subjectId)
      && exRegion && !regionMatches(s.regionId, exRegion.id, db);
  return {
    exhibitId: ex.id,
    type: ex.type,
    title: ex.title,
    summary: ex.summary,
    region: region ? { id: region.id, currentName: currentName(region)?.name ?? null } : null,
    onSite: isOnSite(ex),
    loan: ex.loan,
    image: imageChannelOpen(ex) && ex.imageId
      ? { imageId: ex.imageId, cacheable: true }
      : { imageId: null, cacheable: false, reason: ex.imageId ? 'no_photo_permission' : 'no_image' },
    // 本展品语境的解释；跨语境相似纹样解释单独存放，离线同样不合并
    statements: publishedStatements(db).filter(own),
    comparableStatements: publishedStatements(db).filter(other),
    generatedAt: new Date().toISOString(),
    version: db.publication?.id || null,
  };
}

export { notFound };
