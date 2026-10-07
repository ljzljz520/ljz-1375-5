// 媒体任务：从原图生成细节图（裁切），并把标注热点坐标换算到裁切后的坐标空间。
// 关键验收点：图像裁切导致标注偏移——必须按裁切矩形做坐标变换，
// 落在裁切区之外的标注标记 outside（不强行平移、不静默错位）。
import { notFound, badRequest } from './errors.js';

export function requireImage(db, imageId) {
  const img = db.images.find(i => i.id === imageId);
  if (!img) throw notFound(`图像不存在: ${imageId}`);
  return img;
}

// crop = { x, y, w, h } 相对原图 0..1 的归一化矩形。
export function normalizeCrop(crop, img) {
  const c = crop || { x: 0, y: 0, w: 1, h: 1 };
  for (const k of ['x', 'y', 'w', 'h']) {
    if (typeof c[k] !== 'number' || Number.isNaN(c[k])) throw badRequest(`crop.${k} 必须是数字`);
  }
  if (c.w <= 0 || c.h <= 0) throw badRequest('裁切宽高必须为正');
  const x = Math.max(0, c.x), y = Math.max(0, c.y);
  const w = Math.min(c.w, 1 - x), h = Math.min(c.h, 1 - y);
  if (w <= 0 || h <= 0) throw badRequest('裁切区域超出图像范围');
  return { x, y, w, h };
}

const inside = (px, py, c) =>
  px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h;

// 单标注坐标变换：原图归一化坐标 -> 细节图归一化坐标。
export function mapPoint(px, py, c) {
  return { x: (px - c.x) / c.w, y: (py - c.y) / c.h };
}

// 生成媒体任务：返回每个标注的变换结果，含 outside 状态（对应标注偏移/丢失验收）。
export function generateDetail(db, { imageId, crop, title }) {
  const img = requireImage(db, imageId);
  const c = normalizeCrop(crop, img);
  const annotations = (img.annotations || []).map(a => {
    if (!inside(a.x, a.y, c)) {
      return { id: a.id, label: a.label, status: 'outside', x: null, y: null,
               reason: '标注位于裁切区域之外，未映射到细节图' };
    }
    const p = mapPoint(a.x, a.y, c);
    return { id: a.id, label: a.label, status: 'mapped', x: round(p.x), y: round(p.y) };
  });
  const task = {
    id: `mt_${Math.random().toString(36).slice(2, 10)}`,
    imageId,
    title: title || `细节图 ${img.id}`,
    crop: c,
    sourceWidth: img.width || null,
    sourceHeight: img.height || null,
    annotations,
    createdAt: new Date().toISOString(),
  };
  db.mediaTasks.push(task);
  return task;
}

const round = n => Math.round(n * 1e6) / 1e6;
