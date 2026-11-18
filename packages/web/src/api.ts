export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  free?: boolean;
}

export interface ProviderInfo {
  id: string;
  name: string;
  source?: string;
  env: string[];
  configured: boolean;
  public?: boolean;
  credentialed?: boolean;
  models: ProviderModel[];
}

export interface CatalogModel {
  id: string;
  name: string;
  free: boolean;
}

export interface CatalogProvider {
  id: string;
  name: string;
  models: CatalogModel[];
}

export interface ProviderMeta {
  id: string;
  name: string;
}

export interface HefestoStatus {
  running: boolean;
  port: number;
  baseUrl: string;
  version?: string;
  defaultModel?: ModelRef;
  connector: { registered: boolean; name?: string };
}

export interface Instance {
  id: string;
  name: string;
  slug: string;
  avatar?: string;
  tagline?: string;
  personality?: string;
  instructions?: string;
  accent: string;
  systemPrompt: string;
  model?: ModelRef;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceInput {
  name: string;
  avatar?: string;
  tagline?: string;
  personality?: string;
  instructions?: string;
  accent?: string;
  model?: ModelRef;
  auth?: { providerID: string; key: string };
}

export interface InstanceUpdate {
  name?: string;
  avatar?: string;
  tagline?: string;
  personality?: string;
  instructions?: string;
  accent?: string;
  model?: ModelRef | null;
}

export interface OpencodePart {
  id?: string;
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  messageID?: string;
  state?: { title?: string; status?: string; input?: unknown; output?: unknown };
}

export interface OpencodeMessage {
  info: { id: string; role?: string };
  parts: OpencodePart[];
}

async function http<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : text;
    throw new Error(message || `${res.status}`);
  }
  return data as T;
}

export const api = {
  status: (): Promise<HefestoStatus> => http<HefestoStatus>("/api/status", "GET"),

  providerCatalog: (): Promise<{ providers: CatalogProvider[] }> => http("/api/provider-catalog", "GET"),

  providerMeta: (): Promise<{ providers: ProviderMeta[] }> => http("/api/provider-catalog?meta=1", "GET"),

  instanceProviders: (id: string): Promise<{ providers: ProviderInfo[] }> =>
    http(`/api/instances/${encodeURIComponent(id)}/providers`, "GET"),

  connectInstanceProvider: (
    id: string,
    providerID: string,
    key: string,
  ): Promise<{ ok: boolean; providers: ProviderInfo[]; instance: Instance }> =>
    http(`/api/instances/${encodeURIComponent(id)}/providers/${encodeURIComponent(providerID)}/auth`, "PUT", {
      key,
    }),

  instances: (): Promise<{ instances: Instance[] }> => http("/api/instances", "GET"),

  instance: (id: string): Promise<{ instance: Instance }> =>
    http(`/api/instances/${encodeURIComponent(id)}`, "GET"),

  createInstance: (input: InstanceInput): Promise<{ instance: Instance }> =>
    http("/api/instances", "POST", input),

  updateInstance: (id: string, input: InstanceUpdate): Promise<{ instance: Instance }> =>
    http(`/api/instances/${encodeURIComponent(id)}`, "PATCH", input),

  deleteInstance: (id: string): Promise<void> =>
    http(`/api/instances/${encodeURIComponent(id)}`, "DELETE"),

  ensureSession: (id: string): Promise<{ sessionId: string }> =>
    http(`/api/instances/${encodeURIComponent(id)}/session`, "POST", {}),

  resetSession: (id: string): Promise<{ ok: boolean }> =>
    http(`/api/instances/${encodeURIComponent(id)}/reset`, "POST", {}),

  abortInstance: (id: string): Promise<{ ok: boolean; aborted: boolean; stale?: boolean }> =>
    http(`/api/instances/${encodeURIComponent(id)}/abort`, "POST", {}),

  sessionStatuses: (instanceId: string): Promise<Record<string, { type: "idle" | "busy" | "retry" }>> =>
    http(`/oc/i/${encodeURIComponent(instanceId)}/session/status`, "GET"),

  listMessages: (instanceId: string, sessionId: string): Promise<OpencodeMessage[]> =>
    http(`/oc/i/${encodeURIComponent(instanceId)}/session/${sessionId}/message`, "GET"),

  sendPrompt: (
    instanceId: string,
    sessionId: string,
    parts: Array<{ type: "text"; text: string }>,
    opts: { model?: ModelRef; system?: string },
  ): Promise<void> =>
    http(`/oc/i/${encodeURIComponent(instanceId)}/session/${sessionId}/prompt_async`, "POST", {
      parts,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.system ? { system: opts.system } : {}),
    }),

  subscribe: (instanceId: string, onEvent: (e: { type: string; properties?: any }) => void): (() => void) => {
    const es = new EventSource(`/oc/i/${encodeURIComponent(instanceId)}/event`);
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  },
};

export function parseModelKey(key: string): ModelRef | undefined {
  const [providerID, ...rest] = key.split("/");
  const modelID = rest.join("/");
  if (!providerID || !modelID) return undefined;
  return { providerID, modelID };
}

export function modelKey(model?: ModelRef): string {
  return model ? `${model.providerID}/${model.modelID}` : "";
}

export function modelLabel(
  providers: Array<{ id: string; name: string; models?: Array<{ id: string; name: string }> }>,
  model?: ModelRef,
): string {
  if (!model) return "sem modelo";
  const provider = providers.find((p) => p.id === model.providerID);
  const info = provider?.models?.find((m) => m.id === model.modelID);
  return `${provider?.name ?? model.providerID}/${info?.name ?? model.modelID}`;
}
