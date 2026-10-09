# 心潮 4.0 P1：偏爱与共情 Shadow（Draft）

## 审计基线与范围

- 本仓最新 main：`d7b9edfe6f879d0936ee094909d507d939a23df9`，已含 #12。
- 上游参考：`tianyupaipai-cmd/xinchao-nian`，审计 commit `a38a0a3241b0d3928d4a452ea1a38cf7efa14cd3`；查看 `xinchao/src/dimensions.js`、`empathy.js`、`engine.js`、`interaction-rules.js` 及 4.0 文档。
- 原引擎 12 维、P0、presence/ACK、拥抱、睡眠、梦、LMC、主动运行时均不修改。没有新依赖、HTTP 路由、MCP 工具或后台任务。
- **当前没有可证明真实关系事件的生产者**：此 PR 交付内部服务接口和测试夹具，不连现有模型标签器、不解析聊天、不通过日常互动类型推断伤害。开启开关本身不会产生事件。

## 开关和接入

`FAVORED_SHADOW_ENABLED=false`、`EMPATHY_SHADOW_ENABLED=false` 默认关闭，各自独立；不改变 `EMOTION_V4_ENABLED`。

未来可信适配器通过 `RelationshipShadowService({ store, options, authorize, verify })` 接入：

1. `store` 必须是运行时已有的**同一个 StateStore 实例**，复用其进程内串行队列、原子 rename、fsync、0600 文件。不能为同一文件创建另一写入实例或另一进程。
2. `options` 使用 `config.relationshipShadow`。配置复用现有互动时区（默认上海）和每天 24 次 / 可配 1–96 次的有效事件数上限，但不消耗或修改旧互动账本。
3. `authorize(context)` 必须由服务端认证权限检查提供，仅准确返回 `true` 才通过；默认拒绝。
4. 严格验证字段之后，开启的类型还必须通过独立的 `verify(event, context)`，仅准确返回 `true` 才通过；默认拒绝。验证器须核对可信来源、证据关联、真实/已完成事件、对象和具体事件身份、亲疏证明，排除玩笑、反话、假设和角色扮演。它不能只认 payload 的自述。
5. 两个回调均不接受客户端函数或 `verified=true`，不能拿模型自评当证据。不要查询 LMC 私密记忆全文来填亲疏；只使用授权的结构化关联证明。
6. 通过后直接 `StateStore.update` 结算，不经过会计算 self-signal/记录外部事件的 `server.updateState`。没有通知、Murmur、心跳、唤醒、LMC 或外部分类模型调用。

此接口是进程内可信集成缝；**不是已完成的网络认证适配器**。未来开放入口必须另外审计现有认证与权限如何绑定这两个回调，不能直接暴露 reducer。

## 事件契约（v1）

只允许下表字段，额外字段（原文、姓名、数值 delta、`verified` 等）一律拒绝，不是静默截断。标识只能是 UUID 或 64 位小写十六进制摘要；同一数据源的稳定标识跨入口保持一致。

| 字段 | 契约 |
| --- | --- |
| `schema_version` | `1` |
| `event_id` | 全局稳定的事件投递标识，跨来源/入口保持相同，不拿入口给它分命名空间 |
| `event_type` | `favored_hurt` / `favored_relief` / `empathy` / `helped` |
| `occurred_at` | 完整规范 UTC ISO 时间，不接受未来时间或超过 24 小时的事件 |
| `source` | `owner_confirmation` / `trusted_adapter`；还必须通过外部可信验证器 |
| `evidence_ref` | 可审计的授权证据关联，不是证据正文 |
| `subject_ref` | 稳定对象标识，不是昵称/联系人姓名 |
| `incident_ref` | 稳定具体事件标识；同一个人不同事情必须不同；转述同一件事保持相同 |
| `reason` | 仅偏爱类型，见下表 |
| `empathy_type` | 仅共情/帮助：`care` / `injustice` / `help_intent` / `joy`；`helped` 不接受 `joy` |
| `closeness` | 仅共情/帮助：`her` / `family` / `known` / `stranger` / `unknown` |
| `relationship_ref` | 已知亲疏必须附可信关联；unknown 禁止附它，不猜关系 |

