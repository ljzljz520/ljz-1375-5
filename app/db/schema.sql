-- 边城服饰数字展 · 多来源陈述模型
-- Border City Attire Digital Exhibition — multi-source statement model
PRAGMA foreign_keys = ON;

-- 参考数据：地区（带层级 lft/rgt，用于范围匹配） ----------
CREATE TABLE regions (
  id        INTEGER PRIMARY KEY,
  code      TEXT NOT NULL UNIQUE,
  name_zh   TEXT NOT NULL,
  name_en   TEXT,
  lft       INTEGER NOT NULL,
  rgt       INTEGER NOT NULL,
  parent_id INTEGER REFERENCES regions(id)
);

-- 年代 ---------------------------------------------------
CREATE TABLE eras (
  id      INTEGER PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  start_y INTEGER,
  end_y   INTEGER
);

-- 展品类型：历史实物 / 舞台复原 / 当代日常（互相独立，不合并）
CREATE TABLE object_types (
  id      INTEGER PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT
);

-- 具体来源 -------------------------------------------------
CREATE TABLE sources (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,          -- 文献/受访者/档案名
  kind         TEXT NOT NULL,          -- publication|fieldwork|archive|museum|stage
  author       TEXT,
  citation     TEXT,                   -- 完整著录
  contact      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  is_retracted INTEGER NOT NULL DEFAULT 0,  -- 来源撤回（编辑批准后生效）
  retract_note TEXT
);

