// 文件型存储（原子写：写临时文件后 rename）。
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const EMPTY_DB = () => ({
  version: 1,
  regions: [], motifs: [], exhibits: [], statements: [],
  appellations: [], occasions: [],
  images: [], mediaTasks: [], favorites: [],
  publication: null, // { id, createdAt, statements:[snapshot], searchVersion }
  seq: 0,
});

export function loadDb(file) {
  if (!existsSync(file)) return EMPTY_DB();
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function saveDb(db, file) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(db, null, 2));
  renameSync(tmp, file); // 同目录原子替换
}
