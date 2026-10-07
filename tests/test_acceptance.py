"""验收测试：五大场景 + 关键领域规则。每个用例使用独立临时数据库。"""
import io
import json
import os
import tempfile
import unittest
from urllib.parse import urlparse
from wsgiref.util import setup_testing_defaults

os.environ["BIANCHENG_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")

from app.db import init_db, get_db, DB_PATH  # noqa: E402
from app.server import application  # noqa: E402
from app import core  # noqa: E402


class AppTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db(DB_PATH)

    def setUp(self):
        self.conn = get_db(DB_PATH)

    def tearDown(self):
        self.conn.close()

    # -- HTTP 辅助 --------------------------------------------------------
    def call(self, path, method="GET", body=None):
        u = urlparse(path)
        env = {}
        setup_testing_defaults(env)
        env["PATH_INFO"], env["QUERY_STRING"], env["REQUEST_METHOD"] = u.path, u.query, method
        if body is not None:
            raw = json.dumps(body).encode()
            env["CONTENT_LENGTH"] = str(len(raw))
            env["wsgi.input"] = io.BytesIO(raw)
        cap = {}
        out = b"".join(application(env, lambda s, h: cap.update(status=s, headers=h)))
        return cap["status"], json.loads(out)

    def queue_approve_publish(self, table, action, payload, eid=None, note=""):
        _, r = self.call("/api/admin/queue", "POST",
                         {"table": table, "action": action, "payload": payload, "id": eid,
                          "note": note})
        rid = r["revision_id"]
        self.call(f"/api/admin/revision/{rid}/approve", "POST", {})
        _, pub = self.call("/api/admin/publish", "POST", {"note": "test publish"})
        return pub["version"]

    # 1) 地区称呼改版 -----------------------------------------------------
    def test_01_appellation_revision_keeps_old(self):
        v = self.queue_approve_publish("appellations", "upsert", {
            "region_id": 2, "term_zh": "挑花纹袖", "term_en": "picked-pattern sleeve",
            "phonetic": "tiāo-huā-wén xiù", "language": "zh",
            "superseded_by": 2, "changed_note": "普查规范名，旧称鱼骨袖保留备查",
            "changed_at": "2026-10-01"}, note="称呼改版")
        self.assertGreaterEqual(v, 2)
        # 旧称仍存在且标记 superseded
        old = self.conn.execute("SELECT * FROM appellations WHERE id=2").fetchone()
        self.assertTrue(old["term_zh"] == "鱼骨袖" and old["superseded_by"] == 1)
        # 旧称仍可被检索（在索引正文里）
        _, r = self.call("/api/search?q=" + "鱼骨袖")
        self.assertTrue(any(x["kind"] == "exhibit" for x in r["results"]))
        # 详情页同时返回新旧称呼及改版说明
        _, ex = self.call("/api/exhibit/1")
        terms = {a["term_zh"]: a for a in ex["appellations"]}
        self.assertIn("挑花袖", terms)
        self.assertIn("鱼骨袖", terms)

    # 2) 翻译缺失 ---------------------------------------------------------
    def test_02_missing_translation_falls_back_with_marker(self):
        _, ex = self.call("/api/exhibit/1")
        # 展品1 summary_en 为 None —— API 保留中文原文，由前端标注
        self.assertIsNone(ex["summary_en"])
        self.assertTrue(ex["summary_zh"])
        # 舞台陈述 #2 claim_en 为 None，结构上不臆造译文
        st = next(s for m in ex["motifs"] for s in m["statements"] if s["id"] == 2)
        self.assertIsNone(st["claim_en"])
        self.assertTrue(st["claim_zh"])
        # 英文检索不应命中没有译文的说法
        _, r = self.call("/api/search?q=water+wave")
        self.assertFalse(any(x["ref"] == "motif:1" for x in r["results"]))

    # 3) 图像裁切导致标注偏移 --------------------------------------------
    def test_03_crop_does_not_shift_annotations(self):
        _, ex = self.call("/api/exhibit/1")
        asset = next(m for m in ex["media"] if m["id"] == 1)
        anns = {a["id"]: a for a in asset["annotations"]}
        labels = {a["label_zh"]: a for a in asset["annotations"]}
        inside = labels["成双·婚嫁语境"]
        outside = labels["裁切线外的针脚标记"]
        # 坐标始终保留原图源坐标系，不被裁切改写
        self.assertAlmostEqual(inside["x"], 450)
        self.assertTrue(inside["inside_crop"])
        self.assertFalse(outside["inside_crop"])  # 框外标注自动隐藏
        # 框内/框外判定与框定义一致（热点中心法）
        cx = outside["x"] + outside["w"] / 2
        self.assertLess(cx, outside["crop_x"])

    # 4) 来源撤回：批准发布后旧索引不再展示受限解释 -----------------------
    def test_04_source_retraction_removes_from_public_and_index(self):
        # 撤回来源#5（网络无据来源），其陈述#4 应在发布后消失
        v = self.queue_approve_publish("sources", "retract",
                                       {"note": "出处无法核实，撤回"}, eid=5)
        # 公开详情不再给出陈述#4正文
        _, ex = self.call("/api/exhibit/1")
        ids = [s["id"] for m in ex["motifs"] for s in m["statements"]]
        self.assertNotIn(4, ids)
        # 纹样页仅保留撤回痕迹或完全隐藏该来源解释
        _, mo = self.call("/api/motif/1")
        self.assertFalse(any(s["source_id"] == 5 for s in mo["statements"]))
        # 索引重写：旧索引不含撤回来源特有措辞
        row = self.conn.execute(
            "SELECT body FROM search_index WHERE ref='motif:1'").fetchone()
        self.assertNotIn("鱼崇拜", row["body"] or "")
        # 发布版本提升，旧版本索引已整体删除
        n_versions = self.conn.execute(
            "SELECT COUNT(DISTINCT version) c FROM search_index").fetchone()["c"]
        self.assertEqual(n_versions, 1)
        self.assertEqual(self.conn.execute(
            "SELECT MAX(version) v FROM search_index").fetchone()["v"], v)

    # 5) 已收藏页面离线回归 ----------------------------------------------
    def test_05_offline_favorite_snapshot(self):
        # 公开详情响应携带发布版本，前端据此把快照存入 localStorage（结构契约）
        _, ex = self.call("/api/exhibit/3")
        self.assertIn("publication_version", ex)
        self.assertTrue(ex["summary_zh"])  # 离线时仍可读到已授权文字
        # 快照可在无网络时使用：序列化自包含（无游标等），重新解析无损
        snap = json.loads(json.dumps({"data": ex, "version": ex["publication_version"]}))
        self.assertEqual(snap["data"]["id"], 3)
        self.assertEqual(snap["version"], ex["publication_version"])

    # 附加：借出仅影响现场可见性，不改写历史说明 --------------------------
    def test_06_loan_affects_only_on_site(self):
        _, before = self.call("/api/exhibit/3")
        self.assertTrue(before["is_on_loan"])          # 种子里展品3已借出
        self.assertFalse(before["on_site_visible"])    # 现场不可见
        self.assertTrue(before["summary_zh"])          # 但历史说明照常
        self.assertTrue(before["motifs"][0]["statements"])  # 解释不受影响
        # 数字图片仍按拍摄许可独立判断
        self.assertIn("image_available", before["media"][0])

    # 附加：拍摄许可独立于文字授权 ---------------------------------------
    def test_07_shoot_grant_independent_image_channel(self):
        _, ex = self.call("/api/exhibit/1")
        no_grant = next(m for m in ex["media"] if m["id"] == 2)
        granted = next(m for m in ex["media"] if m["id"] == 1)
        self.assertFalse(no_grant["image_available"])   # 无拍摄许可
        self.assertIsNone(no_grant["url"])              # 不泄露图片地址
        self.assertTrue(granted["image_available"])
        self.assertTrue(ex["text_granted"])             # 文字依然开放
        # 授予拍摄许可并发布后，图片渠道出现
        self.queue_approve_publish("media_assets", "media_grant",
                                   {"has_shoot_grant": 1, "is_visible": 1}, eid=2)
        _, ex2 = self.call("/api/exhibit/1")
        self.assertTrue(next(m for m in ex2["media"] if m["id"] == 2)["image_available"])

    # 附加：范围匹配（地区层级 / 年代区间 / 类型精确） -------------------
    def test_08_scope_matching_rules(self):
        c = self.conn
        # 类型必须精确：实物陈述不覆盖舞台筛选
        s1 = c.execute("SELECT * FROM statements WHERE id=1").fetchone()
        self.assertFalse(core.type_contains(c, s1["type_id"], 2))
        self.assertTrue(core.type_contains(c, s1["type_id"], 1))
        # 地区层级：茶峒陈述(2) 对具体点茶峒成立；不对对岸黔东南(4)成立
        self.assertTrue(core.region_contains(c, 2, 2))
        self.assertFalse(core.region_contains(c, 2, 4))
        # 全域陈述(NULL)覆盖任何筛选
        s4 = c.execute("SELECT * FROM statements WHERE id=4").fetchone()
        self.assertTrue(core.region_contains(c, s4["region_id"], 4))
        # 年代区间相交：清末(1875-1911) 与民国(1912-1949) 不相交
        self.assertFalse(core.era_contains(c, 1, 2))
        self.assertTrue(core.era_contains(c, 1, 1))

    # 附加：相似图案不合并，争议与审校结论保留 ---------------------------
    def test_09_same_motif_multiple_statements_kept_separate(self):
        _, mo = self.call("/api/motif/1")
        self.assertGreaterEqual(len(mo["statements"]), 3)
        claims = {s["id"]: s for s in mo["statements"]}
        # 实物婚俗解释与舞台水浪解释各自独立
        self.assertIn("婚嫁", claims[1]["claim_zh"])
        self.assertIn("水浪", claims[2]["claim_zh"])
        self.assertEqual(claims[1]["dispute_with"], None)
        self.assertEqual(claims[2]["dispute_with"], 1)
        self.assertIn("不予合并", claims[1]["review_note"])
        # 当代口述保持 contested
        self.assertEqual(claims[3]["confidence"], "contested")

    # 附加：统一发布原子性 —— 批准后一次发布同时刷新搜索与详情 -----------
    def test_10_publish_updates_search_and_detail_together(self):
        _, before = self.call("/api/search?q=认得出门的人")
        self.assertTrue(before["results"])
        # 新增一条已批准陈述（经由队列），发布前公开端不可见
        _, r = self.call("/api/admin/queue", "POST", {
            "table": "statements", "action": "upsert", "payload": {
                "subject_type": "motif", "subject_id": 2, "region_id": 2,
                "era_id": 3, "type_id": 3, "source_id": 2,
                "source_id": 1,
             "claim_zh": "新审校的栅栏纹解释：用于孩童围腰。",
                "confidence": "single", "status": "approved"}})
        rid = r["revision_id"]
        self.call(f"/api/admin/revision/{rid}/approve", "POST", {})
        # 未发布前：搜索不到新措辞
        _, pre = self.call("/api/search?q=孩童围腰")
        self.assertFalse(any("孩童围腰" in (x.get("body") or "") for x in pre["results"]))
        # 发布后：搜索与详情同一版本可见
        _, pub = self.call("/api/admin/publish", "POST", {"note": "add statement"})
        _, post = self.call("/api/search?q=孩童围腰")
        self.assertTrue(post["results"])
        _, mo = self.call("/api/motif/2")
        self.assertTrue(any("孩童围腰" in (s["claim_zh"] or "") for s in mo["statements"]))
        self.assertEqual(post["results"][0]["version"], pub["version"])

    # 附加：无图仍保留经授权的文字 ---------------------------------------
    def test_11_missing_image_keeps_authorized_text(self):
        _, ex = self.call("/api/exhibit/3")
        missing = next(m for m in ex["media"] if m["id"] == 3)
        self.assertFalse(missing["image_available"])
        self.assertIsNone(missing["url"])
        # 围腰的栅栏纹解释仍可阅读
        self.assertTrue(any(
            "栅栏" in (m["name_zh"] or "") and m["statements"]
            for m in ex["motifs"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
