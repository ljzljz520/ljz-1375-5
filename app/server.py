"""零依赖 WSGI 服务：静态页 + JSON API / stdlib-only WSGI server."""
import json
import os
import re
from urllib.parse import parse_qs, urlparse

from . import core
from .db import get_db, init_db

WEB = os.path.join(os.path.dirname(__file__), "..", "web")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def json_response(obj, status="200 OK"):
    body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    return status, [("Content-Type", "application/json; charset=utf-8"),
                    ("Content-Length", str(len(body))),
                    ("Cache-Control", "no-store")], body


def err(msg, code=400):
    status = f"{code} {'Bad Request' if code == 400 else 'Error'}"
    return json_response({"error": msg}, status)


def static(environ, path):
    if path == "/":
        path = "/index.html"
    fp = os.path.normpath(os.path.join(WEB, path.lstrip("/")))
    if not fp.startswith(os.path.abspath(WEB)) or not os.path.isfile(fp):
        fp = os.path.join(WEB, "index.html")  # SPA 回退
    ext = os.path.splitext(fp)[1]
    body = open(fp, "rb").read()
    return "200 OK", [("Content-Type", MIME.get(ext, "application/octet-stream")),
                      ("Content-Length", str(len(body)))], body


# ---------------------------------------------------------------------------
# 序列化
# ---------------------------------------------------------------------------
def exhibit_brief(conn, row):
    d = dict(row)
    d["on_site_visible"] = not row["is_on_loan"]
    media = conn.execute(
        "SELECT * FROM media_assets WHERE exhibit_id=?", (row["id"],)).fetchall()
    d["images"] = [dict(m) for m in media if core.visible_media(m)]
    return d


def exhibit_detail(conn, ex_id, region_id=None, era_id=None, type_id=None):
    ex = conn.execute(
        """SELECT ex.*, t.name_zh AS type_name, t.code AS type_code,
                  r.name_zh AS region_name, e.name_zh AS era_name
             FROM exhibits ex
             LEFT JOIN object_types t ON t.id=ex.type_id
             LEFT JOIN regions r ON r.id=ex.region_id
             LEFT JOIN eras e ON e.id=ex.era_id
            WHERE ex.id=?""", (ex_id,)).fetchone()
    if not ex:
        return None
    d = exhibit_brief(conn, ex)
    # 文字授权：无文字授权时不返回解释正文
    d["text_granted"] = bool(ex["has_text_grant"])
    d["on_site_visible"] = not ex["is_on_loan"]

    apps = conn.execute(
        """SELECT a.*, r.name_zh AS region_name FROM exhibit_appellations ea
             JOIN appellations a ON a.id=ea.appellation_id
             LEFT JOIN regions r ON r.id=a.region_id
            WHERE ea.exhibit_id=?""", (ex_id,)).fetchall()
    d["appellations"] = [dict(a) for a in apps]

    occas = conn.execute(
        """SELECT o.* FROM exhibit_occasions eo JOIN occasions o ON o.id=eo.occasion_id
            WHERE eo.exhibit_id=?""", (ex_id,)).fetchall()
    d["occasions"] = [dict(o) for o in occas]

    motifs = conn.execute(
        """SELECT m.*, ep.placement FROM exhibit_patterns ep
             JOIN motifs m ON m.id=ep.motif_id WHERE ep.exhibit_id=?""",
        (ex_id,)).fetchall()
    d["motifs"] = []
    for m in motifs:
        md = dict(m)
        stmts = core.statements_for_subject(
            conn, "motif", m["id"],
            region_id or ex["region_id"], era_id or ex["era_id"],
            type_id or ex["type_id"])
        # 来源撤回的陈述：公开页不展示其正文，只留撤回痕迹元信息
        # 来源撤回或陈述撤回：公开页不展示（旧索引也不残留）；审校痕迹在编辑台保留
        md["statements"] = [dict(s) for s in stmts if s["source_live"]]
        d["motifs"].append(md)

    # 媒体：拍摄许可独立——无许可只保留占位与授权文字，不提供图片 URL
    media = conn.execute(
        "SELECT * FROM media_assets WHERE exhibit_id=? ORDER BY id", (ex_id,)).fetchall()
    d["media"] = []
    for a in media:
        ad = dict(a)
        ad["image_available"] = core.visible_media(a)
        if not ad["image_available"]:
            ad["url"] = None
        if ad["image_available"]:
            anns = conn.execute(
                "SELECT * FROM annotations WHERE asset_id=?", (a["id"],)).fetchall()
            ad["annotations"] = []
            for an in anns:
                and_ = dict(an)
                # 裁切可见性：以热点中心是否落在裁切框内判定，坐标保持原图源
                cx = an["x"] + an["w"] / 2
                cy = an["y"] + an["h"] / 2
                and_["inside_crop"] = (
                    an["crop_x"] <= cx <= an["crop_x"] + an["crop_w"]
                    and an["crop_y"] <= cy <= an["crop_y"] + an["crop_h"]
                )
                ad["annotations"].append(and_)
        else:
            ad["annotations"] = []
        d["media"].append(ad)

    d["publication_version"] = core.current_version(conn)
    return d


