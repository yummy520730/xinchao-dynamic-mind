# P2 慢变底色、矛盾与 Snapshot 交付契约

## 审计基线与范围

2026-10-09 开工重新核对，三处 HEAD 均未偏离施工单：

| 仓库 | 实际 HEAD | 本轮处理 |
| --- | --- | --- |
| yummy520730/xinchao-dynamic-mind main | eb8d780a45a36921f7bdb7387be2f7e97ab6b885 | feat/p2-affect-snapshot，独立 Draft PR |
| yummy520730/xiaowo-app main | e509de6c8ede327cb934d63c07de557b9ebfbeee | 不修改；现有 Worker 作为本地真实链路验证对象 |
| tianyupaipai-cmd/xinchao-nian HEAD | a38a0a3241b0d3928d4a452ea1a38cf7efa14cd3 | 只参考四份指定文件的行为设计 |

主仓无适用 AGENTS.md；原 package MIT，上游根 LICENSE 为 AGPL-3.0。此次独立实现本仓数据结构、状态机、时间与入站契约，没有复制上游函数或整包、存档。未修改心跳、Murmur Writer、Life Writer、MCP 名称、12 维配置或 LMC 权威。

P0 `emotionV4.journal` 是最近 **48 次已结算语义互动后的坐标**，数量界限没有 72h 覆盖保证；marks 是独立 24h 起因痕迹（上限192，2h同词合并）。不能把 journal 或 marks 当连续三日采样。P0 入口的语义类型来自已授权运行时，而非自由文本分类；它仍不能证明模型主观体验。P2 据此展示的是 `p0_runtime_tension`，不宣称 Owner 验证了模型情绪。

## 来源、认证与写入边界

慢轴唯一实际接线：现有小窝 Owner 明确确认 → 原 Worker 校验独立 Owner bearer → 生成原有 P1.5 内容绑定 HMAC envelope → 原专用 Owner channel → 心潮独立验签/严格 schema → **同一 StateStore.update** 中独立慢轴 admission 和原 P1 reducer → 原 Snapshot。

- 沿用签名版本1、固定 issuer/audience/purpose/authorization、全部规范内容绑定、5分钟有效期；P2在排队后再次验证证明。任意改 type/object/closeness/incident/evidence 后旧签名失效。
- 不新增任何 HTTP/MCP 工具或通用写入口，未扩大 Worker 允许的类型，客户端不能传数值。
- 慢轴直接读取验签后的事实枚举；不读取 Shadow intensity/candidate/delta。不把 P1 候选升级为 drives 或 `emotionV4`。独立 P2 flag 明确授权这种**报告驱动的模型估计**，状态 `owner_report_model` 不等同真实心理测量。
- P1 flags OFF 时也可以独立 admission 到慢轴；响应仍如实 `shadow_settled=false, reason=disabled`，可选额外 `affect_settled/affect_reason` 指慢轴。未改动的 Worker 仍按原白名单转发 P1 回执，不转发这两个新诊断字段；P2结果从 Snapshot 读取，现有 Owner UI不会假称 Shadow 已结算。
- 原 P1 enabled 时，拒绝身份冲突/不支持版本/关系冲突等，不提交计算草稿到慢轴；P2账本不兼容或时钟错误也显式拒绝本次事务。允许合法 `no_change` P1结果（如初始零强度安抚）产生独立慢轴变化。
- 早于P2启用的P1 receipt（含6h内语义alias、即使后来P1关闭）重试拒绝补写慢轴，返回 `prior_settlement_no_backfill`，不做历史backfill。
- 亲疏修订只走原 `reviseCloseness`；无慢轴 replay、历史补账、P0回放。
- 抱抱前缀、presence、ACK、沉默、其他 AI 使用、聊天、玩笑/假设/角色扮演、普通 task_progress、LMC召回都不会生成慢轴输入。未接拥抱/intimacy、任务成功、挫败/自责：现有可靠 schema 不足，未增设假入口。

