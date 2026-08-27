const $ = (selector) => document.querySelector(selector);
const tokenKey = "llm-admin-token";
let adminToken = sessionStorage.getItem(tokenKey) || "";
let providersCache = [];
let keysCache = [];
let modelCatalog = [];
let modelSelection = new Set();
let modelFreeModels = new Set();
let draftFreeModels = new Set();
const usagePaging = { models: { page: 1, pageSize: 10 }, logs: { page: 1, pageSize: 10 } };
let usageRequestSequence = 0;
const api = async (path, options = {}) => {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}`, ...(options.headers || {}) } });
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error?.message || `HTTP ${response.status}`); }
  return response.status === 204 ? null : response.json();
};
const notify = (message, kind = "ok") => { const el = $("#status"); el.textContent = message; el.dataset.kind = kind; el.dataset.show = "true"; clearTimeout(notify.timer); notify.timer = setTimeout(() => { el.dataset.show = "false"; }, 3200); };
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const formatNumber = (value) => new Intl.NumberFormat("zh-CN", { notation: Number(value) >= 100000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(Number(value) || 0);
const formatDuration = (value) => value == null ? "—" : Number(value) < 1000 ? `${Math.round(Number(value))} ms` : `${(Number(value) / 1000).toFixed(2)} s`;
const niceTokenAxisMax = (value) => { const max = Math.max(1, Number(value)); const magnitude = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / magnitude) * magnitude; };
const load = async () => { try { await api("/admin/session"); $("#loginPanel").hidden = true; $("#workspace").hidden = false; await Promise.all([loadProviders(), loadKeys(), loadUsage()]); } catch { $("#loginPanel").hidden = false; $("#workspace").hidden = true; } };
async function loadProviders() {
  const { data } = await api("/admin/providers");
  providersCache = data;
  $("#providerList").innerHTML = data.length ? data.map((p) => {
    const enabledModels = p.enabledModels ?? p.models;
    return `<article class="provider-row"><div><h3>${escapeHtml(p.name)}</h3><p class="meta">${escapeHtml(p.id)}</p></div><div><span class="badge">${escapeHtml(p.type)}</span><p class="meta">${p.models.length ? `${enabledModels.length}/${p.models.length} 个模型已启用 · ${enabledModels.slice(0, 4).map(escapeHtml).join(" · ")}${enabledModels.length > 4 ? " …" : ""}` : "尚未登记模型"} · ${p.hasApiKey ? "密钥已存" : p.type === "workers-ai" ? "Binding" : "缺少密钥"}</p></div><div class="row-actions"><button data-edit-provider="${p.id}">编辑</button><button data-model-provider="${p.id}" ${p.models.length ? "" : "disabled"}>选择模型</button><button data-discover-provider="${p.id}">刷新模型</button><button data-delete-provider="${p.id}">删除</button></div></article>`;
  }).join("") : '<p class="empty">版面为空。添加第一个提供商后即可开始路由。</p>';
  renderTestModelOptions();
}
async function loadKeys() {
  const { data } = await api("/admin/keys");
  keysCache = data;
  $("#keyList").innerHTML = data.length ? data.map((k) => {
    const limits = [
      k.requestsPerMinute ? `${k.requestsPerMinute} RPM` : "",
      k.dailyRequestLimit ? `24 小时 ${formatNumber(k.dailyRequestLimit)} 次` : "",
      k.monthlyTokenLimit ? `月度 ${formatNumber(k.monthlyTokenLimit)} Token` : "",
      k.maxOutputTokensPerRequest ? `单次输出 ${formatNumber(k.maxOutputTokensPerRequest)} Token` : "",
    ].filter(Boolean).join(" · ") || "未设置用量限制";
    return `<article class="key-row"><div><h3>${escapeHtml(k.name)} <span class="badge">${k.enabled ? "启用" : "停用"}</span></h3><p class="meta">${escapeHtml(k.prefix)}</p></div><p class="meta">${limits}<br>发行于 ${new Date(k.createdAt).toLocaleString("zh-CN")}</p><div class="row-actions"><button data-edit-key="${k.id}">限额</button><button data-toggle-key="${k.id}">${k.enabled ? "停用" : "启用"}</button><button data-delete-key="${k.id}">吊销</button></div></article>`;
  }).join("") : '<p class="empty">还没有客户端密钥。生成后，明文只会出现一次。</p>';
}
async function loadUsage() {
  const requestSequence = ++usageRequestSequence;
  const params = new URLSearchParams({
    days: $("#usageRange").value,
    modelPage: String(usagePaging.models.page),
    modelPageSize: String(usagePaging.models.pageSize),
    logPage: String(usagePaging.logs.page),
    logPageSize: String(usagePaging.logs.pageSize),
  });
  const data = await api(`/admin/usage?${params}`);
  if (requestSequence !== usageRequestSequence) return;
  const summary = data.summary;
  $("#usageRequests").textContent = formatNumber(summary.requests);
  $("#usageTokens").textContent = formatNumber(summary.totalTokens);
  $("#usageSuccess").textContent = `${summary.successRate}%`;
  $("#usageFirstToken").textContent = formatDuration(summary.avgFirstTokenMs);
  $("#usageTps").textContent = summary.avgOutputTps ? `${Number(summary.avgOutputTps).toFixed(1)} tok/s` : "—";
  $("#usageDuration").textContent = formatDuration(summary.avgDurationMs);
  $("#usageCoverage").textContent = summary.requests
    ? `${summary.meteredRequests}/${summary.requests} 次请求已有 Token，其中 ${summary.exactRequests} 次为上游精确值，其余为不保存正文的即时估算。`
    : "统计从本功能上线后开始；不会保存提示词、回复正文或密钥。";
  const providers = [...new Map(data.dailyProviders.map((item) => [item.provider_id, { id: item.provider_id, name: item.provider_name }])).values()];
  const providerPatterns = new Map(providers.map((provider, index) => [provider.id, index % 6]));
  $("#usageLegend").innerHTML = `${providers.map((provider) => `<span><i data-pattern="${providerPatterns.get(provider.id)}"></i>${escapeHtml(provider.name)}</span>`).join("")}<span class="request-key"><i class="request-key__mark"></i>请求数</span>`;
  const days = [...new Set(data.dailyProviders.map((item) => item.day))];
  const values = new Map(data.dailyProviders.map((item) => [`${item.day}\u0000${item.provider_id}`, item]));
  const tokenAxisMax = niceTokenAxisMax(Math.max(1, ...data.dailyProviders.map((item) => Number(item.output_tokens))));
  const requestAxisMax = Math.max(4, Math.ceil(Math.max(1, ...data.dailyProviders.map((item) => Number(item.requests))) / 4) * 4);
  const ratios = [1, .75, .5, .25, 0];
  const tokenTicks = ratios.map((ratio) => Math.round(tokenAxisMax * ratio));
  const requestTicks = ratios.map((ratio) => Math.round(requestAxisMax * ratio));
  const axis = (ticks, side) => `<div class="chart-axis-name chart-axis-name--${side}">${side === "left" ? "输出 Token" : "请求"}</div><div class="chart-axis chart-axis--${side}" aria-hidden="true">${ticks.map((tick, index) => `<span style="--tick-position:${index * 25}%">${formatNumber(tick)}</span>`).join("")}</div>`;
  $("#usageChart").innerHTML = days.length ? `${axis(tokenTicks, "left")}<div class="chart-plot">${days.map((day) => `<div class="chart-day"><div class="chart-bars">${providers.map((provider) => {
    const item = values.get(`${day}\u0000${provider.id}`);
    const tokens = Number(item?.output_tokens || 0);
    const requests = Number(item?.requests || 0);
    const tokenHeight = tokens ? Math.max(2, (tokens / tokenAxisMax) * 100) : 0;
    const requestBottom = Math.min(98, (requests / requestAxisMax) * 100);
    return `<span class="chart-series"><i class="chart-bar" data-pattern="${providerPatterns.get(provider.id)}" style="--bar-height:${tokenHeight}%" title="${escapeHtml(provider.name)} · ${escapeHtml(day)}：${formatNumber(tokens)} 输出 Token"><span>${escapeHtml(provider.name)}：${formatNumber(tokens)} 输出 Token</span></i>${item ? `<b class="chart-request-point" style="--request-bottom:${requestBottom}%" title="${escapeHtml(provider.name)} · ${escapeHtml(day)}：${formatNumber(requests)} 次请求"><span>${escapeHtml(provider.name)}：${formatNumber(requests)} 次请求</span></b>` : ""}</span>`;
  }).join("")}</div><small>${escapeHtml(day.slice(5))}</small></div>`).join("")}</div>${axis(requestTicks, "right")}` : '<p class="empty">这个周期还没有用量记录。</p>';
  const providerRows = (items) => items.length ? items.map((item) => `<tr><th>${escapeHtml(item.name)}</th><td>${formatNumber(item.requests)}</td><td>${formatNumber(item.total_tokens)}</td><td>${formatNumber(item.errors)}</td></tr>`).join("") : '<tr><td colspan="4" class="empty">暂无数据</td></tr>';
  $("#usageProviders").innerHTML = providerRows(data.providers);
  $("#usageModels").innerHTML = data.models.length ? data.models.map((item) => `<tr><th>${escapeHtml(item.provider_name)} / ${escapeHtml(item.name)}</th><td>${formatNumber(item.requests)}</td><td>${formatNumber(item.input_tokens)}</td><td>${formatNumber(item.output_tokens)}</td><td>${formatNumber(item.total_tokens)}</td><td>${item.avg_output_tps == null ? "—" : `${Number(item.avg_output_tps).toFixed(1)} tok/s`}</td><td>${formatDuration(item.avg_first_token_ms)}</td><td>${formatDuration(item.avg_duration_ms)}</td><td>${formatNumber(item.errors)}</td></tr>`).join("") : '<tr><td colspan="9" class="empty">暂无数据</td></tr>';
  $("#usageLogs").innerHTML = data.logs.length ? data.logs.map((item) => {
    const source = item.usage_source === "exact" ? "精确" : item.usage_source === "mixed" ? "混合" : item.usage_source === "estimated" ? "估算" : "无";
    const status = `${item.status}${Number(item.completed) ? "" : " · 中断"}`;
    return `<tr><th><time>${new Date(Number(item.created_at)).toLocaleString("zh-CN")}</time><small>${escapeHtml(item.provider_name)} · ${escapeHtml(item.model)}</small></th><td>${formatNumber(item.input_tokens)} / ${formatNumber(item.output_tokens)} / ${formatNumber(item.total_tokens)}</td><td>${formatDuration(item.first_token_ms)}</td><td>${formatDuration(item.duration_ms)}</td><td>${item.output_tps == null ? "—" : Number(item.output_tps).toFixed(1)}</td><td><span class="usage-source" data-source="${escapeHtml(item.usage_source)}">${source}</span></td><td>${escapeHtml(status)}</td></tr>`;
  }).join("") : '<tr><td colspan="7" class="empty">暂无请求记录</td></tr>';
  renderPagination("model", data.pagination.models, usagePaging.models);
  renderPagination("log", data.pagination.logs, usagePaging.logs);
  $("#usageUpdatedAt").textContent = `更新于 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}
