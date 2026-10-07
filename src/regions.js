// 地区与称呼改版：地区 id 永久稳定；名称是带版本的列表。
// 改版（如行政区划调整、民族自称规范更新）新增版本，旧称保留为「曾用名」，
// 搜索仍可命中旧称；指向该地区的历史陈述不被改写。
import { normYear } from './ids.js';
import { badRequest, notFound } from './errors.js';

export function renameRegion(db, regionId, newName, { effectiveYear, reason } = {}) {
  const region = db.regions.find(r => r.id === regionId);
  if (!region) throw notFound(`地区不存在: ${regionId}`);
  const year = normYear(effectiveYear);
  if (year == null) throw badRequest('effectiveYear 必填');
  const current = currentName(region, year);
  if (current && current.name === newName) {
    throw badRequest('新称呼与当前称呼相同');
  }
  const version = { name: String(newName).trim(), effectiveYear: year, reason: reason || null };
  if (!version.name) throw badRequest('称呼不能为空');
  region.names.push(version);
  region.names.sort((a, b) => a.effectiveYear - b.effectiveYear);
  region.updatedAt = new Date().toISOString();
  return { region, previous: current, version };
}

export function currentName(region, year = new Date().getFullYear()) {
  let hit = null;
  for (const n of region.names) if (n.effectiveYear <= year) hit = n;
  return hit;
}

export function nameAt(region, year) {
  return currentName(region, year);
}

export function allKnownNames(region) {
  return region.names.map(n => n.name);
}