**生产 Owner 凭据专属持有仍 NOT_INSPECTED。** API_TOKEN bearer只能证明持有凭据；若它实际共享给模型/设备，就不得启用该可信 Owner 链路，须先单独审定 step-up 授权。沿用 P1.5 上线 blocker、私钥轮换/标识域切换约束和单进程 StateStore 约束。此次没有提交生产事件或读取生产状态/环境。

## Core Axes 规则与时间

独立 `coreAxesV4.version=1`；security静息0.62，confidence静息0.60，范围0.05–0.95，半衰期72h。不改变 drives、实时情绪标签、睡眠或主动表达。参数集中在 `CORE_AXES_POLICY`，小幅事件响应是本轮可审计初始参数。

| 验签事实类型 | 原 reason / kind | 轴 | 原始输入 |
| --- | --- | --- | --- |
| favored_hurt | explicit_ignore / explicit_slight | security | -0.025 / -0.020 |
| favored_hurt | broken_promise / preference_gap | security | -0.030 / -0.020 |
| favored_relief | active_response / reassurance | security | +0.015 / +0.025 |
| favored_relief | reconciliation / chosen / companionship | security | +0.030 / +0.025 / +0.005 |
| helped | 已报告完成的帮助行为，原严格 empathy_type | confidence | +0.020 |
| empathy / help_intent / joy 等 | 情绪或意图报告不等于行动成功 | 无 | 无增量 |

公式：`x(t)=baseline+(x(at)-baseline)*2^(-(t-at)/72h)`。事件在当前串行 admission 时加入 `delta*2^(-(admission-occurred)/72h)`，再限幅；不回写历史时刻。累积数值使用未四舍五入 double，展示保留6位，采样/无效写入频率不会改变衰减。读取惰性计算，无写入；axis anchor只在有效作用时变动。

- 未来发生时间拒绝；发生时间距 admission >24h拒绝；恰好24h允许。乱序发生时间在当前 admission 按延迟折扣，不能改旧结果；写时钟或读时钟倒退明确返回错误状态。
- 自有 domain-hash receipt 48h（恰好48h过期），对象+具体事件+类型+kind语义去重6h（恰好6h允许新的ID）；不存原人物/事件/证据ID。绑定hash覆盖原内容，receipt不能重指向。跨入口、并发与重启使用同一账本。
- 每个 admission 业务日最多24个有效作用，各轴原始**绝对输入**预算0.12；方向相反不能抵销预算，延迟折扣不能减少预算消耗。按配置时区 admission 日期计费，不历史重结算。限制/不支持事件也保留有界receipt；同ID跨午夜重试不能再拿预算。变更已使用时区拒绝 `budget_policy_changed`，需要单独迁移。
- receipt不驱逐仍有效记录，2048满时fail closed。sourceCount是累计有效作用数量（上限1e9），不是仍有效证据数量，也不是对主观心理的置信分。

## 三日心境契约

独立 `moodV4.version=1`，最多72个UTC小时桶。仅原 P0已结算互动且 `EMOTION_V4_ENABLED=true` 时记录；首次到达某小时的 post-event valence 为该小时唯一样本。之后同小时再聊不会覆盖或加权。没有定时采样、读取补样、journal回填或沉默插值，不保存正文/起因/原ID。

查询以 now 为锚，分成过去72h中的三个24h区间，使用桶起点区分边界（小时分辨率，至多一小时边缘误差）。每区间：至少12个不同小时样本，首末跨度至少12h；三个区间都满足才可用。每区间先等权平均小时样本，再三个区间等权平均。单个高频日不会压过稀疏日；不足时 `status=insufficient_data,value=null,trend=null`。

`coverage=sampledHours/72`仅表示**有事件样本的小时比例**，绝非持续情绪覆盖或三天完整生活记录。`value`为0–1 valence平均，不套用上游亮暗人格映射。trend比较最新与最旧区间均值：差绝对值<0.03是steady，其他brightening/dimming。不覆盖即时「不安」「安稳」「释然」。