def motif_detail(conn, motif_id, region_id=None, era_id=None, type_id=None):
    m = conn.execute("SELECT * FROM motifs WHERE id=?", (motif_id,)).fetchone()
    if not m:
        return None
    d = dict(m)
    stmts = core.statements_for_subject(conn, "motif", motif_id,
                                        region_id, era_id, type_id)
    d["statements"] = [dict(s) for s in stmts if s["source_live"]]
    exs = conn.execute(
        """SELECT ex.* FROM exhibit_patterns ep JOIN exhibits ex ON ex.id=ep.exhibit_id
            WHERE ep.motif_id=? AND ex.searchable=1""", (motif_id,)).fetchall()
    d["used_by"] = [exhibit_brief(conn, x) for x in exs]
    return d


# ---------------------------------------------------------------------------
# 引用数据
# ---------------------------------------------------------------------------
def refs(conn):
    return {
        "regions": [dict(r) for r in conn.execute("SELECT * FROM regions ORDER BY lft")],
        "eras": [dict(e) for e in conn.execute("SELECT * FROM eras ORDER BY start_y")],
        "types": [dict(t) for t in conn.execute("SELECT * FROM object_types")],
        "occasions": [dict(o) for o in conn.execute("SELECT * FROM occasions")],
        "version": core.current_version(conn),
    }


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
GET_ROUTES = []
POST_ROUTES = []


def route(pattern, table):
    rx = re.compile("^" + pattern + "$")
    def deco(fn):
        table.append((rx, fn))
        return fn
    return deco


# 公开 API ---------------------------------------------------------------
@route(r"/api/refs", GET_ROUTES)
def r_refs(conn, q, body):
    return refs(conn)


@route(r"/api/search", GET_ROUTES)
def r_search(conn, q, body):
    return {"results": core.search(
        conn, q.get("q", [""])[0],
        _int(q, "region"), _int(q, "era"), _int(q, "type"))}


@route(r"/api/exhibits", GET_ROUTES)
def r_exhibits(conn, q, body):
    rows = conn.execute(
        """SELECT ex.*, t.name_zh AS type_name, r.name_zh AS region_name,
                  e.name_zh AS era_name
             FROM exhibits ex
             LEFT JOIN object_types t ON t.id=ex.type_id
             LEFT JOIN regions r ON r.id=ex.region_id
             LEFT JOIN eras e ON e.id=ex.era_id
            WHERE ex.searchable=1 ORDER BY ex.id""").fetchall()
    items, region, era, typ = [], _int(q, "region"), _int(q, "era"), _int(q, "type")
    for x in rows:
        if region and not core.region_contains(conn, x["region_id"], region):
            continue
        if era and not core.era_contains(conn, x["era_id"], era):
            continue
        if typ and not core.type_contains(conn, x["type_id"], typ):
            continue
        items.append(exhibit_brief(conn, x))
    return {"exhibits": items}


@route(r"/api/exhibit/(\d+)", GET_ROUTES)
def r_exhibit(conn, q, body, eid):
    d = exhibit_detail(conn, int(eid), _int(q, "region"), _int(q, "era"), _int(q, "type"))
    return d or ({"error": "not found"}, 404)


@route(r"/api/exhibit/slug/([^/]+)", GET_ROUTES)
def r_exhibit_slug(conn, q, body, slug):
    row = conn.execute("SELECT id FROM exhibits WHERE slug=?", (slug,)).fetchone()
    if not row:
        return {"error": "not found"}, 404
    return r_exhibit(conn, q, body, row["id"])


@route(r"/api/motif/(\d+)", GET_ROUTES)
def r_motif(conn, q, body, mid):
    d = motif_detail(conn, int(mid), _int(q, "region"), _int(q, "era"), _int(q, "type"))
    return d or ({"error": "not found"}, 404)


