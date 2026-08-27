# Edge Provider 宣传素材

本文档用于发布前审阅。下面的帖子尚未代替仓库所有者公开发布。

## 仓库信息

**Description**

> Self-hosted LLM API gateway on Cloudflare Workers. OpenAI & Anthropic compatible proxy for Gemini, Groq, OpenRouter, NVIDIA and Workers AI.

**Topics**

`llm-gateway` `cloudflare-workers` `openai-api` `anthropic-api` `openai-proxy` `gemini` `groq` `openrouter` `workers-ai`

## Linux.do

### 标题

我用 Cloudflare Workers 做了一个无需 VPS 的多模型 LLM API 网关

### 正文

最近把自己日常使用的几个 LLM API 整合成了一个 Cloudflare Worker：**Edge Provider**。

它主要解决一个很实际的问题：Gemini、Groq、OpenRouter、NVIDIA 和 Workers AI 各有各的地址、密钥和模型名，客户端配置多了以后很难维护。现在可以用一个 Base URL 管理多个 Provider，并把它们统一成常见的接口：

- OpenAI Chat Completions
- OpenAI Responses
- Anthropic Messages
- 流式传输

项目不需要 VPS，直接部署到 Cloudflare Workers；域名可选，也可以绑定自己的域名。后台可以编辑 Provider 和 API Key、自动获取模型、设置模型白名单、生成客户端访问密钥，并查看 Token、TPS 和首字延迟等用量数据。

隐私方面，不保存 Prompt 和模型回复，只记录 Provider、模型、Token、耗时、状态码等统计元数据。Provider Key 保存在部署者自己的 Cloudflare KV 中。

需要说明的是：无服务器不代表绝对不会中断，免费模型也不代表无限额度。服务仍然受 Cloudflare、上游平台配额和地区网络影响。

GitHub：<https://github.com/Jiao77/Edge-Provider>

Gitea：<https://gitea.jiao77.com/Jiao77/edge-provider>

欢迎试用、提 Issue，也欢迎反馈不同客户端的兼容情况。

## V2EX

### 标题

用 Cloudflare Workers 做了一个无需 VPS 的多模型 LLM API 网关

### 正文

我平时会同时用 Gemini、Groq、OpenRouter、NVIDIA 和 Workers AI，但很多客户端需要重复维护 Base URL、Key 和模型列表，所以做了一个自用为主的开源网关 Edge Provider。

它运行在 Cloudflare Workers 上，不需要单独准备 VPS。后台负责管理 Provider、API Key 和模型白名单，客户端只需要一个 Base URL 和访问密钥。目前兼容 OpenAI Chat Completions、Responses、Anthropic Messages 以及流式响应。

另外加了一些实际使用中比较需要的功能：自动获取模型、部分平台的免费模型筛选、Provider 编辑、客户端密钥管理，以及 Token / TPS / 首字延迟统计。统计不会保存 Prompt 和回复正文。

项目地址：<https://github.com/Jiao77/Edge-Provider>

如果你也在多个桌面客户端或脚本里混用不同 Provider，想听听这种统一网关还缺什么，尤其欢迎反馈协议兼容和流式转发方面的问题。

## Reddit r/selfhosted

### Title

I built a multi-provider LLM API gateway on Cloudflare Workers — no VPS required

### Post

I built **Edge Provider**, a small self-hosted gateway for people who use several LLM APIs and do not want to maintain a separate base URL and key in every client.

It runs on Cloudflare Workers and currently supports Gemini, Groq, OpenRouter, NVIDIA, Workers AI, and custom OpenAI-compatible providers through one endpoint.

Main features:

- OpenAI Chat Completions and Responses compatibility
- Anthropic Messages compatibility
- pass-through streaming
- provider and API key management
- model discovery and per-provider model allowlists
- free-model filters for supported catalogs
- client access keys
- usage, token, TTFT, and TPS analytics
- no prompt or response body storage

It does not require a VPS, and a custom domain is optional. Provider credentials stay in your own Cloudflare KV. The usual caveats still apply: serverless does not mean zero downtime, and free upstream models still have their own rate and quota limits.

GitHub: <https://github.com/Jiao77/Edge-Provider>

Feedback on client compatibility and streaming behavior is welcome.

## 配图

- `docs/images/dashboard.png`：管理后台总览，使用模拟数据。
- `docs/images/model-selection.png`：Provider 模型选择与免费模型筛选，使用模拟数据。