## 矛盾状态机

独立 `mixedFeelingsV4.version=1`，最多一个episode及一个clearedAt，无历史列表、文本、ID或推送。`MIXED_POLICY`集中阈值：负偏离0.12，grieve≥0.30，关系驱力≥0.60，hold20min，最长6h，观察间隔上限30min。这些采用保守阈值，适合本仓0–1坐标/驱力：需要明显负向来源与较强关系牵引，不用 anger+possess 推断生气或占有。

- 只在成功结算 P0互动后观察；重复事件/interaction_id alias不再观察。普通heartbeat、Dashboard、Context、墙钟维护与P1 Shadow不构成观察。
- 最新有效24h关系起因是conflict：当前P0投影valence距0.55向下≥0.12；或最新起因是loss且当前grieve≥0.30。最新reconciliation/reassurance结束负向资格，旧冲突marks仍保留。
- possess≥0.60表示靠近倾向；否则monitor≥0.60表示牵挂，分别用 approach / concern 代码，避免把牵挂误称占有/舍不得。
- 首次双条件成立创建候选；至少两次有效事件观察跨度≥20min且间隔≤30min才confirmed。不是声称无观察区间内真实感受一直不变。只读20min后不能自动confirm。
- 确认后读取仍检查当前双条件与观察新鲜度；无效→relieved，超过30min未确认→stale，since达到6h→timed_out。睡眠没有观察时自然不再显示，不唤醒。
- 同场类型/组合切换更新代码但不重设since，不能延长6h。terminal episode锁住；只有先观察到真正低于条件，再由晚于clearedAt的新负向mark才能开新场；周期计算和换同义标签不解锁。
- 只展示短名称，绝不产生 Bark/Murmur/CC唤醒/安抚请求，未接任何主动表达器。

| 组合代码 | 展示名称 |
| --- | --- |
| unease_approach | 不安，也想靠近 |
| unease_concern | 不安，仍有牵挂 |
| loss_approach | 失落，也想靠近 |
| loss_concern | 失落，仍有牵挂 |

## Snapshot 增量字段表

顶层仍 `schemaVersion=1`。老字段及P0可选 `emotion`、P1可选 `favored/empathy`不重写。P2只增可选 `affectV4.version=1`，老客户端忽略未知字段即可；全部flags OFF时整个affectV4缺省。未修改小窝UI/类型，新字段缺省时旧/当前小窝原样。

| 路径 | 类型/语义 | gate |
| --- | --- | --- |
| affectV4.version | 1 | 任一P2开关 |
| coreAxes.status | baseline / owner_report_model / unsupported_state / invalid_state / clock_regression | CORE_AXES_V4_ENABLED |
| coreAxes.security / confidence | {value, baseline, trend: steady/above_baseline/below_baseline} | 同上，安全状态可用时 |
| coreAxes.halfLifeHours | 72 | 同上 |
| coreAxes.lastUpdatedAt | ISO或null，最近有效admission | 同上 |
| coreAxes.sourceCount | 累计有效报告作用数 | 同上 |
| mood.status | available / insufficient_data / unsupported_state / clock_regression | MOOD_V4_ENABLED |
| mood.value / trend | 0–1均值或null；steady/brightening/dimming或null | 同上 |
| mood.basis / windowHours | event_samples / 72 | 同上 |
| mood.sampledHours / coverage | 0–72 / 0–1，事件小时覆盖 | 同上 |
| mood.periods | 三个按旧→新24h区间的{sampledHours,spanHours,sufficient}；未采样可为空 | 同上 |
| mixed.active / status | bool；none/candidate/active/relieved/stale/timed_out/unsupported_state/clock_regression | MIXED_FEELINGS_V4_ENABLED |
| mixed.code / name | 仅已confirmed且当前有效时非null，固定枚举 | 同上 |
| mixed.durationMinutes | 至多360；已结束按endedAt停止累计 | 同上 |
| mixed.basis | p0_runtime_tension | 同上 |
| emotion | 原P0实时情绪、起因、marks、journal完全保留 | 原EMOTION_V4_ENABLED |

