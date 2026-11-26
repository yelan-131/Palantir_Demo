---
name: graph-explore-object-relationships
description: "按名称或编号定位对象，读取它与其他对象的关系、关联依据和可查看的属性，支持在关系探索中查看。"
compatibility: 需要连接 ManuFoundry，并拥有已发布对象记录及相关字段的查看权限。
metadata:
  version: "1.0.0"
  manufoundry-registry-id: "graph.explore_object_relationships"
---

# 探索对象与关系

用户想定位一个对象、查看它与其他对象的关联，或追查一条连线的依据时，使用此技能。适用于关系探索中能查看的已发布对象，查询沿用当前账号的租户、记录和字段权限。

1. 从请求中取对象名称或编号，传给 `graph.query_object_relationships` 的 `object_query`。用户明确指出对象类型时，把类型名称或编码传给 `object_type`。有重名时，提示用户补充类型或准确编号。工具找不到对象时，按回执说明，避免用相似名称代替。
2. 一般关系查询使用 `intent: relationships`。工具返回的 `relationship_query` 用于定位对象，返回的 `edges` 和 `evidence_records` 用于高亮可查看的直接关联。按回执区分出向和入向的连接，给出关系名称、源和目标记录以及可查看的字段依据。只呈现回执可证明的关系，有部分结果或依据信息缺失时明确指出。
3. 关系已有不同的证据性质。已记录的引用说明记录怎样连接，匹配候选需要同一指标、可换算单位和适用条件。数值近似或使用同一个单位，本身不足以判断两个对象适配。缺少需求限值、工况、对象归属或可查看的记录时，把对应的缺项给用户。
4. 这是只读查询。用户要求本次忽略既有条件时，只采用工具已支持的筛选参数。

## 示例

> VALVE-03 有哪些关系？

输入 `{"object_query":"VALVE-03","intent":"relationships"}`。用当前回执解释连线。

> 忽略已填牌号，查三通阀能用什么材料。

输入 `{"object_query":"三通阀","intent":"material_review","ignore_stored_grade":true}`。该场景仍使用同一个对象关系工具。工具如有返回适用的对照范围，按当前记录比较并说明缺项。整阀爆破压力和材料试片拉伸强度的测量对象不同，不能只凭两者的 MPa 数值判断用料。
