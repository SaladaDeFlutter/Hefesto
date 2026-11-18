import http from "node:http";
import { mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Hefesto } from "../../core/src/index.ts";
import { EngineManager, isolatedEnv } from "../../core/src/engines.ts";
import type { ModelRef, ProviderInfo } from "../../engine/src/index.ts";
import { InstanceStore, parseInstanceInput, type InstanceInput } from "./instances.ts";
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

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

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
  const catalogDir = join(DATA_DIR, "catalog");
  await mkdir(catalogDir, { recursive: true });
  const catalog = await Hefesto.start({ registerConnectors: true, env: isolatedEnv(catalogDir) });
  const engines = new EngineManager(join(DATA_DIR, "engines"));
  const status = await catalog.status();
  console.log(
    `catálogo opencode ${status.version ?? "?"} na porta ${status.port} · discord ${status.connector.registered ? "registrado" : "indisponível"}`,
  );

  const server = http.createServer((req, res) => {
    handle(req, res, catalog, catalogDir, engines, store).catch((e: unknown) => {
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

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await Promise.all([engines.stopAll(), catalog.stop()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  catalog: Hefesto,
  catalogDir: string,
  engines: EngineManager,
  store: InstanceStore,
): Promise<void> {
  const u = new URL(req.url ?? "/", "http://x");
  if (u.pathname === "/api" || u.pathname.startsWith("/api/")) {
    await handleApi(req, res, u, catalog, catalogDir, engines, store);
    return;
  }
  const proxied = u.pathname.match(/^\/oc\/i\/([^/]+)(\/.*)?$/);
  if (proxied) {
    const instanceId = decodeURIComponent(proxied[1] ?? "");
    if (!(await store.get(instanceId))) {
      json(res, { error: "instância não encontrada" }, 404);
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
  store: InstanceStore,
): Promise<void> {
  const seg = u.pathname.split("/").filter(Boolean);
  const method = req.method ?? "GET";

  if (seg[1] === "status" && seg.length === 2) {
    if (method !== "GET") return methodNotAllowed(res);
    json(res, await catalog.status());
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

  if (seg[1] !== "instances") return notFound(res);

  if (seg.length === 2) {
    if (method === "GET") {
      json(res, { instances: await store.list() });
      return;
    }
    if (method === "POST") {
      const body = await readJson(req);
      const input = parseInstanceInput(body, false) as InstanceInput;
      const auth = parseAuth(body);
      let instance = await store.create(input);
      try {
        const engine = await engines.get(instance.id);
        if (auth) await engine.client.setAuth(auth.providerID, auth.key);
        const model = instance.model ?? (await pickModel(engine, auth?.providerID));
        if (model) instance = (await store.update(instance.id, { model })) ?? instance;
        const session = await engine.client.createSession({ title: instance.name });
        instance = (await store.setSession(instance.id, session.id)) ?? instance;
      } catch (e) {
        await engines.stop(instance.id);
        await store.remove(instance.id);
        throw new HttpError(400, `não foi possível iniciar a instância: ${(e as Error).message}`);
      }
      json(res, { instance }, 201);
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
      json(res, { instance });
      return;
    }
    if (method === "PATCH" || method === "PUT") {
      const patch = parseInstanceInput(await readJson(req), true);
      const instance = await store.update(id, patch);
      if (!instance) return notFound(res);
      json(res, { instance });
      return;
    }
    if (method === "DELETE") {
      if (!(await store.remove(id))) return notFound(res);
      await engines.stop(id);
      res.writeHead(204);
      res.end();
      return;
    }
    return methodNotAllowed(res);
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
    const providers = (await engine.availableProviders()).map(publicProvider);
    let updated = instance;
    if (!instance.model) {
      const provider = providers.find((p) => p.id === providerID && p.models.length > 0);
      const model = provider?.models[0];
      if (model) updated = (await store.update(id, { model: { providerID, modelID: model.id } })) ?? instance;
    }
    json(res, { ok: true, providers, instance: updated });
    return;
  }

  if (seg.length === 4 && seg[3] === "session" && method === "POST") {
    const instance = await store.get(id);
    if (!instance) return notFound(res);
    if (instance.sessionId) {
      json(res, { sessionId: instance.sessionId });
      return;
    }
    const engine = await engines.get(id);
    const session = await engine.client.createSession({ title: instance.name });
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

function modelIsFree(info: unknown): boolean {
  if (!info || typeof info !== "object") return false;
  const cost = (info as { cost?: { input?: number; output?: number } }).cost;
  return Boolean(cost && cost.input === 0 && cost.output === 0);
}

function publicProvider(p: ProviderInfo) {
  const env = p.env ?? [];
  const models = Object.entries(p.models ?? {}).map(([id, info]) => ({
    id,
    name: info.name ?? id,
    free: modelIsFree(info),
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
}

interface CatalogProvider {
  id: string;
  name: string;
  models: CatalogModel[];
}

let catalogCache: CatalogProvider[] | undefined;

async function catalogProviders(catalog: Hefesto, catalogDir: string): Promise<CatalogProvider[]> {
  if (catalogCache) return catalogCache;
  try {
    const raw = JSON.parse(
      await readFile(join(catalogDir, "cache", "opencode", "models.json"), "utf8"),
    ) as Record<string, { name?: string; models?: Record<string, { name?: string; cost?: unknown }> }>;
    catalogCache = Object.entries(raw)
      .map(([id, provider]) => ({
        id,
        name: provider.name ?? id,
        models: Object.entries(provider.models ?? {}).map(([modelID, model]) => ({
          id: modelID,
          name: model.name ?? modelID,
          free: modelIsFree(model),
        })),
      }))
      .filter((p) => p.models.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    catalogCache = (await catalog.availableProviders())
      .map((p) => ({
        id: p.id,
        name: p.name,
        models: Object.entries(p.models ?? {}).map(([id, info]) => ({
          id,
          name: info.name ?? id,
          free: modelIsFree(info),
        })),
      }))
      .filter((p) => p.models.length > 0);
  }
  return catalogCache;
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
    if (!res.headersSent) json(res, { error: "motor opencode indisponível" }, 502);
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
    res.writeHead(200, { "Content-Type": MIME[extname(target).toLowerCase()] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    try {
      const body = await readFile(join(WEB_DIST, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("build da web não encontrado. rode npm run build");
    }
  }
}

function notFound(res: http.ServerResponse): void {
  json(res, { error: "não encontrado" }, 404);
}

function methodNotAllowed(res: http.ServerResponse): void {
  json(res, { error: "método não permitido" }, 405);
}

function json(res: http.ServerResponse, data: unknown, code = 200): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

main().catch((e) => {
  console.error("[hefesto-server] fatal:", e);
  process.exit(1);
});