错误轴状态不输出数值，避免伪造正常底色。投影构建采用白名单；没有聊天、签名、Owner确认原文、原人物/事件/设备ID、证据引用、LMC正文或私有receipt。`DASHBOARD_INCLUDE_PRIVATE_TEXT=true`不放宽此边界。`/v1/state`也把P2容器替换为安全摘要，不能获取原私有ledger。

Dashboard、投影、纯Context构造器只读。HTTP `mode=inspect` 原先误写 delivery receipt/revision，本轮明确修正为纯读取，且不写inspect审计；**这是独立的读取语义修复，即使P2全关也生效**。实际session_start/turn投递继续原回执/审计流程；不声称所有Context请求都是只读。

## 持久化、回滚与上线前提

所有P2开关默认false：`CORE_AXES_V4_ENABLED`、`MOOD_V4_ENABLED`、`MIXED_FEELINGS_V4_ENABLED`。默认不创建任何P2容器，没有启动迁移。慢轴需要既有Owner ingress与Worker confirmations显式启用/独立服务端密钥；mood/mixed需要原EMOTION_V4_ENABLED，不隐式打开P0。P1 flags保持独立默认OFF。

关闭P2停止采样/admission且不投影，保留已有有界状态，重新开启按实际时间懒衰减，不重放历史事件。未知version拒绝/显示unsupported，不覆盖。回退原main引擎能保留未知字段，旧Snapshot忽略它们；旧版本Generic /v1/state没有P2redactor，因此**回退旧binary时应收紧该通用状态诊断边界**。不能声称旧版本会自动保留新隐私门。

enabled层沿既有唯一StateStore每分钟维护，只删过期core receipts48h/seen6h、mood桶72h；不衰减数值、不采样、不改预算或唤醒。启动也清理。关闭层不清理它的旧数据；断电/关闭过程不可能自动物理擦除，逻辑投影与输入仍按期限拒绝。Core轴数值和累计计数有界持久保留；mixed只保留末场终态/重启锁。无第二套长期记忆库、原文或无限journal；备份保留需要上线审核。

确认后才可开启：Owner bearer专属授权、单进程writer、私钥/标识轮换排空策略、时区固定、隐私诊断与备份边界，以及以下人格参数。此次没有操作任何上述生产配置。

## 验证与可重现命令

Node20.20.2 / Node22.23.3：各自完整 `npm test` **243 PASS，0 FAIL，0 SKIP**。原210项 + 新32单元/状态集成项 + 1真实HTTP测试。完整回归保留12维/P0/P1/P1.5、presence/ACK/Murmur/拥抱睡眠梦境等原测试，额外在P2开启时检查睡眠抱抱→正常对话唤醒两种觉察共存、慢轴不产生自我信号。

独立真实Worker链路：各版本 **1 PASS**，Miniflare4.20260730.0/workerd，原小窝Worker模块图 → 本地真实TLS代理 → 实际心潮子进程 → 磁盘StateStore → 通过Worker读取Snapshot。Owner错误401、内容篡改409、原文拒绝422、8并发只有1次有效作用、Shadow仍OFF均实测。签名/auth/fetch/reducer/回执均无mock。这里使用测试Owner凭据和表单fixture，不是人类真实确认或生产数据。npm全量内HTTP测试同样为真实socket+disk，包含实际停止/重启、flags关闭回滚、读取文件逐字不变。

源码与测试JS Node20/22 `--check`、`git diff --check`、运行时代码秘密/原文检查通过。仓库没有build脚本或依赖，无打包步骤可执行；全源码语法检查与真实server启动为适用的构建验证，无新增应用依赖。小窝本轮没有修改，因此无需新增其Web/Worker全量构建PR；它的实际Owner模块图在上述链路中运行。

