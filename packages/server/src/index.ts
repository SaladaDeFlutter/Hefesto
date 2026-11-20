import http from "node:http";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hefesto } from "../../core/src/index.ts";
import { EngineManager, isolatedEnv } from "../../core/src/engines.ts";
import type { ModelRef, ProviderInfo } from "../../engine/src/index.ts";
import { InstanceStore, parseInstanceInput, type Instance, type InstanceInput } from "./instances.ts";
import { SettingsStore } from "./settings.ts";
import {
  catalogViews,
  connectorLaunches,
  connectorViews,
  ConnectorError,
  connectorDefinition,
  parseConnectorInput,
  type InstanceConnector,
  parseDefaultConnectorIds,
  publicInstance,
  resolveConnectors,
} from "./connectors.ts";
import { printBanner } from "./banner.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const WEB_DIST = resolve(__dirname, "../../web/dist");

try {
  process.loadEnvFile(resolve(ROOT, ".env"));
} catch {
  /* sem .env */
}

const DATA_DIR = process.env.HEFESTO_DATA_DIR ?? resolve(ROOT, "data");
const PORT = Number(process.env.PORT ?? 4100);
const APP_VERSION =
  process.env.HEFESTO_APP_VERSION ??
  (JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")).version as string);
const RELEASES_LATEST = "https://api.github.com/repos/SaladaDeFlutter/Hefesto/releases/latest";
const UPDATE_TTL_MS = 6 * 60 * 60 * 1000;
const UPDATE_ERROR_TTL_MS = 15 * 60 * 1000;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const OPEN_BROWSER_COMMAND =
  process.platform === "win32"
    ? 'start "" "<url>"'
    : process.platform === "darwin"
      ? 'open "<url>"'
      : 'xdg-open "<url>" >/dev/null 2>&1 &';

function buildAgentPrompt(base: string): string {
  return [
    base,
    "",
    "Atalhos do ambiente:",
    `- Para abrir uma URL no navegador do usuário, execute apenas este comando e responda em seguida: ${OPEN_BROWSER_COMMAND}`,
    "- Não verifique o navegador antes, não use sleep, pgrep ou logs e não detalhe o comando.",
    "- Se o usuário pedir um navegador específico, use o comando dele em vez do navegador padrão.",
  ].join("\n");
}

function buildBridgeAdminPrompt(base: string): string {
  return [
    base,
    "",
    "Você está respondendo pelo Discord e pode usar ferramentas do Discord quando o usuário tiver a permissão necessária.",
    "Só use ferramentas quando o usuário pedir explicitamente uma ação ou consulta. Para conversa normal, responda somente em texto.",
    "Cada ação é validada contra as permissões do membro que pediu e a hierarquia de cargos; ações sem permissão serão negadas.",
    "Você NÃO tem acesso ao computador do usuário: sem shell, sem leitura ou edição de arquivos.",
    "Não use ferramentas de envio de mensagens do Discord; o Hefesto enviará sua resposta no canal.",
    "Responda em texto, de forma breve e direta.",
  ].join("\n");
}

function buildDiscordChatPrompt(base: string): string {
  return [
    base,
    "",
    "Você está conversando pelo Discord.",
    "Você NÃO tem acesso ao computador do usuário, não pode ler ou editar arquivos e não pode administrar o servidor.",
    "Só use as ferramentas seguras de leitura quando o usuário pedir uma consulta. Para conversa normal, responda somente em texto.",
    "Se pedirem algo administrativo ou do PC, explique que não tem permissão.",
    "Responda em texto, de forma breve. O Hefesto envia sua resposta no canal.",
  ].join("\n");
}

const HOST_TOOL_NAMES = [
  "bash",
  "edit",
  "write",
  "patch",
  "multiedit",
  "webfetch",
  "websearch",
  "task",
  "todowrite",
  "skill",
  "question",
  "lsp",
  "external_directory",
  "plan_enter",
  "plan_exit",
  "apply_patch",
  "notebook_edit",
  "notebook_read",
];

const SAFE_DISCORD_TOOL_NAMES = new Set([
  "echo",
  "ping",
  "list_channels",
  "server_info",
  "read_messages",
  "list_threads",
  "read_thread",
  "list_aliases",
  "hora",
]);

const SEND_TOOL_NAMES = new Set(["send_message", "send_thread_message"]);
const OWNER_ONLY_DISCORD_TOOL_NAMES = new Set(["list_guilds"]);

const bridgeSessions = new Map<string, string>();

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function main() {
  printBanner(`http://127.0.0.1:${PORT}`);

  const store = new InstanceStore(DATA_DIR);
  const settings = new SettingsStore(DATA_DIR);
  const initialSettings = await settings.get();
  const catalogDir = join(DATA_DIR, "catalog");
  await mkdir(catalogDir, { recursive: true });
  await refreshModelCaches(catalogDir);
  const catalog = await Hefesto.start({ env: isolatedEnv(catalogDir) });
  const writeAgentConfig = async (
    engineDir: string,
    systemPrompt: string,
    allowExternal = false,
  ) => {
    const configDir = join(engineDir, "config", "opencode");
    await mkdir(configDir, { recursive: true });
    const prompt = buildAgentPrompt(systemPrompt);
    const bridgePrompt = buildBridgeAdminPrompt(systemPrompt);
    const chatPrompt = buildDiscordChatPrompt(systemPrompt);
    const config = {
      $schema: "https://opencode.ai/config.json",
      agent: {
        hefesto: {
          description: "Agente do Hefesto",
          mode: "primary",
          prompt,
          ...(allowExternal ? { permission: { external_directory: "allow" } } : {}),
        },
        "hefesto-bridge": {
          description: "Agente do Hefesto no Discord (permissões verificadas)",
          mode: "primary",
          prompt: bridgePrompt,
          permission: { external_directory: "deny" },
        },
        "hefesto-chat": {
          description: "Agente do Hefesto no Discord (somente ferramentas seguras)",
          mode: "primary",
          prompt: chatPrompt,
          permission: { external_directory: "deny" },
        },
      },
      default_agent: "hefesto",
    };
    await writeFile(join(configDir, "opencode.json"), JSON.stringify(config, null, 2), "utf8");
  };

  const prepareEngine = async (id: string) => {
    const instance = await store.get(id);
    if (!instance) return;
    await writeAgentConfig(join(DATA_DIR, "engines", id), instance.systemPrompt, true);
  };

  const bridgeRoot = join(DATA_DIR, "bridges");
  const prepareBridgeEngine = async (id: string) => {
    const instance = await store.get(id);
    if (!instance) return;
    await writeAgentConfig(join(bridgeRoot, id), instance.systemPrompt, false);
    await mkdir(join(bridgeRoot, id, "workspace"), { recursive: true });
    const sourceAuth = join(DATA_DIR, "engines", id, "data", "opencode", "auth.json");
    const targetAuthDir = join(bridgeRoot, id, "data", "opencode");
    await mkdir(targetAuthDir, { recursive: true });
    await copyFile(sourceAuth, join(targetAuthDir, "auth.json")).catch(() => undefined);
  };

  const connectorResolver = (bridge: boolean) => async (id: string) => {
    const instance = await store.get(id);
    const current = await settings.get();
    const launches = connectorLaunches(
      instance?.connectors,
      ROOT,
      current.defaultConnectors,
      {
        HEFESTO_INSTANCE_ID: id,
        HEFESTO_SERVER_URL: `http://127.0.0.1:${PORT}`,
        ...(bridge ? {} : { DISCORD_BRIDGE_DISABLED: "1" }),
      },
    );
    if (!bridge) return launches;
    const active = resolveConnectors(instance?.connectors, current.defaultConnectors);
    const discordAliases = new Set(
      active
        .filter(
          (connector) =>
            (connector.definitionId ?? connector.alias).toLowerCase() === "discord",
        )
        .map((connector) => connector.alias),
    );
    return launches.filter((launch) => discordAliases.has(launch.alias));
  };

  const engines = new EngineManager(
    join(DATA_DIR, "engines"),
    connectorResolver(false),
    prepareEngine,
  );
  const bridgeEngines = new EngineManager(
    bridgeRoot,
    connectorResolver(true),
    prepareBridgeEngine,
    (id) => join(bridgeRoot, id, "workspace"),
  );
  const status = await catalog.status();
  console.log(
    `catálogo opencode ${status.version ?? "?"} na porta ${status.port} · conectores padrão ${initialSettings.defaultConnectors.length}`,
  );

  const server = http.createServer((req, res) => {
    handle(req, res, catalog, catalogDir, engines, bridgeEngines, store, settings).catch((e: unknown) => {
      const err = e instanceof HttpError ? e : new HttpError(500, (e as Error)?.message ?? "erro interno");
      if (res.headersSent) {
        res.end();
        return;
      }
      json(res, { error: err.message }, err.status);
    });
  });

  server.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EADDRINUSE") console.error(`porta ${PORT} já está em uso (defina PORT)`);
    else console.error("erro no servidor:", e.message);
    process.exit(1);
  });

  server.listen(PORT, "127.0.0.1", () => console.log(`> abra http://127.0.0.1:${PORT}`));

  void Promise.all(
    (await store.list()).map(async (instance) => {
      if (!hasBridge(instance)) return;
      await syncBridgeEngine(bridgeEngines, store, instance.id);
    }),
  );

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await Promise.all([engines.stopAll(), bridgeEngines.stopAll(), catalog.stop()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function hasBridge(instance: Instance | undefined): boolean {
  return Boolean(
    instance?.connectors?.some((connector) => {
      const isDiscord = (connector.definitionId ?? connector.alias).toLowerCase() === "discord";
      return (
        isDiscord &&
        connector.enabled &&
        connector.config?.bridgeEnabled === true &&
        Boolean(connector.config?.token) &&
        Boolean(connector.config?.guildId)
      );
    }),
  );
}

async function syncBridgeEngine(
  engines: EngineManager,
  store: InstanceStore,
  id: string,
): Promise<void> {
  await engines.stop(id);
  const instance = await store.get(id);
  if (!hasBridge(instance)) return;
  try {
    await engines.get(id);
    console.log(`[hefesto] bridge Discord pronto: ${instance?.name ?? id}`);
  } catch (e) {
    console.error(
      `[hefesto] falha ao iniciar bridge de ${instance?.name ?? id}:`,
      (e as Error).message,
    );
  }
}

async function refreshModelCaches(catalogDir: string): Promise<void> {
  await rm(join(catalogDir, "cache", "opencode", "models.json"), { force: true });
  try {
    const enginesDir = join(DATA_DIR, "engines");
    const entries = await readdir(enginesDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          rm(join(enginesDir, entry.name, "cache", "opencode", "models.json"), { force: true }),
        ),
    );
  } catch {
    /* sem engines */
  }
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: Hefesto,
  catalogDir: string,
  engines: EngineManager,
  bridgeEngines: EngineManager,
  store: InstanceStore,
  settings: SettingsStore,
): Promise<void> {
  const u = new URL(req.url ?? "/", "http://x");
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) {
    await handleApi(req, res, u, catalog, catalogDir, engines, bridgeEngines, store, settings);
    return;
  }
  const proxied = u.pathname.match(/^\/oc\/i\/([^/]+)(\/.*)?$/);
  if (proxied) {
    const instanceId = decodeURIComponent(proxied[1] ?? "");
    if (!(await store.get(instanceId))) {
      json(res, { error: "Agente não encontrado." }, 404);
      return;
    }
    const engine = await engines.get(instanceId);
    proxy(req, res, (proxied[2] || "/") + u.search, engine.port);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    methodNotAllowed(res);
    return;
  }
  await serveStatic(u.pathname, res);
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  u: URL,
  catalog: Hefesto,
  catalogDir: string,
  engines: EngineManager,
  bridgeEngines: EngineManager,
  store: InstanceStore,
  settings: SettingsStore,
): Promise<void> {
  const seg = u.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (seg[1] === "status" && seg.length === 2) {
    if (method !== "GET") return methodNotAllowed(res);
    const status = await catalog.status();
    let opencode: { ok: boolean; version?: string; error?: string };
    try {
      const health = await catalog.client.health(2_500);
      opencode = { ok: health.healthy, version: health.version };
    } catch (e) {
      opencode = { ok: false, version: status.version, error: (e as Error).message };
    }
    json(res, { ...status, appVersion: APP_VERSION, opencode });
    return;
  }

  if (seg[1] === "update" && seg.length === 2) {
    if (method !== "GET") return methodNotAllowed(res);
    json(res, await checkForUpdate());
    return;
  }

  if (seg[1] === "provider-catalog" && seg.length === 2) {
    if (method !== "GET") return methodNotAllowed(res);
    const providers = await catalogProviders(catalog, catalogDir);
    if (u.searchParams.get("meta") === "1") {
      json(res, { providers: providers.map(({ id, name }) => ({ id, name })) });
      return;
    }
    json(res, { providers });
    return;
  }

  if (seg[1] === "connectors" && seg.length === 3 && seg[2] === "catalog") {
    if (method !== "GET") return methodNotAllowed(res);
    json(res, { connectors: catalogViews() });
    return;
  }

  if (seg[1] === "settings" && seg.length === 4 && seg[2] === "connectors" && seg[3] === "defaults") {
    if (method === "GET") {
      json(res, { defaultConnectors: (await settings.get()).defaultConnectors });
      return;
    }
    if (method === "PUT") {
      const body = await readJson(req);
      if (!body || typeof body !== "object") throw new HttpError(400, "payload inválido");
      let ids: string[];
      try {
        ids = parseDefaultConnectorIds((body as Record<string, unknown>).defaultConnectors);
      } catch (e) {
        if (e instanceof ConnectorError) throw new HttpError(400, e.message);
        throw e;
      }
      json(res, { defaultConnectors: (await settings.setDefaultConnectors(ids)).defaultConnectors });
      return;
    }
    return methodNotAllowed(res);
  }

  if (seg[1] !== "instances") return notFound(res);

  if (seg.length === 2) {
    if (method === "GET") {
      json(res, { instances: (await store.list()).map(publicInstance) });
      return;
    }
    if (method === "POST") {
      const body = await readJson(req);
      const input = parseInstanceInput(body, false) as InstanceInput;
      if (input.connectors === undefined) input.connectors = [];
      const auth = parseAuth(body);
      let instance = await store.create(input);
      try {
        const engine = await engines.get(instance.id);
        if (auth) await engine.client.setAuth(auth.providerID, auth.key);
        const model = instance.model ?? (await pickModel(engine, auth?.providerID));
        if (model) instance = (await store.update(instance.id, { model })) ?? instance;
        const session = await engine.client.createSession({
          title: instance.name,
          agent: "hefesto",
        });
        instance = (await store.setSession(instance.id, session.id)) ?? instance;
      } catch (e) {
        await engines.stop(instance.id);
        await store.remove(instance.id);
        throw new HttpError(400, `não foi possível iniciar o agente: ${(e as Error).message}`);
      }
      await syncBridgeEngine(bridgeEngines, store, instance.id);
      json(res, { instance: publicInstance(instance) }, 201);
      return;
    }
    return methodNotAllowed(res);
  }

  if (seg.length < 3) return notFound(res);
  const id = decodeURIComponent(seg[2] ?? "");

  if (seg.length === 3) {
    if (method === "GET") {
      const instance = await store.get(id);
      if (!instance) return notFound(res);
      json(res, { instance: publicInstance(instance) });
      return;
    }
    if (method === "PATCH" || method === "PUT") {
      const patch = parseInstanceInput(await readJson(req), true);
      const before = await store.get(id);
      const instance = await store.update(id, patch);
      if (!instance) return notFound(res);
      const connectorsChanged =
        patch.connectors !== undefined &&
        JSON.stringify(before?.connectors) !== JSON.stringify(instance.connectors);
      const identityChanged = before?.systemPrompt !== instance.systemPrompt;
      if (connectorsChanged || identityChanged) {
        await restartEngine(engines, id);
      }
      await syncBridgeEngine(bridgeEngines, store, id);
      json(res, { instance: publicInstance(instance) });
      return;
    }
    if (method === "DELETE") {
      if (!(await store.remove(id))) return notFound(res);
      await engines.stop(id);
      await bridgeEngines.stop(id);
      if (u.searchParams.get("keepHistory") !== "1") {
        await rm(engines.dir(id), { recursive: true, force: true });
        await rm(bridgeEngines.dir(id), { recursive: true, force: true });
      }
      res.writeHead(204);
      res.end();
      return;
    }
    return methodNotAllowed(res);
  }

  if (seg.length === 4 && seg[3] === "bridge") {
    if (method !== "POST") return methodNotAllowed(res);
    const instance = await store.get(id);
    if (!instance) return notFound(res);
    const body = await readJson(req, 32_000);
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 20_000) : "";
    if (!text) throw new HttpError(400, "mensagem vazia");
    const author = typeof body.author === "string" ? body.author.trim().slice(0, 120) : "";
    const guild = typeof body.guild === "string" ? body.guild.trim().slice(0, 200) : "";
    const channel = typeof body.channel === "string" ? body.channel.trim().slice(0, 200) : "";
    const tier: 1 | 2 | 3 = body.tier === 3 ? 3 : body.tier === 2 ? 2 : 1;
    const agent = tier === 3 ? "hefesto" : tier === 2 ? "hefesto-bridge" : "hefesto-chat";
    const systemPrompt =
      tier === 3
        ? buildAgentPrompt(instance.systemPrompt)
        : tier === 2
          ? buildBridgeAdminPrompt(instance.systemPrompt)
          : buildDiscordChatPrompt(instance.systemPrompt);
    const context = [
      "Você está respondendo a uma mensagem recebida no Discord.",
      author ? `Autor: ${author}` : "",
      guild ? `Servidor: ${guild}` : "Conversa direta",
      channel ? `Canal: ${channel}` : "",
      tier === 3
        ? "Responda em texto, de forma breve e direta."
        : "Responda em texto, de forma breve e direta. Não use ferramentas de envio de mensagens do Discord; o Hefesto enviará sua resposta no canal.",
    ]
      .filter(Boolean)
      .join("\n");

    const engine =
      tier === 3
        ? await engines.get(instance.id)
        : await bridgeEngines.get(instance.id);
    const currentSettings = await settings.get();
    const activeConnectors = resolveConnectors(
      instance.connectors,
      currentSettings.defaultConnectors,
    );
    const tools: Record<string, boolean> | undefined = tier === 3 ? undefined : {};
    if (tools) {
      for (const name of HOST_TOOL_NAMES) tools[name] = false;
      for (const connector of activeConnectors) {
        if (!connector.enabled) continue;
        const isDiscord =
          (connector.definitionId ?? connector.alias).toLowerCase() === "discord";
        const definition = connectorDefinition(connector.definitionId ?? connector.alias);
        const connectorTools = connector.tools ?? definition?.tools ?? [];
        for (const tool of connectorTools) {
          const name = `${connector.alias}_${tool.name}`;
          if (isDiscord) {
            tools[name] =
              tier === 1
                ? SAFE_DISCORD_TOOL_NAMES.has(tool.name)
                : !SEND_TOOL_NAMES.has(tool.name) &&
                  !OWNER_ONLY_DISCORD_TOOL_NAMES.has(tool.name);
          } else {
            tools[name] = false;
          }
        }
      }
    }

    const bridgeKey = [
      instance.id,
      body.isDm === true ? "dm" : String(body.guildId ?? ""),
      body.isDm === true ? "" : String(body.channelId ?? ""),
      String(body.authorId ?? ""),
    ].join(":");
    let sessionId = bridgeSessions.get(bridgeKey);
    if (!sessionId) {
      const session = await engine.client.createSession({
        title: `Discord ${author || "usuario"}`,
        agent,
      });
      sessionId = session.id;
      bridgeSessions.set(bridgeKey, sessionId);
      if (bridgeSessions.size > 500) {
        const first = bridgeSessions.keys().next().value;
        if (first) bridgeSessions.delete(first);
      }
    }

    const prompt = {
      parts: [{ type: "text" as const, text }],
      agent,
      model: instance.model,
      system: `${systemPrompt}\n\n${context}`,
      ...(tools ? { tools } : {}),
    };
    let result;
    try {
      result = await engine.client.sendPrompt(sessionId, prompt);
    } catch (e) {
      if (!/404|not found/i.test((e as Error).message)) throw e;
      const session = await engine.client.createSession({
        title: `Discord ${author || "usuario"}`,
        agent,
      });
      sessionId = session.id;
      bridgeSessions.set(bridgeKey, sessionId);
      result = await engine.client.sendPrompt(sessionId, prompt);
    }
    const sentWithTool = (result.parts ?? []).some((part) => {
      if (part.type !== "tool") return false;
      if (!/(?:^|_)send_(thread_)?message$/i.test(String((part as { tool?: unknown }).tool ?? ""))) {
        return false;
      }
      const state = (part as { state?: { status?: string } }).state;
      return state?.status !== "error";
    });
    const reply = (result.parts ?? [])
      .map((part) =>
        part.type === "text" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n\n")
      .trim();
    json(res, { reply: sentWithTool ? "" : reply, sent: sentWithTool });
    return;
  }

  if (seg.length === 4 && seg[3] === "providers" && method === "GET") {
    const instance = await store.get(id);
    if (!instance) return notFound(res);
    const engine = await engines.get(id);
    json(res, { providers: (await engine.availableProviders()).map(publicProvider) });
    return;
  }

  if (seg.length === 6 && seg[3] === "providers" && seg[5] === "auth" && method === "PUT") {
    const instance = await store.get(id);
    if (!instance) return notFound(res);
    const providerID = decodeURIComponent(seg[4] ?? "");
    const body = await readJson(req, 64_000);
    const key = typeof body.key === "string" ? body.key.trim() : "";
    if (!key) throw new HttpError(400, "informe a chave da API");
    const engine = await engines.get(id);
    await engine.client.setAuth(providerID, key);
    await syncBridgeEngine(bridgeEngines, store, id);
    const providers = (await engine.availableProviders()).map(publicProvider);
    let updated = instance;
    if (!instance.model) {
      const provider = providers.find((p) => p.id === providerID && p.models.length > 0);
      const model = provider?.models[0];
      if (model) updated = (await store.update(id, { model: { providerID, modelID: model.id } })) ?? instance;
    }
    json(res, { ok: true, providers, instance: updated ? publicInstance(updated) : undefined });
    return;
  }

  if (seg.length === 4 && seg[3] === "connectors") {
    const instance = await store.get(id);
    if (!instance) return notFound(res);
    if (method === "GET") {
      const defaults = (await settings.get()).defaultConnectors;
      const engine = await engines.get(id);
      json(res, {
        connectors: await connectorViews(instance.connectors, defaults, engine.client),
      });
      return;
    }
    if (method === "POST") {
      const connector = readConnector(await readJson(req));
      const defaults = (await settings.get()).defaultConnectors;
      const current = resolveConnectors(instance.connectors, defaults);
      if (current.some((item) => item.alias.toLowerCase() === connector.alias.toLowerCase())) {
        throw new HttpError(400, `conector ${connector.alias} já existe`);
      }
      const updated = await store.update(id, { connectors: [...current, connector] });
      await restartEngine(engines, id);
      await syncBridgeEngine(bridgeEngines, store, id);
      const payload = await connectorsPayload(id, store, settings, engines);
      json(res, { connectors: payload?.connectors ?? [], instance: updated ? publicInstance(updated) : undefined }, 201);
      return;
    }
    return methodNotAllowed(res);
  }

  if (seg.length === 5 && seg[3] === "connectors") {
    const instance = await store.get(id);
    if (!instance) return notFound(res);
    const alias = decodeURIComponent(seg[4] ?? "");
    if (method === "PATCH") {
      const body = await readJson(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        throw new HttpError(400, "payload inválido");
      }
      const defaults = (await settings.get()).defaultConnectors;
      const previous = resolveConnectors(instance.connectors, defaults).find(
        (item) => item.alias.toLowerCase() === alias.toLowerCase(),
      );
      const connector = readConnector({ ...(body as Record<string, unknown>), alias }, alias, previous);
      const current = resolveConnectors(instance.connectors, defaults).map((item) =>
        item.alias.toLowerCase() === alias.toLowerCase() ? connector : item,
      );
      const updated = await store.update(id, { connectors: current });
      await restartEngine(engines, id);
      await syncBridgeEngine(bridgeEngines, store, id);
      const payload = await connectorsPayload(id, store, settings, engines);
      json(res, { connectors: payload?.connectors ?? [], instance: updated ? publicInstance(updated) : undefined });
      return;
    }
    if (method === "DELETE") {
      const defaults = (await settings.get()).defaultConnectors;
      const current = resolveConnectors(instance.connectors, defaults).filter(
        (item) => item.alias.toLowerCase() !== alias.toLowerCase(),
      );
      await store.update(id, { connectors: current });
      await restartEngine(engines, id);
      await syncBridgeEngine(bridgeEngines, store, id);
      const payload = await connectorsPayload(id, store, settings, engines);
      json(res, { connectors: payload?.connectors ?? [] });
      return;
    }
    return methodNotAllowed(res);
  }

  if (
    seg.length === 6 &&
    seg[3] === "connectors" &&
    (seg[5] === "connect" || seg[5] === "disconnect") &&
    method === "POST"
  ) {
    if (!(await store.get(id))) return notFound(res);
    const alias = decodeURIComponent(seg[4] ?? "");
    const engine = await engines.get(id);
    const ok =
      seg[5] === "connect"
        ? await engine.client.mcpConnect(alias)
        : await engine.client.mcpDisconnect(alias);
    const payload = await connectorsPayload(id, store, settings, engines);
    json(res, { ok, connectors: payload?.connectors ?? [] });
    return;
  }

  if (seg.length === 4 && seg[3] === "session" && method === "POST") {
    const instance = await store.get(id);
    if (!instance) return notFound(res);
    const engine = await engines.get(id);
    if (instance.sessionId) {
      try {
        await engine.client.switchAgent(instance.sessionId, "hefesto");
        const session = await engine.client.getSession(instance.sessionId);
        const rules = Array.isArray(session.permission)
          ? (session.permission as Array<{ permission?: unknown; pattern?: unknown; action?: unknown }>)
          : [];
        const staleSendDeny = rules.some(
          (rule) =>
            rule.action === "deny" &&
            /(?:^|_)send_(thread_)?message$/i.test(String(rule.permission ?? "")),
        );
        if (staleSendDeny) {
          const messages = await engine.client.listMessages(instance.sessionId);
          const lastMessageID = messages.at(-1)?.info?.id;
          const forked = await engine.client.forkSession(instance.sessionId, lastMessageID);
          await engine.client.switchAgent(forked.id, "hefesto");
          await store.setSession(id, forked.id);
          json(res, { sessionId: forked.id });
          return;
        }
      } catch {
        /* versões antigas sem troca de agente usam o agente do prompt */
      }
      json(res, { sessionId: instance.sessionId });
      return;
    }
    const session = await engine.client.createSession({ title: instance.name, agent: "hefesto" });
    await store.setSession(id, session.id);
    json(res, { sessionId: session.id });
    return;
  }

  if (seg.length === 4 && seg[3] === "reset" && method === "POST") {
    const instance = await store.setSession(id, undefined);
    if (!instance) return notFound(res);
    json(res, { ok: true });
    return;
  }

  if (seg.length === 4 && seg[3] === "abort" && method === "POST") {
    const instance = await store.get(id);
    if (!instance) return notFound(res);
    if (!instance.sessionId) {
      json(res, { ok: true, aborted: false });
      return;
    }
    try {
      const engine = await engines.get(id);
      const aborted = await engine.client.abortSession(instance.sessionId);
      json(res, { ok: true, aborted });
    } catch (e) {
      if (/404/.test((e as Error).message)) {
        await store.setSession(id, undefined);
        json(res, { ok: true, aborted: false, stale: true });
        return;
      }
      throw e;
    }
    return;
  }

  return notFound(res);
}

