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
  available: boolean;
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
  appVersion?: string;
  opencode?: { ok: boolean; version?: string; error?: string };
  defaultModel?: ModelRef;
  connectors: string[];
}

export interface UpdateInfo {
  checkedAt: string;
  current: string;
  latest?: string;
  url?: string;
  available: boolean;
  error?: string;
}

export interface ConnectorTool {
  name: string;
  description?: string;
}

export interface ConnectorField {
  key: string;
  label: string;
  type: "text" | "number" | "checkbox";
  env?: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string | number | boolean;
}

export type ConnectorConfigValue = string | number | boolean | null;

export type ConnectorTransport =
  | {
      type: "local";
      command: string[];
      cwd?: string;
      environment?: Record<string, string>;
      enabled?: boolean;
      timeout?: number;
    }
  | { type: "remote"; url: string; enabled?: boolean; timeout?: number };

export interface InstanceConnector {
  alias: string;
  definitionId?: string;
  name?: string;
  description?: string;
  category?: string;
  tools?: ConnectorTool[];
  transport?: ConnectorTransport;
  config?: Record<string, ConnectorConfigValue>;
  enabled: boolean;
}

export interface ConnectorView extends InstanceConnector {
  icon: string;
  fields: ConnectorField[];
  auth: "none" | "api_key" | "oauth";
  secrets?: string[];
  status: string;
  error?: string;
}

export interface ConnectorDefinitionView {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  auth: "none" | "api_key" | "oauth";
  defaultEnabled: boolean;
  fields: ConnectorField[];
  tools: ConnectorTool[];
}

export interface ConnectorInput {
  alias?: string;
  definitionId?: string;
  name?: string;
  description?: string;
  category?: string;
  enabled?: boolean;
  transport?: ConnectorTransport;
  config?: Record<string, ConnectorConfigValue>;
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
  connectors?: ConnectorView[];
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
  connectors?: ConnectorInput[];
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
  connectors?: ConnectorInput[];
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

export function discordInviteUrl(appId: unknown): string | undefined {
  const id = typeof appId === "string" || typeof appId === "number" ? String(appId).trim() : "";
  if (!/^\d{17,20}$/.test(id)) return undefined;
  return `https://discord.com/api/oauth2/authorize?client_id=${id}&permissions=8&scope=bot`;
}

export const api = {
  status: (): Promise<HefestoStatus> => http<HefestoStatus>("/api/status", "GET"),

  update: (): Promise<UpdateInfo> => http<UpdateInfo>("/api/update", "GET"),

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

  connectorCatalog: (): Promise<{ connectors: ConnectorDefinitionView[] }> =>
    http("/api/connectors/catalog", "GET"),

  defaultConnectors: (): Promise<{ defaultConnectors: string[] }> =>
    http("/api/settings/connectors/defaults", "GET"),

  setDefaultConnectors: (ids: string[]): Promise<{ defaultConnectors: string[] }> =>
    http("/api/settings/connectors/defaults", "PUT", { defaultConnectors: ids }),

  instanceConnectors: (id: string): Promise<{ connectors: ConnectorView[] }> =>
    http(`/api/instances/${encodeURIComponent(id)}/connectors`, "GET"),

  addInstanceConnector: (
    id: string,
    input: ConnectorInput,
  ): Promise<{ connectors: ConnectorView[]; instance: Instance }> =>
    http(`/api/instances/${encodeURIComponent(id)}/connectors`, "POST", input),

  updateInstanceConnector: (
    id: string,
    alias: string,
    input: ConnectorInput,
  ): Promise<{ connectors: ConnectorView[]; instance: Instance }> =>
    http(`/api/instances/${encodeURIComponent(id)}/connectors/${encodeURIComponent(alias)}`, "PATCH", input),

  removeInstanceConnector: (id: string, alias: string): Promise<{ connectors: ConnectorView[] }> =>
    http(`/api/instances/${encodeURIComponent(id)}/connectors/${encodeURIComponent(alias)}`, "DELETE"),

  toggleInstanceConnector: (
    id: string,
    alias: string,
    action: "connect" | "disconnect",
  ): Promise<{ ok: boolean; connectors: ConnectorView[] }> =>
    http(`/api/instances/${encodeURIComponent(id)}/connectors/${encodeURIComponent(alias)}/${action}`, "POST", {}),

  instances: (): Promise<{ instances: Instance[] }> => http("/api/instances", "GET"),

  instance: (id: string): Promise<{ instance: Instance }> =>
    http(`/api/instances/${encodeURIComponent(id)}`, "GET"),

  createInstance: (input: InstanceInput): Promise<{ instance: Instance }> =>
    http("/api/instances", "POST", input),

  updateInstance: (id: string, input: InstanceUpdate): Promise<{ instance: Instance }> =>
    http(`/api/instances/${encodeURIComponent(id)}`, "PATCH", input),

  deleteInstance: (id: string, opts?: { keepHistory?: boolean }): Promise<void> =>
    http(
      `/api/instances/${encodeURIComponent(id)}${opts?.keepHistory ? "?keepHistory=1" : ""}`,
      "DELETE",
    ),

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
    opts: { model?: ModelRef },
  ): Promise<void> =>
    http(`/oc/i/${encodeURIComponent(instanceId)}/session/${encodeURIComponent(sessionId)}/prompt_async`, "POST", {
      parts,
      agent: "hefesto",
      ...(opts.model ? { model: opts.model } : {}),
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
  if (!model) return "Sem modelo";
  const provider = providers.find((p) => p.id === model.providerID);
  const info = provider?.models?.find((m) => m.id === model.modelID);
  return `${provider?.name ?? model.providerID}/${info?.name ?? model.modelID}`;
}