-- 展品 ---------------------------------------------------
CREATE TABLE exhibits (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title_zh     TEXT NOT NULL,
  title_en     TEXT,
  type_id      INTEGER NOT NULL REFERENCES object_types(id),
  region_id    INTEGER REFERENCES regions(id),
  era_id       INTEGER REFERENCES eras(id),
  year_detail  TEXT,
  summary_zh   TEXT,
  summary_en   TEXT,
  is_on_loan   INTEGER NOT NULL DEFAULT 0, -- 借出：只影响现场可见性
  loan_note    TEXT,
  has_text_grant  INTEGER NOT NULL DEFAULT 1, -- 文字授权
  searchable   INTEGER NOT NULL DEFAULT 0, -- 批准发布后进入搜索
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 纹样（相似图案共用一个 motif 条目，但解释永不按图案合并） --
CREATE TABLE motifs (
  id        INTEGER PRIMARY KEY,
  slug      TEXT NOT NULL UNIQUE,
  name_zh   TEXT NOT NULL,
  name_en   TEXT,
  visual    TEXT,                  -- 几何描述，仅用于相似性展示
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE exhibit_patterns (
  exhibit_id INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  motif_id   INTEGER NOT NULL REFERENCES motifs(id),
  placement  TEXT,                -- 袖口/下摆/头帕…
  PRIMARY KEY (exhibit_id, motif_id, placement)
);

-- 地区称呼：改版保留历史版本 ---------------------------------
CREATE TABLE appellations (
  id          INTEGER PRIMARY KEY,
  region_id   INTEGER NOT NULL REFERENCES regions(id),
  term_zh     TEXT NOT NULL,
  term_en     TEXT,
  phonetic    TEXT,                -- 读音（如 qiòng-pà）
  language    TEXT,
  superseded_by INTEGER REFERENCES appellations(id),
  changed_note TEXT,
  changed_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE exhibit_appellations (
  exhibit_id     INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  appellation_id INTEGER NOT NULL REFERENCES appellations(id),
  PRIMARY KEY (exhibit_id, appellation_id)
);

-- 穿着场合 ------------------------------------------------
CREATE TABLE occasions (
  id      INTEGER PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name_zh TEXT NOT NULL,
  name_en TEXT
);
CREATE TABLE exhibit_occasions (
  exhibit_id  INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  occasion_id INTEGER NOT NULL REFERENCES occasions(id),
  PRIMARY KEY (exhibit_id, occasion_id)
);

-- 陈述（核心）：每条解释绑定 地区/年代/类型范围 + 具体来源
-- 相同图案的不同语境解释各自独立；可存争议与审校结论
CREATE TABLE statements (
  id            INTEGER PRIMARY KEY,
  subject_type  TEXT NOT NULL,      -- motif|appellation|occasion|exhibit
  subject_id    INTEGER NOT NULL,
  region_id     INTEGER REFERENCES regions(id),  -- NULL = 不限制
  era_id        INTEGER REFERENCES eras(id),
  type_id       INTEGER REFERENCES object_types(id),
  source_id     INTEGER NOT NULL REFERENCES sources(id),
  claim_zh      TEXT NOT NULL,
  claim_en      TEXT,
  confidence    TEXT NOT NULL DEFAULT 'open', -- single|contested|resolved|retracted
  dispute_with  INTEGER REFERENCES statements(id), -- 与哪条解释构成争议
  review_note   TEXT,              -- 审校结论
  status        TEXT NOT NULL DEFAULT 'draft',    -- draft|approved|retracted
  is_searchable INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (subject_type, subject_id, source_id, region_id, era_id, type_id)
);
CREATE INDEX idx_stmt_subject ON statements(subject_type, subject_id, status);

-- 媒体：拍摄许可独立于文字授权，仅控制图片渠道 --------------
CREATE TABLE media_assets (
  id           INTEGER PRIMARY KEY,
  exhibit_id   INTEGER NOT NULL REFERENCES exhibits(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL DEFAULT 'detail', -- overview|detail
  url          TEXT,                       -- 无图时为 NULL
  alt_zh       TEXT,
  alt_en       TEXT,
  has_shoot_grant INTEGER NOT NULL DEFAULT 0, -- 拍摄许可（独立渠道开关）
  is_visible   INTEGER NOT NULL DEFAULT 0,
  source_id    INTEGER REFERENCES sources(id),
  width        INTEGER,
  height       INTEGER
);

-- 标注：坐标存于【原图源坐标系】0..1000；裁切框不改变坐标
CREATE TABLE annotations (
  id         INTEGER PRIMARY KEY,
  asset_id   INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  motif_id   INTEGER REFERENCES motifs(id),
  x          REAL NOT NULL,  -- 原图坐标 0..1000
  y          REAL NOT NULL,
  w          REAL NOT NULL,
  h          REAL NOT NULL,
  label_zh   TEXT NOT NULL,
  label_en   TEXT,
  crop_x     REAL NOT NULL DEFAULT 0,   -- 裁切框（同一原图源坐标系）
  crop_y     REAL NOT NULL DEFAULT 0,
  crop_w     REAL NOT NULL DEFAULT 1000,
  crop_h     REAL NOT NULL DEFAULT 1000
);

-- 媒体任务：生成细节图 --------------------------------------
CREATE TABLE media_tasks (
  id          INTEGER PRIMARY KEY,
  exhibit_id  INTEGER NOT NULL REFERENCES exhibits(id),
  motif_id    INTEGER REFERENCES motifs(id),
  instruction TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'requested', -- requested|delivered|rejected
  output_url  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at TEXT
);

-- 编辑审校队列（统一编辑批准入口）---------------------------
CREATE TABLE revisions (
  id           INTEGER PRIMARY KEY,
  entity_table TEXT NOT NULL,
  entity_id    INTEGER,
  action       TEXT NOT NULL,           -- upsert|retract|publish
  payload      TEXT NOT NULL,           -- JSON
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  note         TEXT,
  created_by   TEXT NOT NULL DEFAULT 'editor',
  reviewed_by  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at  TEXT
);

-- 发布版本（批准后统一更新搜索与详情；旧版本不再展示受限解释）--
CREATE TABLE publications (
  id         INTEGER PRIMARY KEY,
  version    INTEGER NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  note       TEXT
);

-- 全文索引：仅收录已批准、未撤回、来源未撤回、且有授权的内容 --
CREATE VIRTUAL TABLE search_index USING fts5(
  ref,              -- exhibit:<id> | motif:<id>
  kind,             -- exhibit|motif
  title,
  body,
  exhibit_id UNINDEXED,
  version,
  tokenize = 'trigram'   -- 支持中文短语/子串检索
);
