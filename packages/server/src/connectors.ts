import type { McpConfig, McpStatus, OpenCodeClient } from "../../engine/src/index.ts";
import {
  CONNECTOR_CATALOG,
  findConnectorDefinition,
  type ConnectorDefinition,
  type ConnectorField,
  type ConnectorTool,
} from "../../connectors/catalog.ts";

export type { ConnectorField, ConnectorTool };

export class ConnectorError extends Error {}

export type ConnectorConfigValue = string | number | boolean | null;

export interface InstanceConnector {
  alias: string;
  definitionId?: string;
  name?: string;
  description?: string;
  category?: string;
  tools?: ConnectorTool[];
  transport?: McpConfig;
  config?: Record<string, ConnectorConfigValue>;
  enabled: boolean;
}

export interface ConnectorView extends InstanceConnector {
  icon: string;
  fields: ConnectorField[];
  auth: ConnectorDefinition["auth"];
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
  auth: ConnectorDefinition["auth"];
  defaultEnabled: boolean;
  fields: ConnectorField[];
  tools: ConnectorTool[];
}

export interface ConnectorLaunch {
  alias: string;
  config: McpConfig;
}

const ALIAS = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const ENV_NAME = /^[a-z_][a-z0-9_]*$/i;
const SECRET_MASK = "••••••••";

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConnectorError(`${label} inválido`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 200): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ConnectorError(`${label} inválido`);
  const out = value.trim();
  if (!out) return undefined;
  return out.slice(0, max);
}

