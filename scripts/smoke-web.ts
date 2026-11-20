import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SMOKE_PORT ?? 4199);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = mkdtempSync(join(tmpdir(), "hefesto-smoke-"));

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitServer(deadline: number): Promise<any> {
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/status`);
      if (r.ok) return await r.json();
    } catch {
      /* not ready yet */
    }
    await sleep(300);
  }
  throw new Error("server did not become ready");
}

async function jsonReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return data as T;
}

async function main() {
  const child = spawn(process.execPath, [resolve(__dirname, "../packages/server/src/index.ts")], {
    env: { ...process.env, PORT: String(PORT), HEFESTO_DATA_DIR: DATA_DIR },
    stdio: ["ignore", "inherit", "inherit"],
  });

  const cleanup = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  };
  process.on("exit", cleanup);

  try {
    const st = await waitServer(Date.now() + 60_000);
    console.log("STATUS", JSON.stringify(st));
    if ((st.connectors ?? []).length > 0) throw new Error("a engine do catálogo não deve registrar conectores");
    if (!st.appVersion) throw new Error("status sem appVersion");
    if (!st.opencode || st.opencode.ok !== true) throw new Error("status sem saúde do opencode");

    const page = await fetch(`${BASE}/`);
    const html = await page.text();
    console.log("WEB", page.status, page.headers.get("content-type"), html.includes("Hefesto") ? "ascii-ok" : "sem-marca");
    if (page.status !== 200 || !page.headers.get("content-type")?.includes("text/html")) {
      throw new Error("landing não respondeu HTML 200");
    }

    const catalog = await jsonReq<{ providers: Array<{ id: string; name: string }> }>("GET", "/api/provider-catalog?meta=1");
    console.log("CATALOG", catalog.providers.length);
    if (catalog.providers.length === 0) throw new Error("catálogo de provedores vazio");
    if (JSON.stringify(catalog).includes('"key"')) throw new Error("provider key vazou no catálogo");

    const modelCatalog = await jsonReq<{
      providers: Array<{ id: string; models: Array<{ id: string; free: boolean }> }>;
    }>("GET", "/api/provider-catalog");
    const freeProviderIds = modelCatalog.providers
      .filter((provider) => provider.models.some((model) => model.free))
      .map((provider) => provider.id);
    console.log("FREE PROVIDERS", freeProviderIds.join(","));
    if (freeProviderIds.some((id) => !["opencode", "opencode-go"].includes(id))) {
      throw new Error("modelos gratuitos fora do pacote embutido do opencode");
    }

    const connectorCatalog = await jsonReq<{
      connectors: Array<{
        id: string;
        tools: Array<{ name: string }>;
        fields: Array<{ key: string; secret?: boolean }>;
      }>;
    }>("GET", "/api/connectors/catalog");
    console.log("CONNECTOR CATALOG", connectorCatalog.connectors.map((c) => c.id).join(","));
    const discordDef = connectorCatalog.connectors.find((c) => c.id === "discord");
    if (!discordDef || discordDef.tools.length !== 34) {
      throw new Error("o conector discord deve expor as 34 ferramentas");
    }
    if (!discordDef.fields.some((field) => field.key === "token" && field.secret)) {
      throw new Error("o conector discord deve declarar o token como secreto");
    }

    const defaults = await jsonReq<{ defaultConnectors: string[] }>("GET", "/api/settings/connectors/defaults");
    console.log("DEFAULT CONNECTORS", defaults.defaultConnectors.join(","));
    if (defaults.defaultConnectors.length !== 0) {
      throw new Error("instalação nova não deve ter conectores padrão");
    }

    const created = await jsonReq<{ instance: any }>("POST", "/api/instances", {
      name: "Smoke Test",
      tagline: "instância de teste",
      personality: "direto e técnico",
      instructions: "responda em português",
      accent: "#38bdf8",
      connectors: [{ alias: "discord", definitionId: "discord", enabled: true }],
    });
    console.log("INSTANCE", created.instance.id);
    const iid = encodeURIComponent(created.instance.id);
    if (!created.instance.systemPrompt?.includes("Smoke Test")) throw new Error("systemPrompt não foi gerado");

    const instanceConnectors = await jsonReq<{
      connectors: Array<{ alias: string; definitionId?: string; status: string }>;
    }>("GET", `/api/instances/${iid}/connectors`);
    console.log(
      "INSTANCE CONNECTORS",
      instanceConnectors.connectors.map((c) => `${c.alias}:${c.status}`).join(","),
    );
    if (!instanceConnectors.connectors.some((c) => c.definitionId === "discord")) {
      throw new Error("instância não recebeu o conector discord explícito");
    }

    const plain = await jsonReq<{ instance: any }>("POST", "/api/instances", {
      name: "Smoke Sem Conectores",
    });
    const plainConnectors = await jsonReq<{ connectors: Array<{ alias: string }> }>(
      "GET",
      `/api/instances/${encodeURIComponent(plain.instance.id)}/connectors`,
    );
    console.log("PLAIN INSTANCE CONNECTORS", plainConnectors.connectors.length);
    if (plainConnectors.connectors.length !== 0) {
      throw new Error("instância nova herdou conectores padrão");
    }
    await fetch(`${BASE}/api/instances/${plain.instance.id}`, { method: "DELETE" });
    const plainEngineDir = join(DATA_DIR, "engines", plain.instance.id);
    if (existsSync(plainEngineDir)) throw new Error("engine do agente excluído não foi removida");

    const saved = await jsonReq<{ connectors: Array<{ secrets?: string[] }> }>(
      "PATCH",
      `/api/instances/${iid}/connectors/discord`,
      { config: { token: "smoke-token-secreto" } },
    );
    if (JSON.stringify(saved).includes("smoke-token-secreto")) {
      throw new Error("token do bot vazou na resposta da API");
    }
    if (!saved.connectors.some((c) => c.secrets?.includes("token"))) {
      throw new Error("token do bot não foi registrado como secreto");
    }
    const afterClear = await jsonReq<{ connectors: Array<{ secrets?: string[] }> }>(
      "PATCH",
      `/api/instances/${iid}/connectors/discord`,
      { config: { token: null } },
    );
    if (afterClear.connectors.some((c) => c.secrets?.includes("token"))) {
      throw new Error("não foi possível limpar o token do bot");
    }

    const added = await jsonReq<{ connectors: Array<{ alias: string }> }>(
      "POST",
      `/api/instances/${iid}/connectors`,
      { alias: "smoke-custom", transport: { type: "remote", url: "http://127.0.0.1:9/mcp" } },
    );
    if (!added.connectors.some((c) => c.alias === "smoke-custom")) throw new Error("add conector falhou");
    await jsonReq("DELETE", `/api/instances/${iid}/connectors/smoke-custom`);

    const prov = await jsonReq<{ providers: Array<{ id: string; credentialed?: boolean }> }>(
      "GET",
      `/api/instances/${iid}/providers`,
    );
    const configured = prov.providers.filter((p) => p.credentialed).map((p) => p.id);
    console.log("ISOLATED PROVIDERS", prov.providers.length, "configurados:", JSON.stringify(configured));
    if (JSON.stringify(prov).includes('"key"')) throw new Error("provider key vazou na API pública");
    if (configured.length > 0) {
      throw new Error(`instância isolada herdou credenciais: ${configured.join(", ")}`);
    }

    const patched = await jsonReq<{ instance: any }>("PATCH", `/api/instances/${created.instance.id}`, {
      name: "Smoke Renomeado",
      tagline: "",
    });
    if (patched.instance.name !== "Smoke Renomeado") throw new Error("patch de nome falhou");
    if (patched.instance.tagline !== "") throw new Error("tagline não foi limpa");

    const sess = await jsonReq<{ sessionId: string }>("POST", `/api/instances/${created.instance.id}/session`);
    console.log("SESSION", sess.sessionId);

    const history = await jsonReq<any[]>("GET", `/oc/i/${iid}/session/${sess.sessionId}/message`);
    console.log("HISTORY", history.length);

    const statuses = await jsonReq<Record<string, { type: string }>>("GET", `/oc/i/${iid}/session/status`);
    console.log("STATUSES", Object.keys(statuses).length);

    const abort = await jsonReq<{ ok: boolean }>("POST", `/api/instances/${created.instance.id}/abort`);
    console.log("ABORT", JSON.stringify(abort));
    if (!abort.ok) throw new Error("abort falhou");

    const reset = await jsonReq<{ ok: boolean }>("POST", `/api/instances/${created.instance.id}/reset`);
    if (!reset.ok) throw new Error("reset falhou");

    const controller = new AbortController();
    const evRes = await fetch(`${BASE}/oc/i/${iid}/event`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = evRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const seenTools: string[] = [];
    let idle = false;

    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            let e: any;
            try {
              e = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            const p = e.properties ?? {};
            if (p.sessionID && p.sessionID !== sess.sessionId) continue;
            if (e.type === "message.part.updated" && p.part?.type === "tool") seenTools.push(String(p.part.tool));
            if (e.type === "session.status") idle = p.status?.type === "idle";
          }
        }
      } catch {
        /* aborted */
      }
    })();

    const [smProvider, ...smRest] = (process.env.SMOKE_MODEL ?? "").split("/");
    const model =
      smProvider && smRest.length ? { providerID: smProvider, modelID: smRest.join("/") } : st.defaultModel;
    console.log("MODEL", JSON.stringify(model));

    let called = false;
    const skipPrompt = process.env.SMOKE_SKIP_PROMPT === "1";
    if (model && !skipPrompt) {
      const promptRes = await fetch(`${BASE}/oc/i/${iid}/session/${sess.sessionId}/prompt_async`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [
            {
              type: "text",
              text: 'Use a ferramenta "discord_hora" para saber a hora atual. Depois responda apenas "feito".',
            },
          ],
          model,
        }),
      });
      console.log("PROMPT", promptRes.status);

      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        called = seenTools.some((t) => t.toLowerCase().includes("hora"));
        if (called && idle) break;
        await sleep(500);
      }
    } else {
      console.log(skipPrompt ? "PROMPT pulado (SMOKE_SKIP_PROMPT)" : "PROMPT pulado (nenhum modelo configurado)");
    }

    controller.abort();
    await pump;
    console.log("TOOLS", JSON.stringify(seenTools));

    await fetch(`${BASE}/api/instances/${created.instance.id}`, { method: "DELETE" });
    const after = await fetch(`${BASE}/api/instances/${created.instance.id}`);
    if (after.status !== 404) throw new Error("instância não foi removida");

    const requireTool = process.env.SMOKE_REQUIRE_TOOL === "1";
    if (model && !skipPrompt && !called) {
      console.log("SMOKE AVISO: o modelo não chamou a tool discord_hora (flaky por natureza)");
    }
    const ok = skipPrompt || !model ? true : !requireTool || called;
    console.log(ok ? "SMOKE OK" : "SMOKE FAIL (tool discord_hora não chamada)");
    cleanup();
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error("SMOKE ERROR", e);
    cleanup();
    process.exit(1);
  }
}

main();
