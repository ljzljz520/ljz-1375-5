"""
核心领域逻辑 / Core domain logic.

设计原则：
1. 多来源陈述模型：同一纹样在不同 地区/年代/类型 语境下的解释各自独立，
   绝不因图案相同而合并；争议 (dispute_with) 与审校结论 (review_note) 一并保留。
2. 范围匹配：陈述的 region/era/type 范围包含筛选语境时才命中；
   NULL 表示“不限制/全域”。
3. 借出 (is_on_loan) 只影响现场可见性，不影响数字文字说明；
   拍摄许可 (has_shoot_grant) 独立控制图片渠道；文字授权 (has_text_grant) 控制文字。
4. 编辑批准走 revisions 队列；批准后统一发布：重写 FTS 索引并提升版本，
   旧索引立即删除——受限/撤回解释不会继续展示。
"""
import json
import sqlite3


# ---------------------------------------------------------------------------
# 范围匹配 / Scope matching
# ---------------------------------------------------------------------------
def region_contains(conn, stmt_region_id, filter_region_id):
    """陈述地区是否包含筛选地区。NULL=不限制；嵌套集合 lft<=x AND rgt>=x。"""
    if stmt_region_id is None:
        return True
    if filter_region_id is None:
        # 筛选未指定地区时，具体语境的陈述仍展示（按各自范围列出）
        return True
    r = conn.execute(
        "SELECT lft, rgt FROM regions WHERE id=?", (stmt_region_id,)
    ).fetchone()
    x = conn.execute(
        "SELECT lft, rgt FROM regions WHERE id=?", (filter_region_id,)
    ).fetchone()
    if not r or not x:
        return stmt_region_id == filter_region_id
    return r["lft"] <= x["lft"] and r["rgt"] >= x["rgt"]


def era_contains(conn, stmt_era_id, filter_era_id):
    """陈述年代是否覆盖筛选年代。NULL=不限制；区间相交视为覆盖，完全相等最佳。"""
    if stmt_era_id is None:
        return True
    if filter_era_id is None:
        return True
    s = conn.execute("SELECT start_y,end_y FROM eras WHERE id=?", (stmt_era_id,)).fetchone()
    x = conn.execute("SELECT start_y,end_y FROM eras WHERE id=?", (filter_era_id,)).fetchone()
    if not s or not x:
        return stmt_era_id == filter_era_id
    if s["start_y"] is None and s["end_y"] is None:
        return True
    lo = max(s["start_y"] or -9999, x["start_y"] or -9999)
    hi = min(s["end_y"] or 9999, x["end_y"] or 9999)
    return lo <= hi


def type_contains(conn, stmt_type_id, filter_type_id):
    """类型必须精确（历史实物/舞台复原/当代日常互为独立类型，不可混用）。"""
    if stmt_type_id is None:
        return True
    if filter_type_id is None:
        return True
    return stmt_type_id == filter_type_id


def statement_matches(conn, stmt, region_id=None, era_id=None, type_id=None):
    return (
        region_contains(conn, stmt["region_id"], region_id)
        and era_contains(conn, stmt["era_id"], era_id)
        and type_contains(conn, stmt["type_id"], type_id)
    )


# ---------------------------------------------------------------------------
# 可见性 / Visibility
# ---------------------------------------------------------------------------
def source_live(conn, source_id):
    row = conn.execute("SELECT is_retracted FROM sources WHERE id=?", (source_id,)).fetchone()
    return bool(row) and not row["is_retracted"]


def statement_public(conn, stmt):
    """已批准 + 未撤回 + 来源未撤回。"""
    return (
        stmt["status"] == "approved"
        and source_live(conn, stmt["source_id"])
    )


def visible_media(asset):
    """图片可见：有 URL、媒体本身可见、且拍摄许可独立授权。"""
    return bool(asset["url"]) and asset["is_visible"] and asset["has_shoot_grant"]


# ---------------------------------------------------------------------------
# 陈述查询（带范围筛选，返回争议分组）/ Statement queries
# ---------------------------------------------------------------------------
SUBJECT_TABLE = {"motif": "motifs", "appellation": "appellations",
                 "occasion": "occasions", "exhibit": "exhibits"}