function parseEnvironment(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = requireRecord(value, "environment");
  const out: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(raw).slice(0, 40)) {
    if (!ENV_NAME.test(key)) throw new ConnectorError(`variável de ambiente inválida: ${key}`);
    if (typeof rawValue === "string" || typeof rawValue === "number" || typeof rawValue === "boolean") {
      out[key] = String(rawValue).slice(0, 2000);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseTransport(value: unknown): McpConfig | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = requireRecord(value, "transport");
  const enabled = raw.enabled === undefined ? true : Boolean(raw.enabled);
  const timeout = typeof raw.timeout === "number" && raw.timeout > 0 ? Math.min(raw.timeout, 3_600_000) : 30_000;
  if (raw.type === "local") {
    if (!Array.isArray(raw.command) || raw.command.length === 0) {
      throw new ConnectorError("transport local precisa de command");
    }
    const command = raw.command.map((part) => {
      if (typeof part !== "string" || !part.trim()) throw new ConnectorError("command inválido");
      return part.slice(0, 2000);
    });
    const cwd = text(raw.cwd, "cwd", 2000);
    const environment = parseEnvironment(raw.environment);
    return { type: "local", command, cwd, enabled, timeout, environment };
  }
  if (raw.type === "remote") {
    const url = text(raw.url, "url", 2000);
    if (!url || !/^https?:\/\//.test(url)) throw new ConnectorError("url remota inválida");
    return { type: "remote", url, enabled, timeout };
  }
  throw new ConnectorError("transport deve ser local ou remote");
}

function parseConfig(
  value: unknown,
  definition: ConnectorDefinition | undefined,
  previous: Record<string, ConnectorConfigValue> | undefined,
): Record<string, ConnectorConfigValue> | undefined {
  if (value === undefined || value === null) return previous ? { ...previous } : undefined;
  const raw = requireRecord(value, "config");
  const fields = new Map((definition?.fields ?? []).map((field) => [field.key, field]));
  const out: Record<string, ConnectorConfigValue> = previous ? { ...previous } : {};

  for (const [key, rawValue] of Object.entries(raw).slice(0, 20)) {
    const field: ConnectorField | undefined = fields.get(key);
    if (!field) continue;
    const current = previous?.[key];
    if (rawValue === null) {
      delete out[key];
      continue;
    }
    const blank =
      rawValue === undefined ||
      rawValue === null ||
      rawValue === "" ||
      rawValue === SECRET_MASK ||
      (typeof rawValue === "string" && rawValue.trim() === "");

    if (field.secret && blank) {
      if (current !== undefined) out[key] = current;
      continue;
    }
    if (blank) {
      delete out[key];
      continue;
    }
    if (field.type === "checkbox") {
      out[key] = Boolean(rawValue);
    } else if (field.type === "number") {
      const numeric = Number(rawValue);
      if (!Number.isFinite(numeric)) throw new ConnectorError(`${field.label} deve ser um número`);
      out[key] = numeric;
    } else {
      const value = text(rawValue, field.label, field.secret ? 500 : 1000);
      if (value !== undefined) out[key] = value;
      else delete out[key];
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseConnectorInput(
  body: unknown,
  aliasHint?: string,
  previous?: InstanceConnector,
): InstanceConnector {
  const raw = requireRecord(body, "conector");
  const alias = text(raw.alias ?? aliasHint ?? previous?.alias, "alias", 64);
  if (!alias || !ALIAS.test(alias)) {
    throw new ConnectorError("alias deve conter letras, números, - ou _ (máx. 64)");
  }
  const definitionId = text(raw.definitionId, "definitionId", 120) ?? previous?.definitionId;
  const definition = definitionId ? findConnectorDefinition(definitionId) : undefined;
  if (definitionId && !definition) throw new ConnectorError(`conector desconhecido: ${definitionId}`);
  const transport = parseTransport(raw.transport) ?? previous?.transport;
  if (!definitionId && !transport) throw new ConnectorError("informe definitionId ou transport");

  const tools: ConnectorTool[] | undefined = Array.isArray(raw.tools)
    ? raw.tools.slice(0, 100).flatMap((item) => {
        const entry = requireRecord(item, "tool");
        const name = text(entry.name, "nome da ferramenta", 200);
        return name ? [{ name, description: text(entry.description, "descrição", 1000) }] : [];
      })
    : previous?.tools;

  return {
    alias,
    definitionId,
    name: text(raw.name, "nome", 120) ?? previous?.name,
    description: text(raw.description, "descrição", 1000) ?? previous?.description,
    category: text(raw.category, "categoria", 120) ?? previous?.category,
    tools,
    transport,
    config: parseConfig(raw.config, definition, previous?.config),
    enabled: raw.enabled === undefined ? previous?.enabled ?? true : Boolean(raw.enabled),
  };
}

export function parseConnectorList(value: unknown): InstanceConnector[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ConnectorError("connectors deve ser uma lista");
  const parsed = value.slice(0, 20).map((item) => parseConnectorInput(item));
  const seen = new Set<string>();
  for (const connector of parsed) {
    if (seen.has(connector.alias.toLowerCase())) {
      throw new ConnectorError(`alias duplicado: ${connector.alias}`);
    }
    seen.add(connector.alias.toLowerCase());
  }
  return parsed;
}

export function parseDefaultConnectorIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ConnectorError("defaultConnectors deve ser uma lista");
  const ids = value.slice(0, 20).flatMap((item) => {
    if (typeof item !== "string") return [];
    const id = item.trim();
    return id && findConnectorDefinition(id) ? [id] : [];
  });
  return [...new Set(ids)];
}

export function defaultConnectorEntries(ids: string[]): InstanceConnector[] {
  return ids.map((id) => ({ alias: id, definitionId: id, enabled: true }));
}

export function resolveConnectors(
  connectors: InstanceConnector[] | undefined,
  defaultIds: string[],
): InstanceConnector[] {
  return connectors ?? defaultConnectorEntries(defaultIds);
}

export function catalogViews(): ConnectorDefinitionView[] {
  return CONNECTOR_CATALOG.map((def) => ({
    id: def.id,
    name: def.name,
    description: def.description,
    category: def.category,
    icon: def.icon,
    auth: def.auth,
    defaultEnabled: def.defaultEnabled,
    fields: def.fields,
    tools: def.tools,
  }));
}

export function connectorDefinition(id: string): ConnectorDefinition | undefined {
  return findConnectorDefinition(id);
}

export function publicConnectors(connectors: InstanceConnector[] | undefined): InstanceConnector[] | undefined {
  if (!connectors) return connectors;
  return connectors.map((connector) => {
    const definition = connector.definitionId ? findConnectorDefinition(connector.definitionId) : undefined;
    const secretKeys = new Set((definition?.fields ?? []).filter((field) => field.secret).map((field) => field.key));
    return {
      ...connector,
      config: connector.config
        ? Object.fromEntries(
            Object.entries(connector.config).map(([key, value]) => [key, secretKeys.has(key) ? SECRET_MASK : value]),
          )
        : undefined,
    };
  });
}

export function publicInstance<T extends { connectors?: InstanceConnector[] }>(instance: T): T {
  return { ...instance, connectors: publicConnectors(instance.connectors) };
}

function environmentFromConfig(
  config: Record<string, ConnectorConfigValue> | undefined,
  definition: ConnectorDefinition | undefined,
): Record<string, string> {
  if (!config || !definition) return {};
  const env: Record<string, string> = {};
  for (const field of definition.fields) {
    if (!field.env) continue;
    const value = config[field.key];
    if (value === undefined || value === null || value === "") continue;
    env[field.env] = field.type === "checkbox" ? (value ? "1" : "0") : String(value);
  }
  return env;
}

export function connectorLaunches(
  connectors: InstanceConnector[] | undefined,
  root: string,
  defaultIds: string[],
  runtimeEnv?: Record<string, string>,
): ConnectorLaunch[] {
  return resolveConnectors(connectors, defaultIds).flatMap((connector) => {
    const definition = connector.definitionId ? findConnectorDefinition(connector.definitionId) : undefined;
    const base = definition ? definition.transport(root) : connector.transport;
    if (!base) return [];
    const environment = {
      ...(base.type === "local" ? base.environment : undefined),
      ...runtimeEnv,
      ...environmentFromConfig(connector.config, definition),
    };
    const config: McpConfig =
      base.type === "local"
        ? { ...base, enabled: connector.enabled, ...(Object.keys(environment).length > 0 ? { environment } : {}) }
        : { ...base, enabled: connector.enabled };
    return [{ alias: connector.alias, config }];
  });
}

export async function connectorViews(
  connectors: InstanceConnector[] | undefined,
  defaultIds: string[],
  client: OpenCodeClient,
): Promise<ConnectorView[]> {
  const entries = resolveConnectors(connectors, defaultIds);
  const statuses = entries.length > 0 ? await client.mcpStatus() : ({} as Record<string, McpStatus>);
  return entries.map((connector) => {
    const def = connector.definitionId ? findConnectorDefinition(connector.definitionId) : undefined;
    const live = statuses[connector.alias];
    const secretKeys = new Set((def?.fields ?? []).filter((field) => field.secret).map((field) => field.key));
    const secrets = [...secretKeys].filter((key) => connector.config?.[key] !== undefined);
    return {
      ...publicConnectors([connector])![0],
      secrets,
      name: connector.name ?? def?.name ?? connector.alias,
      description: connector.description ?? def?.description,
      category: connector.category ?? def?.category ?? "Personalizado",
      icon: def?.icon ?? connector.alias.slice(0, 1).toUpperCase(),
      fields: def?.fields ?? [],
      auth: def?.auth ?? "none",
      tools: connector.tools ?? def?.tools ?? [],
      status: live?.status ?? "unknown",
      error: live && "error" in live ? live.error : undefined,
    };
  });
}
