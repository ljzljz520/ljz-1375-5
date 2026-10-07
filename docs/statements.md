# 陈述模型 vs 单一权威标签

## 方案对比

| 维度 | 单一权威标签 | 多来源陈述（本系统采用） |
|---|---|---|
| 结构 | 纹样 → 一个"标准含义" | 纹样 ← N 条 Statement（解释+语境+来源） |
| 地域差异 | 被迫取一种说法 | 同纹异义分条并存，按地区/年代筛选 |
| 争议 | 覆盖删除，争议痕迹消失 | `disputed` + `disputeNote` + `review` 结论留痕，可带结论发布 |
| 来源撤回 | 含义悬空或静默改动 | 陈述标 `retracted` 保留，展示渠道立即撤回 |
| 审校 | 只有"改" | 草稿 → 批准/退回，结论与证据绑定 |
| 适用 | 受控词表、检索分面 | 人文阐释型数字展 |

服饰纹样属于人文解释对象：相似（甚至相同）图案在不同民族、年代、仪式语境中含义不同，
因此本系统**按陈述而不是按图案合并解释**。

## Statement 结构

```jsonc
{
  "id": "st_...",
  "subjectType": "motif|appellation|occasion|exhibit",
  "subjectId": "mf_rhombus",          // 被解释对象
  "regionId": "r_jingxi",             // 绑定地区（稳定 id）
  "era": { "start": 1850, "end": 1970 }, // 绑定年代范围
  "interpretation": { "zh": "...", "en": null, "tai": null },
  "source": { "kind": "document|fieldwork|collection_record|other",
              "title": "具体来源（必填）", "author": "...", "year": 2009, "url": null },
  "confidence": "high|medium|low",
  "status": "draft|approved",
  "disputed": true, "disputeNote": "…",
  "review": { "decision": "approve|reject", "note": "审校结论", "reviewer": "…", "at": "…" },
  "retracted": false, "retraction": { "reason": "来源撤回", "at": "…" }
}
```

## 不合并规则

`sameMotifDifferentContext(a,b)`：同一 `motifId` 但地区、年代范围或来源任一不同，
即视为不同陈述。纹样的 `fingerprint` 只用于"图形相似"提示，不承载、不归并含义。

## 展品三类型（独立，不互转）

- `historical` 历史实物
- `stage_reconstruction` 舞台复原（当代创作的复原呈现，不是实物）
- `contemporary_daily` 当代日常样式

## 两条正交的可见性开关

| 开关 | 影响面 | 不影响 |
|---|---|---|
| `loan.active` 借出 | 现场展柜是否可见（列表 onSite 筛选） | 历史说明文字、图片许可 |
| `photoPermission.allowed` 拍摄许可 | 图片渠道（原图/细节图 API、离线图片缓存） | 文字内容、现场可见性 |

缺图片时，已授权的文字陈述照常展示；文字与图片可分别授权。

## 范围匹配

- 年代：默认 `overlap`（陈述区间与筛选区间有交集）；`eraMode=contain` 要求被完全包含。
- 地区：层级匹配，筛选上级地区命中其 path 下所有子地区。
- 调用：`filterStatements(db, { subjectType, subjectId, regionId, era, eraMode })`
  或公开搜索 `GET /api/search?eraStart=&eraEnd=&regionId=&eraMode=`。

## 发布换版

`POST /api/publish` 生成不可变 publication 快照（仅 approved 且未撤回陈述）。
搜索索引与展品详情都从当前快照读取：换版即换索引，旧索引不再被任何读路径引用，
因此受限解释（新撤回、未批准）在重新发布后不可能继续展示。