def statements_for_subject(conn, subject_type, subject_id,
                           region_id=None, era_id=None, type_id=None):
    rows = conn.execute(
        """SELECT s.*, so.title AS source_title, so.kind AS source_kind,
                  so.is_retracted AS source_retracted,
                  r.name_zh AS region_name, e.name_zh AS era_name,
                  t.name_zh AS type_name,
                  d.claim_zh AS disputes_claim
             FROM statements s
             JOIN sources so ON so.id = s.source_id
             LEFT JOIN regions r ON r.id = s.region_id
             LEFT JOIN eras e ON e.id = s.era_id
             LEFT JOIN object_types t ON t.id = s.type_id
             LEFT JOIN statements d ON d.id = s.dispute_with
            WHERE s.subject_type=? AND s.subject_id=? AND s.status='approved'
            ORDER BY s.created_at""",
        (subject_type, subject_id),
    ).fetchall()
    out = []
    for row in rows:
        in_scope = statement_matches(conn, row, region_id, era_id, type_id)
        d = dict(row)
        d["in_scope"] = in_scope
        d["source_live"] = not row["source_retracted"]
        out.append(d)
    return out


# ---------------------------------------------------------------------------
# 发布 / Publish：统一更新搜索与详情，旧索引不保留受限解释
# ---------------------------------------------------------------------------
def current_version(conn):
    row = conn.execute("SELECT MAX(version) v FROM publications").fetchone()
    return row["v"] or 0


def _approved_text_grant(conn, exhibit_id):
    row = conn.execute("SELECT has_text_grant FROM exhibits WHERE id=?", (exhibit_id,)).fetchone()
    return bool(row and row["has_text_grant"])


def rebuild_search(conn, version):
    """全量重写 FTS——旧索引整体删除，杜绝受限/撤回解释残留。"""
    conn.execute("DELETE FROM search_index")
    exhibits = conn.execute(
        """SELECT ex.*, r.name_zh AS region_name, e.name_zh AS era_name,
                  t.name_zh AS type_name
             FROM exhibits ex
             LEFT JOIN regions r ON r.id=ex.region_id
             LEFT JOIN eras e ON e.id=ex.era_id
             LEFT JOIN object_types t ON t.id=ex.type_id
            WHERE ex.searchable=1"""
    ).fetchall()
    for ex in exhibits:
        if not _approved_text_grant(conn, ex["id"]):
            continue
        body = [ex["summary_zh"] or "", ex["summary_en"] or ""]
        # 地区称呼（含已改版的历史称呼，便于检索）
        terms = conn.execute(
            """SELECT a.term_zh, a.term_en, a.phonetic
                 FROM exhibit_appellations ea JOIN appellations a ON a.id=ea.appellation_id
                WHERE ea.exhibit_id=?""", (ex["id"],)).fetchall()
        body += [f"{t['term_zh']} {t['term_en'] or ''} {t['phonetic'] or ''}" for t in terms]
        # 纹样与“当前可见的”陈述（来源撤回/陈述撤回一律不入索引）
        motifs = conn.execute(
            """SELECT DISTINCT m.id, m.name_zh, m.name_en FROM exhibit_patterns ep
                 JOIN motifs m ON m.id=ep.motif_id WHERE ep.exhibit_id=?""",
            (ex["id"],)).fetchall()
        motif_names = []
        for m in motifs:
            motif_names += [m["name_zh"] or "", m["name_en"] or ""]
            stmts = statements_for_subject(
                conn, "motif", m["id"], ex["region_id"], ex["era_id"], ex["type_id"])
            for s in stmts:
                if s["in_scope"] and s["source_live"]:
                    body += [s["claim_zh"], s["claim_en"] or ""]
        title = f"{ex['title_zh']} {ex['title_en'] or ''}".strip()
        body += motif_names
        conn.execute(
            """INSERT INTO search_index(ref,kind,title,body,exhibit_id,version)
               VALUES(?,?,?,?,?,?)""",
            (f"exhibit:{ex['id']}", "exhibit", title,
             "\n".join(x for x in body if x), ex["id"], version),
        )
    # 纹样独立条目（跨展品浏览相似图案，解释仍按语境分列）
    motifs = conn.execute("SELECT * FROM motifs").fetchall()
    for m in motifs:
        stmts = statements_for_subject(conn, "motif", m["id"])
        bodies = []
        related = set()
        for s in stmts:
            if not s["source_live"]:
                continue
            bodies += [s["claim_zh"], s["claim_en"] or ""]
            if s["subject_type"] == "motif":
                for r in conn.execute(
                        "SELECT exhibit_id FROM exhibit_patterns WHERE motif_id=?",
                        (m["id"],)).fetchall():
                    related.add(r["exhibit_id"])
        if not bodies:
            continue
        conn.execute(
            """INSERT INTO search_index(ref,kind,title,body,exhibit_id,version)
               VALUES(?,?,?,?,NULL,?)""",
            (f"motif:{m['id']}", "motif",
             f"{m['name_zh']} {m['name_en'] or ''}".strip(),
             "\n".join(x for x in bodies if x), version),
        )


