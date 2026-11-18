import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, accessSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenCodeClient, type ModelRef, type ProviderInfo } from "../../engine/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface HefestoOptions {
  opencodeBin?: string;
  port?: number;
  registerConnectors?: boolean;
  env?: Record<string, string>;
}

export interface HefestoStatus {
  running: boolean;
  port: number;
  baseUrl: string;
  version?: string;
  defaultModel?: ModelRef;
  connector: { registered: boolean; name?: string };
}

export class Hefesto {
  readonly client: OpenCodeClient;
  private child?: ChildProcess;
  private _port = 0;
  private _version?: string;
  private _defaultModel?: ModelRef;
  private connectorRegistered = false;

  private constructor(baseUrl: string) {
    this.client = new OpenCodeClient(baseUrl);
  }

  get port(): number {
    return this._port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this._port}`;
  }

  get version(): string | undefined {
    return this._version;
  }

  get defaultModel(): ModelRef | undefined {
    return this._defaultModel;
  }

  /**
   * Spawns `opencode serve` on a free port and waits until it is healthy.
   */
  static async start(opts: HefestoOptions = {}): Promise<Hefesto> {
    const port = opts.port ?? (await findFreePort());
    const bin = opts.opencodeBin ?? findExecutable("opencode");

    const child = spawn(bin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
      env: opts.env ?? process.env,
      stdio: ["ignore", "ignore", "inherit"],
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    const client = new OpenCodeClient(baseUrl);

    // Wait for health, up to 30s.
    let version: string | undefined;
    try {
      const deadline = Date.now() + 30_000;
      for (;;) {
        if (child.exitCode !== null) throw new Error(`opencode exited early with code ${child.exitCode}`);
        try {
          const h = await client.health();
          version = h.version;
          break;
        } catch {
          if (Date.now() > deadline) throw new Error("opencode serve did not become healthy in time");
          await sleep(250);
        }
      }
    } catch (e) {
      child.kill("SIGTERM");
      throw e;
    }

    const h = new Hefesto(baseUrl);
    h.child = child;
    h._port = port;
    h._version = version;
    h._defaultModel = await h.pickDefaultModel();

    if (opts.registerConnectors !== false) {
      await h.registerDiscordConnector();
    }

    return h;
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return;

    await new Promise<void>((resolveExit) => {
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolveExit();
      });
      child.kill("SIGTERM");
    });
  }

  private async pickDefaultModel(): Promise<ModelRef | undefined> {
    const override = process.env.HEFESTO_MODEL;
    if (override) {
      const [providerID, ...rest] = override.split("/");
      const modelID = rest.join("/");
      if (providerID && modelID) return { providerID, modelID };
    }

    const { providers } = await this.client.listProviders();
    const withModels = providers.filter((p) => p.models && Object.keys(p.models).length > 0);
    // Prefer a provider that already has a key / api source.
    const ready = withModels.filter((p) => p.key || p.source === "api");
    const pool = ready.length ? ready : withModels;
    const p = pool[0];
    if (!p?.models) return undefined;
    const modelId = Object.keys(p.models)[0];
    return { providerID: p.id, modelID: modelId };
  }

  async availableProviders(): Promise<ProviderInfo[]> {
    const { providers } = await this.client.listProviders();
    return providers;
  }

  private async registerDiscordConnector(): Promise<void> {
    const serverPath = resolve(__dirname, "../../connectors/discord/src/server.ts");
    try {
      await this.client.addMcp("discord", {
        type: "local",
        command: [process.execPath, serverPath],
        cwd: resolve(__dirname, "../../../"),
        enabled: true,
        timeout: 30_000,
      });
      this.connectorRegistered = true;
    } catch (e) {
      console.error("[hefesto] failed to register discord connector:", (e as Error).message);
      this.connectorRegistered = false;
    }
  }

  async status(): Promise<HefestoStatus> {
    return {
      running: this.child?.exitCode === null,
      port: this._port,
      baseUrl: this.baseUrl,
      version: this._version,
      defaultModel: this._defaultModel,
      connector: { registered: this.connectorRegistered, name: this.connectorRegistered ? "discord" : undefined },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      if (address && typeof address === "object") {
        const port = address.port;
        srv.close(() => resolvePort(port));
      } else {
        srv.close(() => reject(new Error("could not determine free port")));
      }
    });
    srv.on("error", reject);
  });
}

function findExecutable(name: string): string {
  const override = process.env.OPENCODE_BIN;
  if (override) return override;
  const path = process.env.PATH ?? "";
  for (const dir of path.split(":")) {
    const candidate = resolve(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      if (existsSync(candidate)) return candidate;
    } catch {
      /* keep searching */
    }
  }
  throw new Error(`Could not find executable "${name}" in PATH (set OPENCODE_BIN to override)`);
}
