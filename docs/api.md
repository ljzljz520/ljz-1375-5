# API 速览

编辑写操作需要请求头 `X-Editor: <token>`（默认 `editor-token`，可用 `BC_EDITOR_TOKEN` 覆盖）。

## 公开

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查与当前发布版本 |
| GET | `/api/regions` | 地区（当前称呼 + 曾用名） |
| GET | `/api/motifs` | 纹样（图形分组，不承载含义） |
| GET | `/api/exhibits?type=&onSite=` | 展品列表；类型三选一；onSite=true 排除借出 |
| GET | `/api/exhibits/:id?eraStart=&eraEnd=&eraMode=overlap|contain&regionId=` | 详情 + 范围匹配后的解释 |
| GET | `/api/exhibits/:id/image` | 图像渠道（受拍摄许可，403 受限；`Cache-Control: no-store`） |
| GET | `/api/media-tasks/:id/image` | 细节图（裁切视图，同样受许可） |
| GET | `/api/search?q=&subjectType=&subjectId=&regionId=&eraStart=&eraEnd=&eraMode=` | 已发布快照上的搜索（倒排含旧称） |
| GET | `/api/search-index` | 当前倒排索引（调试） |
| GET | `/api/statements` | 已发布陈述 |
| GET/POST/DELETE | `/api/favorites[/:id]` | 收藏 |
| GET | `/api/exhibits/:id/offline` | 离线文字包（受限图片标记为不可缓存） |

## 编辑（需 X-Editor）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/statements?scope=editor` | 含草稿/撤回 |
| POST | `/api/regions` `/api/motifs` `/api/exhibits` `/api/appellations` `/api/occasions` | 新建 |
| POST | `/api/regions/:id/rename` | 称呼改版（新名称版本，旧称保留） |
| POST | `/api/statements` | 新建陈述（草稿） |
| POST | `/api/statements/:id/review` | `{decision:"approve|reject",note}` |
| POST | `/api/statements/:id/retract` | 来源撤回（记录保留，展示撤回） |
| POST | `/api/exhibits/:id/loan` | 借出/归还（仅现场可见性） |
| POST | `/api/exhibits/:id/photo-permission` | 拍摄许可（仅图片渠道） |
| POST | `/api/media-tasks` | `{imageId,crop:{x,y,w,h}}` 生成细节图与标注换算 |
| POST | `/api/publish` | 统一发布：搜索 + 详情原子换版 |

## 错误码

- `401 UNAUTHORIZED` 缺/错编辑令牌
- `403 IMAGE_RESTRICTED` 拍摄许可未开放
- `404 NO_IMAGE / NOT_FOUND`
- `400 BAD_REQUEST` 校验失败（年代倒置、缺来源等）