def publish(conn, note="", reviewer="curator"):
    """原子发布：应用全部已批准待处理修订 -> 刷新 searchable 标志
    -> 提升版本 -> 重写搜索索引。"""
    cur = conn.execute("BEGIN IMMEDIATE") if not conn.in_transaction else None
    try:
        approved = conn.execute(
            """SELECT * FROM revisions WHERE status='approved' AND action!='publish'
               ORDER BY CASE action WHEN 'link' THEN 1 ELSE 0 END, id"""
        ).fetchall()
        id_map = {}  # 队列里新建实体 -> 实际行 id（供 link 引用）
        for rev in approved:
            payload = json.loads(rev["payload"])
            ref = payload.get("appellation_id")
            if rev["action"] == "link" and isinstance(ref, dict) and "$ref_revision" in ref:
                payload["appellation_id"] = id_map.get(ref["$ref_revision"])
                rev = dict(rev); rev["payload"] = json.dumps(payload, ensure_ascii=False)
            new_id = apply_revision(conn, rev, mark=False)
            if rev["action"] == "upsert" and rev["entity_id"] is None:
                id_map[rev["id"]] = new_id
        version = current_version(conn) + 1
        # 刷新展品可搜索标志：至少有一条可见文字授权
        conn.execute(
            """UPDATE exhibits SET searchable = CASE WHEN has_text_grant=1 THEN 1 ELSE 0 END"""
        )
        # 陈述搜索标志与来源撤回联动
        conn.execute(
            """UPDATE statements SET is_searchable =
                  CASE WHEN status='approved'
                        AND source_id IN (SELECT id FROM sources WHERE is_retracted=0)
                       THEN 1 ELSE 0 END"""
        )
        rebuild_search(conn, version)
        conn.execute("INSERT INTO publications(version,note) VALUES(?,?)", (version, note))
        conn.execute(
            "UPDATE revisions SET status='applied' WHERE status='approved'"
        )
        conn.commit()
        return version
    except Exception:
        conn.rollback()
        raise


# ---------------------------------------------------------------------------
# 编辑修订 / Editorial revisions
# ---------------------------------------------------------------------------
TABLES_WITH_ID = {
    "sources": "sources", "exhibits": "exhibits", "motifs": "motifs",
    "appellations": "appellations", "occasions": "occasions",
    "statements": "statements", "media_assets": "media_assets",
    "annotations": "annotations", "media_tasks": "media_tasks",
}


def queue_revision(conn, table, entity_id, action, payload, note="", user="editor"):
    cur = conn.execute(
        """INSERT INTO revisions(entity_table,entity_id,action,payload,note,created_by)
           VALUES(?,?,?,?,?,?)""",
        (table, entity_id, action, json.dumps(payload, ensure_ascii=False), note, user),
    )
    conn.commit()
    return cur.lastrowid


def review_revision(conn, rev_id, decision, reviewer="curator", note=""):
    assert decision in ("approved", "rejected")
    conn.execute(
        """UPDATE revisions SET status=?, reviewed_by=?, note=COALESCE(?,note),
              reviewed_at=datetime('now') WHERE id=?""",
        (decision, reviewer, note or None, rev_id),
    )
    conn.commit()


