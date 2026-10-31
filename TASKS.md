# TASKS.md — v0.5.0 质量增强包（AgentTeams 投影，终态以平台为准）
- [x] T1 服务端增强：失败兜底+自检规则+多候选选优+上下文压缩 — done（c110605；修复 da28a33 经 t5）
- [x] T2 客户端：弹出层「多候选」开关 + 请求字段 — done（46a7788）
- [x] T2b 门禁补充：fallback 契约 + multiCandidate 2 条 — done（4039bab）
- [x] T3 全量验证 + 发布 v0.5.0 — done（attempt1 failed 发现 P8 → t5 修复 → attempt2 通过，ad60434，tag v0.5.0 已推）
- [x] T5 修复：上下文压缩按条数判档超限 — done（da28a33，share(count,ratio) 按角色取预算）
- [x] T4 终审 — done，verdict=pass；遗留 F1(low)：judgeCandidates 处补 GEPA 来源注释，留待后续维护提交
