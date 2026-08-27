# Edge Provider

部署在 Cloudflare Workers 的私人 LLM API 网关，聚合 Google AI Studio、Groq、OpenRouter、NVIDIA、Workers AI 与任意 OpenAI-compatible 服务。

## 主要优点

- **免服务器**：无需购买 VPS、维护操作系统、开放端口或常驻进程。网关运行在 Cloudflare 边缘网络，避免自建单机因硬盘、电源、家庭宽带、机房网络或意外重启造成的服务中断。
- **可以不准备域名**：启用 Cloudflare 提供的 `*.workers.dev` 地址后即可使用，不必先购买和配置域名。
- **也支持自定义域名**：可以将自己的域名绑定为 Worker Custom Domain，获得更容易记忆和控制的固定入口。对于 `workers.dev` 访问不稳定的网络环境，建议使用自己的域名。
- **客户端不必直连国外 AI API**：请求先发送到这个网关，再由 Cloudflare Worker 连接 Google、Groq、NVIDIA 等上游服务。只要客户端所在网络能够正常访问你的 Worker 地址，通常就不需要再单独直连那些可能需要代理才能访问的 API 域名。
- **减少单点硬件故障**：Serverless 并非“世界上没有服务器”，而是无需维护属于自己的单台服务器。Cloudflare 负责运行环境和边缘调度，因此比个人电脑、家庭设备或单台 VPS 更少受到物理设备故障影响。

需要注意：它不能保证绝对不中断。Cloudflare 或上游 AI 服务故障、账号额度耗尽、API 限流、DNS 问题和本地网络无法访问 Worker 域名时，网关仍可能不可用；实际网络可达性也因地区、运营商和域名配置而异。

## 接口

- `POST /v1/chat/completions`
- `POST /v1/responses`（上游原生支持时直接转发，否则通过 Chat Completions 逐事件流式转换）
- `POST /v1/messages`（Anthropic Messages 风格转换，同时提供 `/v1/message` 别名）
- `GET /v1/models`

请求使用管理台生成的客户端密钥：`Authorization: Bearer sk-llm-...`。模型推荐写为 `提供商名称/真实模型-ID`，例如 `Groq/openai/gpt-oss-20b`；也可直接使用已登记模型名，未匹配时使用第一个启用的提供商。

三个兼容接口均支持 `stream=true`。同协议响应直接透传；Messages 与缺少原生 Responses 接口的提供商通过单跳 SSE 适配器逐事件转换，不会等待完整回答。转换支持文本、函数工具调用、结束原因和 usage；客户端取消请求时会继续向上游传播取消信号。

## 初次部署

1. 安装依赖：`npm install`
2. 登录：`npx wrangler login`
3. 复制部署模板：`Copy-Item wrangler.example.jsonc wrangler.jsonc`（Windows）或 `cp wrangler.example.jsonc wrangler.jsonc`。
4. 创建 KV：`npx wrangler kv namespace create CONFIG`。
5. 创建用量数据库：`npx wrangler d1 create edge-provider-usage`。
6. 将输出的 namespace/database ID 写入本地 `wrangler.jsonc`，再执行 `npx wrangler d1 migrations apply edge-provider-usage --remote`。
7. 域名配置任选其一：启用默认的 `*.workers.dev` 地址，或在本地 `wrangler.jsonc` 增加 Custom Domain route 绑定自定义域名。
8. 设置管理员密钥：`npx wrangler secret put ADMIN_TOKEN`。
9. 校验：`npm run check`。
10. 部署：`npm run deploy`。

真实 `wrangler.jsonc`、`.dev.vars`、本地缓存和测试截图均被 Git 忽略。不要把资源 ID、自定义域名或密钥写入 `wrangler.example.jsonc`。

本地开发时复制 `.dev.vars.example` 为 `.dev.vars` 并设置管理员密钥，然后运行 `npm run dev`。Workers AI 始终使用远程推理资源。

## 提供商填写示例

- Google：类型 `google`，填 AI Studio key，模型如 `gemini-2.5-flash`。
- Groq：类型 `groq`，填 Groq key，模型如 `llama-3.3-70b-versatile`。
- NVIDIA：类型 `nvidia`，填写 build.nvidia.com 生成的 API Key；默认连接 `https://integrate.api.nvidia.com/v1`，支持自动读取 `/models` 和 Chat Completions。
- OpenRouter：类型 `openrouter`，填写 OpenRouter API Key；模型发现会根据官方定价字段自动区分免费与非免费模型，并在模型选择器中分组或仅显示免费模型。
- Workers AI：类型 `workers-ai`，无需 key，模型如 `@cf/meta/llama-3.1-8b-instruct`。
- 自定义：类型 `openai-compatible`，填写以 `/v1` 结尾的 Base URL 和 API key。

