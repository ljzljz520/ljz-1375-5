// 稳定 ID 生成：环境可注入（测试），避免对随机/时钟的硬依赖。
let seq = 0;
export function resetIdSeq(n = 0) { seq = n; }

export function id(prefix) {
  seq += 1;
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

// 年份规范化：支持负年（公元前）与数字字符串。
export function normYear(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`非法年份: ${v}`);
  return Math.trunc(n);
}