| 偏爱类型 | 可用 reason |
| --- | --- |
| 增加 | `explicit_ignore`（明确被忽略）、`explicit_slight`（明确冷落）、`broken_promise`（具体承诺落空）、`preference_gap`（具体偏爱落差） |
| 缓解 | `active_response`、`reassurance`、`reconciliation`、`chosen`、`companionship`，均须已完成且有证据 |

`conflict` 不在此契约里；沉默、手机使用、使用其他 AI、玩笑和假设均无自动映射。普通 P0/小窝拥抱互动继续走旧链路，不自动变成 P1 事件。

## 状态与候选计算

无数据/关闭时不新增状态域。首次通过验证的事件惰性创建 `favoredShadow` 或 `empathyShadow`，不改顶层 schema、revision 或旧账本。

两个域都有 `schemaVersion=1`、`policyVersion=1`、最后处理/生效时间、计数、receipt/semantic seen、当天账本、最后事件和最后候选。事件与证据/对象/事件关联均在保存前摘要化，只保存枚举、数字、时间和摘要，不保存聊天或姓名。当前不提供导出原关联的 UI。

- 偏爱：`intensity` 默认 0，上限 .55；有效伤害 +.25；完成回应/安抚等将当前值乘 .50。12 小时半衰期，在读时投影衰减、在下个有效事件时结算；纯时间流逝不写状态。`lastDelta` 记录事件变化，趋势投影区分 rising/easing/steady/decaying。
- 共情：`loads` 按对象＋具体事件＋类型摘要分账，记录类型、明确亲疏、候选目标、值和时间。独立 6 小时半衰期；读取不写，收到事件时结算。极小残余（<.000001）在事件更新时回收；最多 512 项，满时拒绝新负荷，不逐出仍有效的事件。
- `care` → 候选 `grieve`；`injustice` → `anger`；`help_intent` → `share`；`joy` → 空驱力 delta 和正向情绪候选。**所有 candidate 都不应用到 drives 或 P0 emotionV4**。
- 增量基数 .25；权重 her=1、family=.8、known=.5、stranger=.25；unknown 的权重为 null，保留状态和计数，零 delta，不假装陌生人。
- 单日总增量分档上限 .50/.40/.30/.15；上海日期边界重置（时区可复用配置）。joy 同样消费增量预算，不能无限增加正向候选；预算不足可裁剪候选。帮助不退还已使用的单日预算。
- 每个目标上：her 负荷独立上限 .75；所有非 her 的合计上限 .45，其中 stranger 合计另限 .30，unknown 不积累负荷。预算只计算 P1 账本，不读取/覆盖旧 12 维。
- `helped` 仅将**同对象、同具体事件、同类型且亲疏一致**的负荷减轻 60%；不全局清 grieve/anger/share，不清主人或别人的其他事情。缺匹配项返回 `no_matching_load`。一次帮助的重投不会再次缓解。
- 上限、半衰期等集中在 `SHADOW_POLICY` / 权重与日限额常量，尚属 Shadow 参考参数，非人格定论。

## 幂等、有界与持久化

- canonical `event_id` receipt 不受入口和 source 变化影响，保留 48 小时；输入最长只接受 24 小时旧事件，所以 receipt 过期后旧投递不能重新进入。
- 同对象＋同具体事件＋同共情类型 6 小时内去重，不把同人的其他事情合并。帮助与共情分开去重；偏爱按对象＋事件＋hurt/relief＋原因去重。
- 用不同投递 ID 转述同事件时，在 6 小时 semantic 窗内拒绝，并保留别名 receipt，防止别名后来再次结算。超过 6 小时且是新的已验证观察，允许新的 ID 结算；原 canonical ID 仍拒绝。
- 上限拒绝也保存 receipt，不允许跨日重试绕过已拒绝的同一事件。重复投递只增加 duplicate 统计，不增加候选或刷新最后有效时间。
- receipt / seen 各最多 2048，满时 `ledger_full`，**不逐出仍有效记录**。该拒绝/不支持 schema/时钟倒退不做语义结算，不纳入已有效事件统计。
- 保存 receipt、负荷、候选和统计是同一次 StateStore.update，进程内并发、重启重投均受同一去重。服务失败抛出，不返回成功。
- 使用服务端受理时间计算 decay、去重、日配额和生效时间，保留发生时间作审计。延迟队列跨午夜按受理日计。服务端时间倒退返回 `clock_regression`，不能重置配额。
- 不做跨进程锁，不绕过原 Store 的单写者约束。未知 Shadow schema/policy 返回 `unsupported_state`，不偷偷降级。