function renderPagination(prefix, pagination, state) {
  const totalPages = Math.max(1, Math.ceil(Number(pagination.total) / Number(pagination.pageSize)));
  $(`#${prefix}PageInfo`).textContent = `${formatNumber(pagination.total)} 条 · 第 ${pagination.page} / ${totalPages} 页`;
  $(`#${prefix}Prev`).disabled = pagination.page <= 1;
  $(`#${prefix}Next`).disabled = pagination.page >= totalPages;
  state.page = Number(pagination.page);
  state.pageSize = Number(pagination.pageSize);
}
async function refreshUsage(button) {
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const label = button.textContent;
  button.textContent = "刷新中…";
  try { await loadUsage(); }
  catch (error) { notify(error.message, "error"); }
  finally { button.disabled = false; button.removeAttribute("aria-busy"); button.textContent = label; }
}
function updateModelSelectionCount() {
  $("#modelSelectionCount").textContent = `${modelSelection.size}/${modelCatalog.length} 已启用 · 当前显示 ${visibleModelCatalog().length}`;
}
function renderTestModelOptions() {
  const select = $("#testModel");
  const previous = select.value;
  const fragment = document.createDocumentFragment();
  const availableValues = new Set();
  let optionCount = 0;
  for (const provider of providersCache.filter((item) => item.enabled !== false)) {
    const enabledModels = provider.enabledModels ?? provider.models ?? [];
    if (!enabledModels.length) continue;
    const group = document.createElement("optgroup");
    group.label = provider.name;
    for (const model of enabledModels) {
      const publicModelId = `${provider.name}/${model}`;
      const option = document.createElement("option");
      option.value = publicModelId;
      option.textContent = `${provider.name} / ${model}`;
      group.append(option);
      availableValues.add(publicModelId);
      optionCount += 1;
    }
    fragment.append(group);
  }
  if (!optionCount) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无已启用模型";
    fragment.append(option);
  }
  select.replaceChildren(fragment);
  select.disabled = optionCount === 0;
  if (availableValues.has(previous)) select.value = previous;
}
const isOpenRouterFreeModelId = (model) => model === "openrouter/free" || model.endsWith(":free");
const supportsFreeModelGroups = (type) => ["openrouter", "siliconflow", "zhipu"].includes(type);
const isProviderFreeModelId = (type, model) => type === "openrouter" && isOpenRouterFreeModelId(model);
const freeGroupLabels = () => ["免费模型", "非免费模型"];
function visibleModelCatalog() {
  const query = $("#modelSearch").value.trim().toLowerCase();
  const onlyFree = !$("#freeModelsFilter").hidden && $("#onlyFreeModels").checked;
  return modelCatalog.filter((model) => model.toLowerCase().includes(query) && (!onlyFree || modelFreeModels.has(model)));
}
function modelChoice(model, free) {
  const priceLabel = free === undefined ? "" : `<small>${free ? "免费" : "非免费"}</small>`;
  return `<label class="model-choice"><input type="checkbox" value="${escapeHtml(model)}" ${modelSelection.has(model) ? "checked" : ""}><span class="model-choice__label"><span>${escapeHtml(model)}</span>${priceLabel}</span></label>`;
}
function renderModelChoices() {
  const visible = visibleModelCatalog();
  const supportsFreeGroups = supportsFreeModelGroups($("#modelDialog").dataset.providerType);
  if (!visible.length) $("#modelChoices").innerHTML = '<p class="empty">没有符合当前条件的模型。</p>';
  else if (!supportsFreeGroups) $("#modelChoices").innerHTML = visible.map((model) => modelChoice(model)).join("");
  else {
    const [freeLabel, paidLabel] = freeGroupLabels($("#modelDialog").dataset.providerType);
    const groups = [
      [freeLabel, visible.filter((model) => modelFreeModels.has(model)), true],
      [paidLabel, visible.filter((model) => !modelFreeModels.has(model)), false],
    ];
    $("#modelChoices").innerHTML = groups.filter(([, models]) => models.length).map(([label, models, free]) => `<section class="model-choice-group"><h3>${label}<span>${models.length}</span></h3>${models.map((model) => modelChoice(model, free)).join("")}</section>`).join("");
  }
  updateModelSelectionCount();
}
function openModelDialog(providerId) {
  const provider = providersCache.find((item) => item.id === providerId);
  if (!provider) return;
  modelCatalog = [...provider.models];
  modelSelection = new Set(provider.enabledModels ?? provider.models);
  modelFreeModels = new Set(provider.freeModels ?? provider.models.filter((model) => isProviderFreeModelId(provider.type, model)));
  $("#modelDialog").dataset.providerId = provider.id;
  $("#modelDialog").dataset.providerType = provider.type;
  $("#modelDialogTitle").textContent = `${provider.name} · 选择模型`;
  $("#modelSearch").value = "";
  $("#onlyFreeModels").checked = false;
  $("#freeModelsFilter").hidden = !supportsFreeModelGroups(provider.type);
  renderModelChoices();
  $("#modelDialog").showModal();
}
function resetProviderDialog() {
  $("#providerForm").reset();
  delete $("#providerDialog").dataset.providerId;
  $("#providerType").disabled = false;
  $("#providerApiKey").placeholder = "";
  $("#providerDialogTitle").textContent = "登记提供商";
  $("#saveProvider").textContent = "保存提供商";
  draftFreeModels.clear();
  $("#modelCount").textContent = "尚未获取。";
}
function openProviderEditor(providerId) {
  const provider = providersCache.find((item) => item.id === providerId);
  if (!provider) return;
  resetProviderDialog();
  $("#providerDialog").dataset.providerId = provider.id;
  $("#providerDialogTitle").textContent = `编辑 ${provider.name}`;
  $("#saveProvider").textContent = "保存修改";
  $("#providerName").value = provider.name;
  $("#providerType").value = provider.type;
  $("#providerType").disabled = true;
  $("#providerApiKey").placeholder = provider.hasApiKey ? "已保存；留空则保持不变" : "填写新的 API Key";
  $("#providerBaseUrl").value = provider.baseUrl || "";
  $("#providerModels").value = (provider.models || []).join("\n");
  draftFreeModels = new Set(provider.freeModels || []);
  $("#modelCount").textContent = `当前 ${provider.models.length} 个模型；可重新自动获取。`;
  $("#providerDialog").showModal();
}
function resetKeyDialog() {
  $("#keyForm").reset();
  delete $("#keyDialog").dataset.keyId;
  $("#keyDialogTitle").textContent = "发行访问密钥";
  $("#saveKey").textContent = "生成密钥";
  $("#customKey").disabled = false;
  $("#customKey").placeholder = "至少 24 个字符";
}
function openKeyEditor(keyId) {
  const key = keysCache.find((item) => item.id === keyId);
  if (!key) return;
  resetKeyDialog();
  $("#keyDialog").dataset.keyId = key.id;
  $("#keyDialogTitle").textContent = `设置 ${key.name} 的限额`;
  $("#saveKey").textContent = "保存限额";
  $("#keyName").value = key.name;
  $("#customKey").disabled = true;
  $("#customKey").placeholder = "编辑限额时不更改密钥";
  $("#keyRpm").value = key.requestsPerMinute || "";
  $("#keyDailyRequests").value = key.dailyRequestLimit || "";
  $("#keyMonthlyTokens").value = key.monthlyTokenLimit || "";
  $("#keyMaxOutputTokens").value = key.maxOutputTokensPerRequest || "";
  $("#keyDialog").showModal();
}
$("#loginForm").addEventListener("submit", async (event) => { event.preventDefault(); adminToken = $("#adminToken").value; sessionStorage.setItem(tokenKey, adminToken); await load(); if (!$("#workspace").hidden) notify("管理台已开启"); else notify("管理员凭据无效", "error"); });
document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => {
  if (button.dataset.open === "providerDialog") {
    resetProviderDialog();
  }
  if (button.dataset.open === "keyDialog") resetKeyDialog();
  $(`#${button.dataset.open}`).showModal();
}));
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
$("#providerForm").addEventListener("submit", async (event) => { event.preventDefault(); const submit = event.submitter; submit.disabled = true; try { const providerId = $("#providerDialog").dataset.providerId; const type = $("#providerType").value; const models = $("#providerModels").value.split(/\n|,/).map((v) => v.trim()).filter(Boolean); const freeModels = supportsFreeModelGroups(type) ? models.filter((model) => draftFreeModels.has(model) || isProviderFreeModelId(type, model)) : []; const payload = { name: $("#providerName").value, type, apiKey: $("#providerApiKey").value || undefined, baseUrl: $("#providerBaseUrl").value || undefined, models, freeModels }; await api(providerId ? `/admin/providers/${providerId}` : "/admin/providers", { method: providerId ? "PUT" : "POST", body: JSON.stringify(payload) }); resetProviderDialog(); $("#providerDialog").close(); await loadProviders(); notify(providerId ? "供应商已更新" : "提供商已登记"); } catch (error) { notify(error.message, "error"); } finally { submit.disabled = false; } });
$("#discoverDraft").addEventListener("click", async (event) => { const button = event.currentTarget; button.disabled = true; button.textContent = "正在连接…"; $("#modelCount").textContent = "正在向提供商查询模型目录。"; try { const result = await api("/admin/providers/discover", { method: "POST", body: JSON.stringify({ id: $("#providerDialog").dataset.providerId, type: $("#providerType").value, apiKey: $("#providerApiKey").value || undefined, baseUrl: $("#providerBaseUrl").value || undefined }) }); draftFreeModels = new Set(result.freeModels || []); $("#providerModels").value = result.data.join("\n"); $("#modelCount").textContent = supportsFreeModelGroups($("#providerType").value) ? `已获取 ${result.count} 个模型：${result.freeCount || 0} 个可纳入免费筛选，${result.count - (result.freeCount || 0)} 个其他模型。保存后可分组勾选。` : `已获取 ${result.count} 个模型。保存后即可使用。`; notify(`已获取 ${result.count} 个模型`); } catch (error) { $("#modelCount").textContent = error.message; notify(error.message, "error"); } finally { button.disabled = false; button.textContent = "自动获取模型"; } });
$("#keyForm").addEventListener("submit", async (event) => { event.preventDefault(); const submit = event.submitter; submit.disabled = true; try { const keyId = $("#keyDialog").dataset.keyId; const number = (selector) => { const raw = $(selector).value; return raw ? Number(raw) : keyId ? null : undefined; }; const payload = { name: $("#keyName").value, key: keyId ? undefined : $("#customKey").value || undefined, requestsPerMinute: number("#keyRpm"), dailyRequestLimit: number("#keyDailyRequests"), monthlyTokenLimit: number("#keyMonthlyTokens"), maxOutputTokensPerRequest: number("#keyMaxOutputTokens") }; const data = await api(keyId ? `/admin/keys/${keyId}` : "/admin/keys", { method: keyId ? "PUT" : "POST", body: JSON.stringify(payload) }); $("#keyDialog").close(); if (keyId) { resetKeyDialog(); notify("密钥限额已更新"); } else { $("#revealedKey").textContent = data.key; $("#revealDialog").showModal(); event.target.reset(); } await loadKeys(); } catch (error) { notify(error.message, "error"); } finally { submit.disabled = false; } });
$("#copyKey").addEventListener("click", async () => { await navigator.clipboard.writeText($("#revealedKey").textContent); notify("密钥已复制"); });
$("#usageRange").addEventListener("change", () => { usagePaging.models.page = 1; usagePaging.logs.page = 1; loadUsage().catch((error) => notify(error.message, "error")); });
$("#refreshUsage").addEventListener("click", (event) => refreshUsage(event.currentTarget));
$("#modelPageSize").addEventListener("change", (event) => { usagePaging.models.pageSize = Number(event.target.value); usagePaging.models.page = 1; loadUsage().catch((error) => notify(error.message, "error")); });
$("#logPageSize").addEventListener("change", (event) => { usagePaging.logs.pageSize = Number(event.target.value); usagePaging.logs.page = 1; loadUsage().catch((error) => notify(error.message, "error")); });
$("#modelPrev").addEventListener("click", () => { usagePaging.models.page = Math.max(1, usagePaging.models.page - 1); loadUsage().catch((error) => notify(error.message, "error")); });
$("#modelNext").addEventListener("click", () => { usagePaging.models.page += 1; loadUsage().catch((error) => notify(error.message, "error")); });
$("#logPrev").addEventListener("click", () => { usagePaging.logs.page = Math.max(1, usagePaging.logs.page - 1); loadUsage().catch((error) => notify(error.message, "error")); });
$("#logNext").addEventListener("click", () => { usagePaging.logs.page += 1; loadUsage().catch((error) => notify(error.message, "error")); });
$("#modelSearch").addEventListener("input", renderModelChoices);
$("#onlyFreeModels").addEventListener("change", renderModelChoices);
$("#modelChoices").addEventListener("change", (event) => { if (!(event.target instanceof HTMLInputElement)) return; if (event.target.checked) modelSelection.add(event.target.value); else modelSelection.delete(event.target.value); updateModelSelectionCount(); });
$("#selectAllModels").addEventListener("click", () => { visibleModelCatalog().forEach((model) => modelSelection.add(model)); renderModelChoices(); });
$("#clearAllModels").addEventListener("click", () => { visibleModelCatalog().forEach((model) => modelSelection.delete(model)); renderModelChoices(); });
$("#providerType").addEventListener("change", () => { draftFreeModels.clear(); $("#modelCount").textContent = "类型已更改，请重新获取模型。"; });
$("#modelForm").addEventListener("submit", async (event) => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const providerId = $("#modelDialog").dataset.providerId; const enabledModels = modelCatalog.filter((model) => modelSelection.has(model)); await api(`/admin/providers/${providerId}`, { method: "PUT", body: JSON.stringify({ enabledModels }) }); $("#modelDialog").close(); await loadProviders(); notify(`已启用 ${enabledModels.length} 个模型`); } catch (error) { notify(error.message, "error"); } finally { button.disabled = false; } });
document.addEventListener("click", async (event) => { const editId = event.target.dataset?.editProvider; const providerId = event.target.dataset?.deleteProvider; const discoverId = event.target.dataset?.discoverProvider; const modelProviderId = event.target.dataset?.modelProvider; const keyId = event.target.dataset?.deleteKey; const editKeyId = event.target.dataset?.editKey; const toggleKeyId = event.target.dataset?.toggleKey; try { if (editId) openProviderEditor(editId); if (editKeyId) openKeyEditor(editKeyId); if (modelProviderId) openModelDialog(modelProviderId); if (discoverId) { event.target.disabled = true; event.target.textContent = "获取中…"; const result = await api(`/admin/providers/${discoverId}/discover`, { method: "POST" }); await loadProviders(); notify(`已刷新 ${result.count} 个模型`); } if (providerId) { await api(`/admin/providers/${providerId}`, { method: "DELETE" }); await loadProviders(); notify("提供商已删除"); } if (toggleKeyId) { const key = keysCache.find((item) => item.id === toggleKeyId); if (key) { await api(`/admin/keys/${toggleKeyId}`, { method: "PUT", body: JSON.stringify({ enabled: !key.enabled }) }); await loadKeys(); notify(key.enabled ? "密钥已停用" : "密钥已启用"); } } if (keyId) { await api(`/admin/keys/${keyId}`, { method: "DELETE" }); await loadKeys(); notify("密钥已吊销"); } } catch (error) { notify(error.message, "error"); if (event.target instanceof HTMLButtonElement) { event.target.disabled = false; event.target.textContent = discoverId ? "刷新模型" : event.target.textContent; } } });
$("#testForm").addEventListener("submit", async (event) => { event.preventDefault(); const button = event.submitter; button.disabled = true; button.textContent = "发送中…"; try { const endpoint = $("#testEndpoint").value; const prompt = $("#testPrompt").value; const body = endpoint === "responses" ? { model: $("#testModel").value, input: prompt } : { model: $("#testModel").value, messages: [{ role: "user", content: prompt }], max_tokens: 512 }; const response = await fetch(`/v1/${endpoint}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${$("#testKey").value}` }, body: JSON.stringify(body) }); const text = await response.text(); try { $("#testResult").textContent = JSON.stringify(JSON.parse(text), null, 2); } catch { $("#testResult").textContent = text; } } catch (error) { $("#testResult").textContent = error.message; } finally { button.disabled = false; button.textContent = "发送校样"; } });
load();
