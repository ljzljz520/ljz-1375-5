# 边城服饰数字展 · Border City Attire Digital Exhibition

一个零依赖（仅 Python 标准库 + SQLite FTS5）的数字展系统，演示
**多来源陈述模型**如何取代“单一权威标签”，在保留学术争议与审校结论的同时，
支持按 地区 / 年代 / 类型 做范围匹配的解释筛选。

## 运行

```bash
python3 -m app.server            # 默认 http://127.0.0.1:8000
PORT=9000 python3 -m app.server
```

首次启动自动建库并写入示例数据（湘黔渝交界“边城”的挑花服饰）。
公开站：`/`　编辑台：`/editor.html`

## 测试

```bash
python3 tests/test_acceptance.py
```

## 领域模型要点

- **相似纹样不合并解释**：`statements` 每一条解释都绑定
  `region_id / era_id / type_id + source_id`。同一“交叉鱼骨纹”在
  *清末茶峒实物（婚嫁成双）*、*2001 舞台复原（水浪装饰）*、
  *当代日常围腰（同乡识别）* 下各有独立陈述；争议用 `dispute_with`
  关联，审校结论写 `review_note`，两说可并存。
- **范围匹配**：地区用嵌套集合（lft/rgt）做层级包含；年代按区间相交；
  展品类型（历史实物 / 舞台复原 / 当代日常）必须精确一致。
- **两条独立渠道**：
  - 借出 `exhibits.is_on_loan` 只改变**现场可见性**，数字历史说明原样保留；
  - 拍摄许可 `media_assets.has_shoot_grant` 独立控制**图片渠道**；
  - 文字授权 `exhibits.has_text_grant` 控制解释正文。
  - 无图或缺拍摄许可时，经授权的文字照常展示。
- **编辑批准 → 统一发布**：所有写操作先进入 `revisions` 队列；
  批准后 `POST /api/admin/publish` 在一个事务里应用修订、
  **全量重写 FTS5 索引**并提升 `publications.version`——
  旧索引立即删除，撤回来源、撤销授权的解释不会继续出现在搜索或详情中。
- **地区称呼改版**：新称呼不覆盖旧称呼，旧条目 `superseded_by`
  指向新条目并保留改名说明；旧称呼仍被索引可检索。
- **翻译缺失**：缺英文时不臆造，前端回退中文原文并标注“EN pending”。
- **图像裁切不偏移标注**：标注坐标始终基于**原图源 0..1000 坐标系**，
  裁切框（crop_x/y/w/h）只决定显示窗口；框外热点自动隐藏。
  细节查看器可纯键盘操作：`Tab` 聚焦、`←/→` 切换、`Enter` 读说明、
  `+/-` 缩放、`R` 重置。
- **离线回归**：公开端网络优先，失败时回退已发布快照
  （Service Worker + localStorage），收藏页离线可回看，
  重连后按新版本自动更新；`/api/admin` 永不缓存。

## 目录

```
app/db/schema.sql   表结构（含 FTS5 trigram 全文索引）
app/core.py         范围匹配 / 可见性 / 修订 / 统一发布
app/server.py       零依赖 WSGI：静态站 + JSON API
app/seed.py         示例数据（含争议、撤回、缺译、裁切、借出等边界情况）
web/                公开站(index/app.js/sw.js) 与编辑台(editor.*)
tests/              11 项验收测试
```

## 验收场景对照

| 需求 | 测试 |
|---|---|
| 地区称呼改版（旧称保留、可检索） | `test_01_appellation_revision_keeps_old` |
| 翻译缺失回退与标注 | `test_02_missing_translation_falls_back_with_marker` |
| 图像裁切导致标注偏移 | `test_03_crop_does_not_shift_annotations` |
| 来源撤回 + 旧索引清除 | `test_04_source_retraction_removes_from_public_and_index` |
| 已收藏页面离线回归 | `test_05_offline_favorite_snapshot` |
| 借出不改写历史说明 | `test_06_loan_affects_only_on_site` |
| 拍摄许可独立于文字授权 | `test_07_shoot_grant_independent_image_channel` |
| 范围匹配三规则 | `test_08_scope_matching_rules` |
| 相似图案不合并/保留争议 | `test_09_same_motif_multiple_statements_kept_separate` |
| 批准后统一更新搜索与详情 | `test_10_publish_updates_search_and_detail_together` |
| 缺图保留授权文字 | `test_11_missing_image_keeps_authorized_text` |
