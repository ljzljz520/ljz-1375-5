"""SQLite connection helpers / 数据库连接"""
import os, sqlite3

DB_PATH = os.environ.get(
    "BIANCHENG_DB", os.path.join(os.path.dirname(__file__), "..", "data", "biancheng.db")
)
SCHEMA = os.path.join(os.path.dirname(__file__), "db", "schema.sql")


def get_db(path=None):
    path = path or DB_PATH
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(path=None, seed=True):
    conn = get_db(path)
    with open(SCHEMA, encoding="utf-8") as f:
        conn.executescript(f.read())
    conn.commit()
    if seed:
        from .seed import seed
        seed(conn)
        conn.commit()
    return conn
