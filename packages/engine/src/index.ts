export interface ModelRef {
  providerID: string;
  modelID: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  env?: string[];
  source?: string;
  key?: string;
  options?: Record<string, unknown>;
  models?: Record<string, ModelInfo>;
}

export interface ModelInfo {
  id: string;
  providerID: string;
  name?: string;
  [k: string]: unknown;
}

export interface Session {
  id: string;
  title?: string;
  agent?: string;
  model?: { id?: string; providerID?: string; variant?: string };
  cost?: number;
  tokens?: Record<string, unknown>;
  time?: { created?: number; updated?: number };
  [k: string]: unknown;
}

export interface TextPart {
  type: "text";
  text: string;
  id?: string;
  sessionID?: string;
  messageID?: string;
}

export interface ToolPart {
  type: "tool";
  tool: string;
  callID?: string;
  messageID?: string;
  sessionID?: string;
  state?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ReasoningPart {
  type: "reasoning";
  text?: string;
  messageID?: string;
  [k: string]: unknown;
}

export type Part = TextPart | ToolPart | ReasoningPart | { type: string; [k: string]: unknown };
export type PartInput = { type: "text"; text: string } | { type: string; [k: string]: unknown };

export interface PromptInput {
  parts: PartInput[];
  system?: string;
  model?: ModelRef;
  agent?: string;
  tools?: Record<string, boolean>;
  noReply?: boolean;
}

export interface OpenCodeEvent {
  id: string;
  type: string;
  properties: Record<string, any>;
}

export interface McpLocalConfig {
  type: "local";
  command: string[];
  cwd?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export interface McpRemoteConfig {
  type: "remote";
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  timeout?: number;
}

export type McpConfig = McpLocalConfig | McpRemoteConfig;

export type McpStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string };

export class OpenCodeClient {
  baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 600_000,
  ): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // A per-request timeout avoids undici's global pool wedging after a burst
      // of ECONNREFUSED while `opencode serve` is still booting.
      signal: AbortSignal.timeout(timeoutMs),
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
    if (!res.ok) throw new Error(`OpenCode ${res.status} ${method} ${path}: ${text.slice(0, 400)}`);
    return data as T;
  }

  async health(): Promise<{ healthy: boolean; version: string }> {
    return this.request("GET", "/global/health", undefined, 5_000);
  }

  async listProviders(): Promise<{ providers: ProviderInfo[] }> {
    const data = await this.request<unknown>("GET", "/config/providers");
    return { providers: normalizeProviders(data) };
  }

  async listAgents(): Promise<unknown[]> {
    return this.request("GET", "/agent");
  }

  async listSessions(): Promise<Session[]> {
    return this.request("GET", "/session");
  }

  async createSession(opts?: { title?: string }): Promise<Session> {
    return this.request("POST", "/session", opts ?? {});
  }

  async sendPrompt(sessionId: string, input: PromptInput): Promise<{ info: unknown; parts: Part[] }> {
    return this.request("POST", `/session/${sessionId}/message`, input);
  }

  async sendPromptAsync(sessionId: string, input: PromptInput): Promise<void> {
    return this.request("POST", `/session/${sessionId}/prompt_async`, input);
  }

  async listMessages(sessionId: string): Promise<Array<{ info: any; parts: Part[] }>> {
    return this.request("GET", `/session/${sessionId}/message`);
  }

  async abortSession(sessionId: string): Promise<boolean> {
    return this.request("POST", `/session/${sessionId}/abort`, undefined, 15_000);
  }

  async sessionStatuses(): Promise<Record<string, { type: "idle" | "busy" | "retry"; [k: string]: unknown }>> {
    return this.request("GET", "/session/status", undefined, 15_000);
  }

  async setAuth(providerId: string, key: string): Promise<boolean> {
    return this.request("PUT", `/auth/${providerId}`, { type: "api", key });
  }

  async addMcp(name: string, config: McpConfig): Promise<Record<string, unknown>> {
    return this.request("POST", "/mcp", { name, config });
  }

  async mcpStatus(): Promise<Record<string, McpStatus>> {
    return this.request("GET", "/mcp");
  }

  async mcpConnect(name: string): Promise<boolean> {
    return this.request("POST", `/mcp/${encodeURIComponent(name)}/connect`, undefined, 15_000);
  }

  async mcpDisconnect(name: string): Promise<boolean> {
    return this.request("POST", `/mcp/${encodeURIComponent(name)}/disconnect`, undefined, 15_000);
  }

  /**
   * Subscribe to the global SSE event stream. Returns a function that closes
   * the stream. Events are emitted as parsed objects: { id, type, properties }.
   */
  streamEvents(onEvent: (e: OpenCodeEvent) => void): () => void {
    const ac = new AbortController();
    (async () => {
      const res = await fetch(this.baseUrl + "/event", {
        headers: { Accept: "text/event-stream" },
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`event stream failed: ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
          const sepLen = buf.slice(idx, idx + 4).startsWith("\r\n\r\n") ? 4 : 2;
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + sepLen);
          for (const line of block.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            try {
              onEvent(JSON.parse(data));
            } catch {
              /* ignore malformed */
            }
          }
        }
      }
    })().catch(() => {});
    return () => ac.abort();
  }
}

function normalizeProviders(data: unknown): ProviderInfo[] {
  if (Array.isArray(data)) return data.filter(isProviderInfo);
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["providers", "all", "list"]) {
    const value = record[key];
    if (Array.isArray(value)) return value.filter(isProviderInfo);
    if (value && typeof value === "object") return providerMap(value);
  }
  return providerMap(record);
}

function providerMap(value: object): ProviderInfo[] {
  return Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => isProviderInfo(entry))
    .map(([id, entry]) => ({ ...(entry as ProviderInfo), id: (entry as ProviderInfo).id ?? id }));
}

function isProviderInfo(value: unknown): value is ProviderInfo {
  if (!value || typeof value !== "object") return false;
  return "id" in value || "models" in value;
}