@route(r"/api/motifs", GET_ROUTES)
def r_motifs(conn, q, body):
    return {"motifs": [dict(m) for m in conn.execute("SELECT * FROM motifs ORDER BY id")]}


# 编辑 API ---------------------------------------------------------------
@route(r"/api/admin/sources", GET_ROUTES)
def r_admin_sources(conn, q, body):
    return {"sources": [dict(s) for s in conn.execute("SELECT * FROM sources ORDER BY id")]}


@route(r"/api/admin/revisions", GET_ROUTES)
def r_admin_revisions(conn, q, body):
    rows = conn.execute("SELECT * FROM revisions ORDER BY id DESC LIMIT 100").fetchall()
    return {"revisions": [dict(r) for r in rows]}


@route(r"/api/admin/drafts", GET_ROUTES)
def r_admin_drafts(conn, q, body):
    """草稿态/撤回态内容（编辑视图可见，公开页不可见）。"""
    return {
        "statements": [dict(s) for s in conn.execute(
            "SELECT * FROM statements ORDER BY id")],
        "media_tasks": [dict(t) for t in conn.execute("SELECT * FROM media_tasks ORDER BY id")],
        "publications": [dict(p) for p in conn.execute(
            "SELECT * FROM publications ORDER BY version DESC")],
    }


@route(r"/api/admin/queue", POST_ROUTES)
def r_queue(conn, q, body):
    table = body.get("table")
    action = body.get("action", "upsert")
    if table not in core.TABLES_WITH_ID and action not in (
            "retract", "media_grant", "loan", "text_grant",
            "deliver_media", "link"):
        return {"error": "unknown table"}, 400
    payload = body.get("payload", {})
    if action == "link" and "via_revision" in payload:
        # 找到被登记的新称呼行：应用后实体 id 会回填，这里先记住队列 id，
        # 发布顺序保证 appellation upsert 先于 link（同批按 id 排序）。
        payload["link_table"] = "exhibit_appellations"
        payload["appellation_id"] = {"$ref_revision": payload.pop("via_revision")}
    rid = core.queue_revision(
        conn, table, body.get("id"), action, payload, 
        body.get("note", ""), body.get("user", "editor"))
    return {"revision_id": rid, "status": "pending"}


@route(r"/api/admin/revision/(\d+)/(approve|reject)", POST_ROUTES)
def r_review(conn, q, body, rid, decision):
    core.review_revision(conn, int(rid),
                         "approved" if decision == "approve" else "rejected",
                         body.get("reviewer", "curator"), body.get("note", ""))
    return {"ok": True}


@route(r"/api/admin/publish", POST_ROUTES)
def r_publish(conn, q, body):
    version = core.publish(conn, body.get("note", ""), body.get("reviewer", "curator"))
    return {"ok": True, "version": version,
            "index_refreshed": True}


def _int(q, name):
    v = q.get(name, [None])[0]
    return int(v) if v not in (None, "") else None


def application(environ, start_response):
    conn = get_db()
    try:
        parsed = urlparse(environ["PATH_INFO"])
        path = parsed.path
        q = parse_qs(environ.get("QUERY_STRING", ""))
        body = {}
        if environ.get("REQUEST_METHOD") == "POST":
            raw = environ["wsgi.input"].read(int(environ.get("CONTENT_LENGTH") or 0))
            if raw:
                body = json.loads(raw.decode("utf-8"))
        table = POST_ROUTES if environ["REQUEST_METHOD"] == "POST" else GET_ROUTES
        for rx, fn in table:
            m = rx.match(path)
            if m:
                result = fn(conn, q, body, *m.groups())
                if isinstance(result, tuple) and len(result) == 2 and isinstance(result[1], int):
                    status, resp = f"{result[1]} Error", result[0]
                else:
                    status, resp = "200 OK", result
                st, h, b = json_response(resp, status if status != "200 OK" else "200 OK")
                start_response(st, h)
                return [b]
        if path.startswith("/api/"):
            st, h, b = err("not found", 404)
            start_response(st, h)
            return [b]
        st, h, b = static(environ, path)
        start_response(st, h)
        return [b]
    finally:
        conn.close()


if __name__ == "__main__":
    from wsgiref.simple_server import make_server
    from .db import DB_PATH
    if not os.path.exists(DB_PATH):
        init_db()
    port = int(os.environ.get("PORT", "8000"))
    with make_server("", port, application) as httpd:
        print(f"边城服饰数字展 http://127.0.0.1:{port}")
        httpd.serve_forever()
