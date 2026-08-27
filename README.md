# LLMflare

部署在 Cloudflare Workers 上的免费 LLM API 聚合网关。把 Gemini、Groq、OpenRouter、NVIDIA、Workers AI 等供应商集中到一个 Base URL，通过统一的 OpenAI / Anthropic 兼容接口调用。

Free LLM API aggregator powered by Cloudflare Workers. Run multiple providers behind one OpenAI and Anthropic compatible endpoint without hosting a local service or VPS.

`免费 AI 聚合` · `Cloudflare Workers` · `不占本机资源` · `国内网络访问` · `自定义域名` · `OpenAI / Anthropic Compatible`

## LLMflare 解决什么问题

- **聚合免费 AI 供应商**：集中管理不同平台提供的免费模型、免费额度和 API Key，部分 Provider 支持自动筛选免费模型。
- **不占用本机资源**：网关运行在 Cloudflare Workers，无需在电脑、NAS 或 VPS 上常驻进程，也不消耗本机算力和带宽处理上游请求。
- **更方便地访问国外 API**：客户端只连接自己的 Worker 或自定义域名，上游请求由 Cloudflare 网络发起；在许多国内网络环境中可以直接使用原本难以连接的国外 API，无需在客户端配置代理。
- **支持自定义域名**：可以绑定自己的域名作为统一 API 地址，也可以直接使用 Cloudflare 提供的 `*.workers.dev` 地址。
- **一个 Base URL 接入多个厂商**：统一管理 Provider、API Key 和开放模型，切换供应商时无需反复修改客户端地址。
- **兼容常用协议**：支持 OpenAI Chat Completions、Responses 与 Anthropic Messages。
- **原样流式转发**：上游流式响应直接传给客户端，并在旁路记录首字延迟、TPS 和 Token。
- **模型白名单**：只向客户端暴露已勾选的模型，部分 Provider 支持只看免费模型。
- **隐私优先**：不保存 Prompt 和模型回复；统计只记录模型、Token、耗时和状态等元数据。

> [!WARNING]
> LLMflare 也可以接入按量计费或充值余额的 API 服务，但更建议只添加免费 API 或单独申请的低额度 Key。Provider Key 需要保存在部署者自己的 Cloudflare KV 中；若管理凭据、客户端密钥或部署环境泄露，攻击者可能消耗付费额度并造成财产损失。请勿使用绑定高额余额或无限制付款方式的生产 Key。

![LLMflare 管理台总览](docs/images/dashboard.png)

![Provider 免费模型筛选与白名单](docs/images/model-selection.png)

> 截图使用演示数据，不包含真实 API Key、域名配置或个人用量。

## 3 分钟快速开始

需要 Node.js 20+、Cloudflare 账号，以及至少一个 AI Provider 的 API Key。建议先使用带免费额度的 Provider 完成部署和测试。

```bash
git clone https://github.com/Jiao77/LLMflare.git
cd LLMflare
npm install
npx wrangler login
cp wrangler.example.jsonc wrangler.jsonc
npx wrangler kv namespace create CONFIG
npx wrangler d1 create llmflare-usage
```

Windows PowerShell 请将复制命令改为：

```powershell
Copy-Item wrangler.example.jsonc wrangler.jsonc
```

把命令输出的 KV、D1 ID 填入 `wrangler.jsonc`，然后执行：

