# 心潮架构

## 设计目标

心潮把“语言生成”“长期记忆”和“事件驱动的动态状态”拆开。模型、记忆库与终端可以替换，驱动力、睡眠、短期窗口和交接状态由独立状态机维护；wall-clock 只描述外部现实，不承担连续心理积分。

## 数据流

```text
终端 / Agent / 自建前端
        |
        | HTTP 或 Streamable HTTP MCP
        v
 OAuth / Bearer 认证
        |
        v
  Dashboard Projection（只读、默认脱敏）
        |
        v
  心潮动态状态机 ------> state.json
    |    |    |
    |    |    +------ 窗口短态 / 限时 handoff
    |    +----------- 念头池 / 疲惫 / 驱动力
    +---------------- 可选模型 / 记忆 MCP / 通知
        |
        +------------> transitions.jsonl（无正文审计）
```

## 稳定窗口会话

MCP 初始化时，服务端返回随机 `Mcp-Session-Id`。兼容客户端在后续请求中带回该 Header，心潮便可稳定识别同一窗口。

- `session_id` 工具参数只作为显式覆盖值。
- 不同 MCP 连接拥有不同窗口 ID。
- 初始化、工具调用和协议版本协商保持无状态兼容。
- 窗口短态会过期，不影响全局驱动力。

## Context Envelope

Context Envelope 负责传输短期状态，不负责保存或压缩稳定核心资料。

默认可包含：

- 当前驱动力、疲惫与运行状态；
- 当前窗口短态；
- 最多三条限时交接便签；
- 近期梦境余韵；
- 可选外部记忆 MCP 返回的近期连续性。

同一窗口的 `session_start` 默认只交付一次，避免重复占用上下文。默认预算为 2200 tokens。

## 状态结算

`settleState` 在一次 wake 或外部事件到来时观察经过时长：

1. 经过时长只更新可观察的环境状态，例如空闲达到阈值后进入睡眠；不会自动改变 drive、念头或疲惫。
2. silence 以离散 threshold observation 记录，同一 anchor 与 threshold 只记录一次。
3. 明确互动根据事件语义应用服务端固定的有界反馈；intimacy cue 与 completed intimacy 分开处理。
4. wake 只给当前模型一次观察和行动机会，不等于必须发送消息。
5. 已完成行动产生 satisfaction，使对应 drive 回落，并通过已有 LMC candidate/Memory MCP 链路记录经验。
6. `event_id` 与稳定 `external_id` 使重试不重复 satisfaction、threshold 或经验写入。

## 外部适配器

- `ModelClient`：任意 OpenAI-compatible Chat Completions API。
- `OmbreClient`：可选的 Ombre-compatible Streamable HTTP Memory MCP。
- `BarkClient`：可选手机通知。
- `OAuthProvider`：远程 MCP 的 OAuth 2.1、PKCE 与动态客户端注册。
- `DashboardAuth`：独立访问口令换取同源 HttpOnly 只读会话。
- `Runtime Bridge Queue`：只处理用户主动互动、便签和预约，不运输 AI 内部状态。

## 可视化边界

Dashboard 不读取或返回原始 state，而是通过固定投影生成前端 DTO。投影默认只含十二维数值、运行时间、结构化念头信号、梦境元数据与能力开关；思绪正文和梦境文字不会因做了 UI 就自动暴露。

浏览器只访问 `/dashboard/api/*`，凭 HttpOnly Cookie 鉴权。服务器/CLI 可用已有 Bearer 访问 `/v1/dashboard/*`。两条路径返回同一投影，但浏览器从不持有 `SERVICE_TOKEN`。

所有适配器默认关闭。适配器失败不会替代核心状态机。

## 持久化与隐私

- `StateStore` 通过临时文件和原子替换写入 JSON。
- OAuth 客户端与 Token 摘要写入独立 `oauth.json`。
- Transition Journal 保存结构化变化，不保存聊天正文。
- Context audit 只保存 digest、交付时间和会话哈希。
- handoff 只允许近期进度摘要，并设置长度与 TTL 上限。

## 安全边界

- Bearer Token 使用固定时间比较。
- OAuth 要求 HTTPS、PKCE 和独立授权口令。
- 请求体限制为 64 KiB。
- Docker 默认仅绑定回环地址、根文件系统只读并移除 capabilities。
- 模型、记忆读写、MCP、OAuth 与通知均需分别显式启用。