管理台支持在保存前“自动获取模型”，也可对已保存的提供商点击“刷新模型”。Google 使用 Gemini Models API，Groq 与自定义提供商使用 OpenAI-compatible `/models`。

每个提供商都可以在“选择模型”中单独勾选对外开放的模型。只有已勾选项会出现在 `GET /v1/models`，网关也会拒绝直接调用未勾选模型。旧配置在第一次保存选择前保持全部模型启用；保存过选择后，刷新目录只保留原有勾选，新发现模型不会自动开放。

Workers AI 的运行时 binding 本身不提供目录枚举。网关只复用该 Workers AI 提供商中填写的 REST API Token 与 Account ID，同时用于实时模型发现与 REST 推理；没有提供商 REST 凭据或实时调用失败时，回退到最近一次部署时由 Wrangler 同步的 Text Generation 模型快照。项目不创建全局 `CF_ACCOUNT_ID` 或第二套 Cloudflare Token。没有 REST 凭据时，实际推理通过 Worker 的原生 `AI` binding 完成。

## 为什么没有 OpenCode Zen 选项

OpenCode Zen 的 `hy3-free`、`mimo-v2.5-free` 等匿名免费模型由上游按来源 IP 计算每日额度，即使请求携带有效 Zen API Key，也仍先经过 IP 限流。`opencode.ai` 同样位于 Cloudflare；从本项目的 Worker 跨 Zone 请求 Zen 时，Cloudflare 会使用统一的 Worker 客户端 IP，而不是终端用户的直连 IP。结果是大量 Worker 请求共享同一个上游免费额度桶，可能在个人尚未使用时直接收到 `429 FreeUsageLimitError`。

客户端直连 Zen 正常而经 Worker 失败，正是两条链路在上游使用不同来源 IP 的结果。伪造 `User-Agent`、添加 `x-opencode-*` 请求头、传递客户端 IP 或更换同一把 API Key 都不能可靠改变这条限流路径。Cloudflare 的专用出口 IP 属于企业附加能力，也只会把共享出口换成固定出口，不能让 Zen 按每个终端用户独立计量。因此管理台不再提供 OpenCode Zen 作为内置供应商。

如需使用 OpenCode 免费模型，请直接连接 OpenCode Zen：

1. 启动 OpenCode，在 TUI 输入 `/connect`。
2. 选择 `OpenCode Zen`，按提示打开 `opencode.ai/auth`，登录、完成账户设置并复制 API Key，然后粘贴回 TUI。
3. 输入 `/models`，选择名称带 `Free` 的型号。当前常见例子包括 `mimo-v2.5-free`、`hy3-free`、`nemotron-3-ultra-free`、`nemotron-3.5-lightning-free` 与 `big-pickle`；实际列表以 `/models` 当时显示为准。
4. 如需设为项目默认模型，在 `opencode.json` 中填写：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/mimo-v2.5-free"
}
```

免费模型可能有速率、并发、活动期限或账户条件限制；“免费”表示模型 Token 单价为零，不等于无条件、无限量或永久可用。

注意：KV 适合这类低频个人配置，但不是事务数据库。提供商 key 在 KV 中以明文配置值保存（Cloudflare 侧静态加密），管理 API 永不返回它；如需更高等级的密钥隔离，可改用 Secrets Store bindings。

## 用量分析

管理台按 1、7、30、90 天查看请求数、成功率、响应时间、Token、提供商和模型排行。用量事件保存在独立 D1 数据库，只包含时间、客户端密钥 ID、接口、提供商、模型、状态码、延迟和 Token 数；不会保存提示词、回复正文、客户端密钥或提供商 API Key。

Token 统计采用旁路流包装：响应数据块遵守背压并原样转发，统计不会等待 D1 写入后才发送正文。已明确支持该参数的 Google 与 Groq 流式 Chat 请求会自动附加 `stream_options.include_usage=true`；其他提供商会解析其主动返回的 usage。上游返回 usage 时记为“精确”，否则根据请求结构与增量输出做不保存正文的“估算”。每条记录还包含首个内容块等待、完整耗时、输出 TPS、流式标记与是否完整结束。