```bash
npx wrangler d1 migrations apply llmflare-usage --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

打开 Worker 地址，用 `ADMIN_TOKEN` 登录后台并添加 Provider。完整部署、安全配置和自定义域名说明见下方。

## 兼容接口

| 接口 | 协议 | 流式传输 |
| --- | --- | --- |
| `POST /v1/chat/completions` | OpenAI Chat Completions | 支持 |
| `POST /v1/responses` | OpenAI Responses | 支持 |
| `POST /v1/messages` | Anthropic Messages | 支持 |
| `GET /v1/models` | OpenAI Models | — |

客户端使用后台生成的访问密钥：

```http
Authorization: Bearer llmf_your_client_key
```

模型名使用 `供应商名称/上游模型 ID`，例如：

```json
{
  "model": "Groq/openai/gpt-oss-20b",
  "messages": [{ "role": "user", "content": "你好" }],
  "stream": true
}
```

## 支持的 Provider

| Provider | 自动获取模型 | 免费模型筛选 | 备注 |
| --- | ---: | ---: | --- |
| Google AI Studio | ✓ | — | Gemini API |
| Groq | ✓ | — | OpenAI-compatible |
| OpenRouter | ✓ | ✓ | 按价格信息识别免费模型 |
| NVIDIA NIM | ✓ | ✓ | OpenAI-compatible |
| Cloudflare Workers AI | ✓ | — | 支持 REST API Token + Account ID，也支持原生 AI Binding |
| SiliconFlow | ✓ | ✓ | OpenAI-compatible |
| 智谱 BigModel | ✓ | ✓ | OpenAI-compatible |
| Mistral | ✓ | ✓ | OpenAI-compatible |
| 自定义 OpenAI-compatible | 视上游而定 | — | 可配置 Base URL |

免费模型筛选依赖各平台模型目录返回的价格、标签或命名信息；平台规则变化时，识别结果也可能变化。是否免费及额度大小始终以上游官方说明为准。项目允许添加收费 API，但出于密钥泄露和意外扣费风险，更建议仅接入免费服务或设置了严格额度限制的专用 Key。

## 管理后台

- 新增、编辑和删除 Provider
- 修改显示名称、API Key、Base URL 与 Account ID
- 自动获取模型并按分组筛选
- 勾选允许通过网关访问的模型
- 生成、自定义、禁用和删除客户端访问密钥
- 在线测试兼容接口
- 按 Provider 和模型查看 Token、请求数、成功率、首字延迟与 TPS

## 完整部署配置

### 1. 创建资源

```bash
npx wrangler kv namespace create CONFIG
npx wrangler d1 create llmflare-usage
```

### 2. 配置 `wrangler.jsonc`

从 `wrangler.example.jsonc` 复制一份配置，将资源 ID 替换为自己的值：

```jsonc
{
  "name": "llmflare",
  "main": "src/index.ts",
  "compatibility_date": "2026-08-25",
  "kv_namespaces": [
    { "binding": "CONFIG", "id": "YOUR_KV_NAMESPACE_ID" }
  ],
  "d1_databases": [
    {
      "binding": "USAGE",
      "database_name": "llmflare-usage",
      "database_id": "YOUR_D1_DATABASE_ID"
    }
  ]
}
```

如果需要 Workers AI 原生 Binding，可再加入：

```jsonc
"ai": { "binding": "AI" }
```

### 3. 初始化并部署

```bash
npx wrangler d1 migrations apply llmflare-usage --remote
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

`ADMIN_TOKEN` 是后台管理员凭据。不要提交到 Git、写进前端代码，或与客户端访问密钥混用。

### 4. 绑定域名（可选）

不配置域名也可以直接使用 `*.workers.dev` 地址。自定义域名可在 Cloudflare Dashboard 的 Worker **Settings → Domains & Routes** 中添加。

## 数据与安全

- Provider API Key 保存在你自己的 Cloudflare KV 中。
- 客户端访问密钥仅保存哈希，后台不会再次展示完整值。
- Prompt、模型回复与流式内容不会写入统计数据库。
- 用量记录只包含 Provider、模型、Token、状态码、耗时、首字延迟和 TPS 等元数据。
- 建议限制后台访问、定期轮换 `ADMIN_TOKEN`，并为公开部署配置 Cloudflare Access 或 WAF 规则。
- 如果接入收费 Provider，请使用独立、低额度、可随时撤销的 API Key，并在上游设置消费上限和告警；不要将绑定高额余额的主 Key 放入公开网关。

## FAQ / Limitations

### 国内访问国外 API 是否一定不需要代理？

客户端只连接 Cloudflare Worker 或自定义域名，上游请求由 Cloudflare 网络发起，因此在许多国内网络环境中可以直接使用国外 API，无需在客户端配置代理。但实际可用性仍受 Cloudflare 域名与线路、所在地区网络、政策及上游平台限制影响，项目无法保证所有地区和运营商始终可直连。

### 无服务器是否等于不会中断？

不是。Workers 避免了自有 VPS 的硬件、系统和单机网络故障，但仍受 Cloudflare、上游 Provider、配额和区域网络状态影响。

### 免费模型是否无限使用？

不是。免费模型仍可能有每分钟请求数、Token、并发、每日额度或共享容量限制。网关不会绕过上游限流。

### 为什么没有 OpenCode Zen Provider？

OpenCode Zen 的免费额度可能与官方客户端、请求来源或反滥用策略关联。同一 API Key 从官方节点可用，但经第三方 Worker 转发时可能返回 `FreeUsageLimitError`。为避免把不稳定能力包装成可靠功能，当前不提供该预设；若上游规则变得明确，可使用自定义 OpenAI-compatible Provider 测试。

### 为什么部分流式请求的 Token 是估算值？

只有上游返回 `usage` 时才能取得精确 Token。上游未返回时，网关会在不阻塞数据转发的前提下旁路估算，因此统计值适合观察趋势，不应作为账单依据。

## 项目地址

- GitHub: https://github.com/Jiao77/LLMflare
- Gitea: https://gitea.jiao77.com/Jiao77/llmflare