def _upsert(conn, table, payload):
    data = dict(payload)
    eid = data.pop("id", None)
    cols = list(data.keys())
    if eid:
        sets = ", ".join(f"{c}=?" for c in cols)
        conn.execute(f"UPDATE {table} SET {sets} WHERE id=?",
                     [data[c] for c in cols] + [eid])
        return eid
    q = ",".join("?" for _ in cols)
        # 允许 NULL 列
    cur = conn.execute(
        f"INSERT INTO {table}({','.join(cols)}) VALUES({q})",
        [data[c] for c in cols])
    return cur.lastrowid


def apply_revision(conn, rev, mark=True):
    table = rev["entity_table"]
    payload = json.loads(rev["payload"])
    action = rev["action"]
    new_id = None
    if action == "upsert":
        new_id = _upsert(conn, table, payload)
        if rev["entity_id"] is None and new_id:
            conn.execute("UPDATE revisions SET entity_id=? WHERE id=?", (new_id, rev["id"]))
    elif action == "retract":
        if table == "sources":
            conn.execute(
                "UPDATE sources SET is_retracted=1, retract_note=? WHERE id=?",
                (payload.get("note", "来源撤回"), rev["entity_id"]))
        elif table == "statements":
            conn.execute(
                "UPDATE statements SET status='retracted', review_note=? WHERE id=?",
                (payload.get("note", "撤回"), rev["entity_id"]))
    elif action == "media_grant":
        conn.execute(
            "UPDATE media_assets SET has_shoot_grant=?, is_visible=? WHERE id=?",
            (payload.get("has_shoot_grant", 0), payload.get("is_visible", 0),
             rev["entity_id"]))
    elif action == "loan":
        conn.execute(
            "UPDATE exhibits SET is_on_loan=?, loan_note=? WHERE id=?",
            (payload.get("is_on_loan", 0), payload.get("loan_note"), rev["entity_id"]))
    elif action == "text_grant":
        conn.execute(
            "UPDATE exhibits SET has_text_grant=? WHERE id=?",
            (payload.get("has_text_grant", 1), rev["entity_id"]))
    elif action == "link":
        link_table = payload.get("link_table", table)
        cols = {c["name"] for c in conn.execute(
            f"PRAGMA table_info({link_table})").fetchall()}
        vals = {k: v for k, v in payload.items()
                if k in cols and k not in ("via_revision",)}
        if vals:
            conn.execute(
                f"INSERT OR IGNORE INTO {link_table}({','.join(vals)}) "
                f"VALUES({','.join('?' * len(vals))})", list(vals.values()))
    elif action == "deliver_media":
        conn.execute(
            """UPDATE media_tasks SET status='delivered', output_url=?,
                  delivered_at=datetime('now') WHERE id=?""",
            (payload.get("output_url"), rev["entity_id"]))
    if mark:
        conn.execute("UPDATE revisions SET status='applied' WHERE id=?", (rev["id"],))
    return new_id


# ---------------------------------------------------------------------------
# 检索 / Search
# ---------------------------------------------------------------------------
def search(conn, q, region_id=None, era_id=None, type_id=None, limit=50):
    if not q or not q.strip():
        rows = conn.execute(
            """SELECT * FROM search_index WHERE kind='exhibit' LIMIT ?""",
            (limit,)).fetchall()
    else:
        like = f"%{q.strip()}%"
        rows = conn.execute(
            """SELECT * FROM search_index
                WHERE title LIKE ? OR body LIKE ? LIMIT ?""",
            (like, like, limit)).fetchall()
    results = []
    for r in rows:
        item = dict(r)
        if r["kind"] == "exhibit":
            ex = conn.execute(
                """SELECT ex.*, t.name_zh AS type_name, r.name_zh AS region_name,
                          e.name_zh AS era_name
                     FROM exhibits ex
                     LEFT JOIN object_types t ON t.id=ex.type_id
                     LEFT JOIN regions r ON r.id=ex.region_id
                     LEFT JOIN eras e ON e.id=ex.era_id
                    WHERE ex.id=? AND ex.searchable=1""",
                (r["exhibit_id"],)).fetchone()
            if not ex:
                continue
            if region_id and not region_contains(conn, ex["region_id"], region_id):
                continue
            if era_id and not era_contains(conn, ex["era_id"], era_id):
                continue
            if type_id and not type_contains(conn, ex["type_id"], type_id):
                continue
            item["exhibit"] = dict(ex)
        results.append(item)
    return results