interface UpdateInfo {
  checkedAt: string;
  current: string;
  latest?: string;
  url?: string;
  available: boolean;
  error?: string;
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number(part) || 0);
  const right = b.split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate(): Promise<UpdateInfo> {
  const current = APP_VERSION;
  if (current === "0.0.0") {
    return { checkedAt: new Date().toISOString(), current, available: false };
  }
  const cacheFile = join(DATA_DIR, "update-check.json");
  try {
    const cached = JSON.parse(await readFile(cacheFile, "utf8")) as UpdateInfo;
    const age = Date.now() - new Date(cached.checkedAt).getTime();
    const ttl = cached.error ? UPDATE_ERROR_TTL_MS : UPDATE_TTL_MS;
    if (cached.current === current && age >= 0 && age < ttl) return cached;
  } catch {
    /* sem cache */
  }
  let result: UpdateInfo;
  try {
    const res = await fetch(RELEASES_LATEST, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Hefesto" },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const data = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const latest = String(data.tag_name ?? "").replace(/^v/, "");
    result = {
      checkedAt: new Date().toISOString(),
      current,
      latest: latest || undefined,
      url: typeof data.html_url === "string" ? data.html_url : undefined,
      available: Boolean(latest) && compareVersions(latest, current) > 0,
    };
  } catch (e) {
    result = {
      checkedAt: new Date().toISOString(),
      current,
      available: false,
      error: (e as Error).message,
    };
  }
  try {
    await writeFile(cacheFile, JSON.stringify(result, null, 2), "utf8");
  } catch {
    /* cache é opcional */
  }
  return result;
}

async function restartEngine(engines: EngineManager, id: string): Promise<Hefesto> {
  await engines.stop(id);
  return engines.get(id);
}

function readConnector(body: unknown, alias?: string, previous?: InstanceConnector) {
  try {
    return parseConnectorInput(body, alias, previous);
  } catch (e) {
    if (e instanceof ConnectorError) throw new HttpError(400, e.message);
    throw e;
  }
}

async function connectorsPayload(
  id: string,
  store: InstanceStore,
  settings: SettingsStore,
  engines: EngineManager,
) {
  const instance = await store.get(id);
  if (!instance) return undefined;
  const defaults = (await settings.get()).defaultConnectors;
  const engine = await engines.get(id);
  return { connectors: await connectorViews(instance.connectors, defaults, engine.client) };
}

const BUILTIN_FREE_PROVIDERS = new Set(["opencode"]);

function modelIsFree(info: unknown, providerID: string): boolean {
  if (!BUILTIN_FREE_PROVIDERS.has(providerID)) return false;
  if (!info || typeof info !== "object") return false;
  const cost = (info as { cost?: { input?: number; output?: number } }).cost;
  return Boolean(cost && cost.input === 0 && cost.output === 0);
}

function publicProvider(p: ProviderInfo) {
  const env = p.env ?? [];
  const models = Object.entries(p.models ?? {}).map(([id, info]) => ({
    id,
    name: info.name ?? id,
    free: modelIsFree(info, p.id),
  }));
  const publicApi = p.options?.apiKey === "public";
  const credentialed = Boolean(p.key) || p.source === "api";
  return {
    id: p.id,
    name: p.name,
    source: p.source,
    env,
    public: publicApi,
    credentialed,
    configured: credentialed || publicApi,
    models,
  };
}

interface CatalogModel {
  id: string;
  name: string;
  free: boolean;
  available: boolean;
}

interface CatalogProvider {
  id: string;
  name: string;
  models: CatalogModel[];
}

async function catalogProviders(catalog: Hefesto, catalogDir: string): Promise<CatalogProvider[]> {
  let live: ProviderInfo[] = [];
  try {
    live = await catalog.availableProviders();
  } catch {
    /* catálogo indisponível */
  }
  const available = new Map<string, Set<string>>();
  for (const provider of live) {
    available.set(provider.id, new Set(Object.keys(provider.models ?? {})));
  }
  try {
    const raw = JSON.parse(
      await readFile(join(catalogDir, "cache", "opencode", "models.json"), "utf8"),
    ) as Record<string, { name?: string; models?: Record<string, { name?: string; cost?: unknown }> }>;
    return Object.entries(raw)
      .map(([id, provider]) => ({
        id,
        name: provider.name ?? id,
        models: Object.entries(provider.models ?? {}).map(([modelID, model]) => ({
          id: modelID,
          name: model.name ?? modelID,
          free: modelIsFree(model, id),
          available: available.get(id)?.has(modelID) ?? false,
        })),
      }))
      .filter((p) => p.models.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return live
      .map((p) => ({
        id: p.id,
        name: p.name,
        models: Object.entries(p.models ?? {}).map(([id, info]) => ({
          id,
          name: info.name ?? id,
          free: modelIsFree(info, p.id),
          available: true,
        })),
      }))
      .filter((p) => p.models.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

function parseAuth(body: Record<string, unknown>): { providerID: string; key: string } | undefined {
  const raw = body.auth;
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") throw new HttpError(400, "auth inválido");
  const { providerID, key } = raw as Record<string, unknown>;
  if (typeof providerID !== "string" || !providerID.trim()) throw new HttpError(400, "provedor inválido");
  if (typeof key !== "string" || !key.trim()) throw new HttpError(400, "informe a chave do provedor");
  return { providerID: providerID.trim().slice(0, 120), key: key.trim().slice(0, 8000) };
}

async function pickModel(engine: Hefesto, preferredProvider?: string): Promise<ModelRef | undefined> {
  const { providers } = await engine.client.listProviders();
  const ready = providers.filter((p) => p.models && Object.keys(p.models).length > 0);
  const preferred = preferredProvider ? ready.find((p) => p.id === preferredProvider) : undefined;
  const provider = preferred ?? ready.find((p) => p.id === "opencode") ?? ready[0];
  const modelID = provider?.models ? Object.keys(provider.models)[0] : undefined;
  return provider && modelID ? { providerID: provider.id, modelID } : undefined;
}

async function readJson(req: http.IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpError(413, "payload muito grande");
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

function proxy(req: http.IncomingMessage, res: http.ServerResponse, targetPath: string, targetPort: number): void {
  const opts = {
    hostname: "127.0.0.1",
    port: targetPort,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${targetPort}` },
  };
  const p = http.request(opts, (pr) => {
    const h = { ...pr.headers };
    if (targetPath.split("?")[0] === "/event") h["content-type"] = "text/event-stream";
    delete h["transfer-encoding"];
    res.writeHead(pr.statusCode ?? 200, h);
    pr.pipe(res);
  });
  p.on("error", () => {
    if (!res.headersSent) json(res, { error: "O opencode está indisponível." }, 502);
    else res.end();
  });
  res.on("close", () => {
    if (!res.writableEnded) p.destroy();
  });
  req.pipe(p);
}

async function serveStatic(pathname: string, res: http.ServerResponse): Promise<void> {
  const file = pathname === "/" ? "index.html" : pathname.slice(1);
  const full = resolve(WEB_DIST, file);
  if (full !== WEB_DIST && !full.startsWith(WEB_DIST + sep)) {
    notFound(res);
    return;
  }
  try {
    let target = full;
    const s = await stat(target);
    if (s.isDirectory()) target = join(target, "index.html");
    const body = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      ...(type.startsWith("text/html") ? { "Cache-Control": "no-store" } : {}),
    });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(WEB_DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("build da web não encontrado. rode npm run build");
    }
  }
}

function notFound(res: http.ServerResponse): void {
  json(res, { error: "Não encontrado." }, 404);
}

function methodNotAllowed(res: http.ServerResponse): void {
  json(res, { error: "Método não permitido." }, 405);
}

function json(res: http.ServerResponse, data: unknown, code = 200): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

main().catch((e) => {
  console.error("[hefesto-server] fatal:", e);
  process.exit(1);
});
