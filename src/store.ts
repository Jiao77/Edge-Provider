import type { ClientKey, Env, Provider, PublicProvider } from "./types";
import { sha256 } from "./utils";

const PROVIDERS = "providers:v1";
const CLIENT_KEYS = "client-keys:v1";

export async function getProviders(env: Env): Promise<Provider[]> {
  return (await env.CONFIG.get<Provider[]>(PROVIDERS, "json")) || [];
}

export async function saveProviders(env: Env, providers: Provider[]): Promise<void> {
  await env.CONFIG.put(PROVIDERS, JSON.stringify(providers));
}

export function redactProvider(provider: Provider): PublicProvider {
  const { apiKey, ...safe } = provider;
  return { ...safe, hasApiKey: Boolean(apiKey) };
}

export async function getClientKeys(env: Env): Promise<ClientKey[]> {
  return (await env.CONFIG.get<ClientKey[]>(CLIENT_KEYS, "json")) || [];
}

export async function saveClientKeys(env: Env, keys: ClientKey[]): Promise<void> {
  await env.CONFIG.put(CLIENT_KEYS, JSON.stringify(keys));
}

export async function authenticateClient(env: Env, token: string): Promise<ClientKey | null> {
  if (!token) return null;
  const hash = await sha256(token);
  return (await getClientKeys(env)).find((item) => item.enabled && item.hash === hash) || null;
}