## Dashboard 与回滚

Dashboard schemaVersion 仍为 1，原字段不变。开关开启且确有验证事件时添加可选 `favored`、`empathy`：强度/趋势、分类与亲疏汇总、最后候选、最后生效时间和 applied/duplicate/limited/unknown 统计。joy/unknown 即使没有 drive load，仍可通过最后类型和候选预览。

无对象、联系人、证据关联、incident/event 摘要、原文或敏感详情。即使旧 Dashboard `includePrivateText` 开启，P1 仍只有固定汇总字段。反复读取只返回新时间投影，不回写状态。

关闭对应开关：该服务不写其域、Dashboard 隐藏字段，保留历史以便回滚。旧引擎的 clone/normalize 保留未知域，旧 drive/P0 计算不受影响。无需 DB 或一次性 schema 迁移；无需删除原状态或生产操作。

## 与上游对应及差异

上游提供偏爱半衰期/上限/满足系数、四类共情、亲疏权重、日配额、负荷上限与帮助缓解比例的参考思想。本次按本仓 StateStore 与隐私约束独立实现。

没有复制上游文件、代码函数或状态存档；上游根 LICENSE 为 AGPL-3.0，来源记录在此，不将其代码作为 MIT 文件搬入本仓。保留原 12 维，没有上游 12→11 合并，没有 favored 新驱力、关键词亲疏判定、personOf 去重、全驱力 helped、注意力吃醋、模型自由文本分类、混合情绪或慢轴。

## 验证与风险

新增 `test/http-relationship-shadow.test.js` 用真实服务证明双开关开启也不暴露 HTTP 写入路径，旧 conflict/heartbeat 不生成 P1。

新增 `test/relationship-shadow.test.js` 覆盖默认关闭、认证/证据缺失、严格输入、偏爱/衰减、16 种共情组合、unknown、跨入口/并发/重启去重、6h 边界、分档日限额、负荷上限、精确 helped、时钟倒退、容量拒绝、原驱力/P0 隔离、静默/heartbeat/LMC 读取、不擅自唤醒、睡眠拥抱与梦、Dashboard 隐私和只读、旧 schema、关闭回滚。

既有 P0 和拥抱/ACK 用例继续执行；CI 已有 Node 20/22 矩阵，此 PR 不改 workflow。实际测试结果见 PR 描述。

未修改 main 的测试曾复现梦境历史读前后 revision 相差 1；审计确定 `/health` 可响应早于异步 startup settlement 完成。仅修改该测试的 readiness helper，等到现有 `service_started` 日志后再取只读基线，不改服务启动或梦境读取逻辑。

风险：可信生产者、跨入口 canonical incident/subject 标识与证据验证器尚未接入；单写者约束依旧存在；Shadow 参考参数需要观察后再决定是否作用于真实状态。哈希标识只减少直接泄露，不是匿名化保证，状态文件继续视为私有数据。**通过 CI 不代表已具备生产入口或可直接部署。**

没有本阶段必须暂停施工的语义决策。后续接入前需要主人确认：哪些来源能证明明确冷落/真实陪伴；所有缓解统一 .50 与 empathy 的独立 6h 衰减是否符合人格；unknown 在有补充证明时怎样做显式修订（当前不在窗口内静默重分类）。

交付仅 Draft PR；不合并、不部署、不改环境变量/VPS/生产状态。