```sh
npm test
# 单独复现真实心潮 HTTP
node --test test/http-affect-v4.test.js
# 不把Miniflare加到应用依赖：安装到独立测试目录
npm install --prefix /tmp/p2-harness miniflare@4.20260730.0
# 从本仓根运行，另一目录需为已审计小窝checkout
P2_MINIFLARE_MODULE=/tmp/p2-harness/node_modules/miniflare/dist/src/index.js \
P2_XIAOWO_ROOT=/absolute/path/to/xiaowo-app \
node --test scripts/verify-p2-worker.mjs
```

该独立harness缺参明确NOT_RUN；指定了不存在模块则报错，不改为mock/skip。正式CI沿原Node20/22矩阵跑完整npm test；不把可选本地Worker测试冒称CI已执行。CI结果见Draft PR checks。

**Browser E2E: NOT_RUN。** 本轮未修改UI，未执行浏览器自动验收；未运行部署后的Cloudflare/public TLS或核实生产Owner凭据。人工验收可在独立测试实例进行：

1. 三flag全OFF，旧/当前小窝/heart花瓣、抱抱、梦境、Owner入口不变，schema1无affectV4。
2. 仅开启测试Core与既有Owner链路，Shadow保持OFF；Owner未解锁不可提交；解锁明确确认一项安抚。检查Snapshot sourceCount只增1、security微增、12维/P0/P1 unchanged；当前小窝回执仍不会宣称Shadow作用。
3. 原提交重试/刷新/重启再重试，sourceCount/lastUpdatedAt不刷新。篡改类型/对象/亲疏/事件关联或签名拒绝。
4. 切换P0+mood/mixed测试flag，确认冲突→不安、陪伴→安稳（无更高优先级起因时）、和解→释然，marks保留冲突。少于三天覆盖时mood保持null。
5. 仅在隔离测试状态设置高关系驱力，真实P0负向事件后检查mixed候选；20min跨度的另一有效互动才确认。持续刷新不confirm；和解退出；无观察30min后stale；单场6h后锁住。不得改生产状态做此步骤。
6. 读取Dashboard/Context inspect前后比对测试文件，逐字不变；私密选项不能取得签名/ledger。睡眠中的慢轴不会唤醒，不出现P2主动推送。
7. 关闭P2后affectV4消失、旧UI保持，测试状态保留但不采样；重新开启不回放原事件。

## 修改文件与待主人验收的语义

- 新增：`src/core-axes-v4.js`、`src/mood-v4.js`、`src/mixed-feelings-v4.js`、`src/affect-v4.js`。
- 接线：`src/config.js`、`src/engine.js`、`src/dashboard-projection.js`、`src/relationship-shadow-service.js`、`src/owner-shadow-ingress.js`、`src/server.js`。
- 验证/文档：`test/affect-v4.test.js`、`test/http-affect-v4.test.js`、`scripts/verify-p2-worker.mjs`、本文件。

上游差异：不因favored/grudge持续扣安全感；不依轴修改grieve/情绪显示；不把task_progress/被夸/自责无证据推成自信；不复制emotionDays三条平均；不用anger+possess推断生气；不发Murmur/自我信号；不改Snapshot schema或移植stamen/selfSignals存档。

需要主人在上线前验收的参数/语义：72h静息回归及小幅固定输入、每日绝对预算0.12/24次、已报告帮助完成是否合适作为confidence输入、四条中性矛盾名称、20min+30min观察新鲜度、三段各12小时且跨度12h的保守mood覆盖要求。这些是模型展示参数，未认定真实人格结论。完整小窝视觉、任务/自责新可信schema、历史预算迁移、主动表达契约均留后续独立施工。

保持Draft，不合并、不部署；等待主人验收。
