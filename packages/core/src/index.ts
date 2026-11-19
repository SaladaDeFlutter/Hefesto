import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { delimiter, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenCodeClient, type McpConfig, type ModelRef, type ProviderInfo } from "../../engine/src/index.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ConnectorLaunch {
  alias: string;
  config: McpConfig;
}

export interface HefestoOptions {
  opencodeBin?: string;
  port?: number;
  connectors?: ConnectorLaunch[];
  env?: Record<string, string>;
}

export interface HefestoStatus {
  running: boolean;
  port: number;
  baseUrl: string;
  version?: string;
  defaultModel?: ModelRef;
  connectors: string[];
}

export class Hefesto {
  readonly client: OpenCodeClient;
  private child?: ChildProcess;
  private _port = 0;
  private _version?: string;
  private _defaultModel?: ModelRef;
  private registeredConnectors: string[] = [];

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

    const child = spawnCommand(bin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
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
      killProcess(child, true);
      throw e;
    }

    const h = new Hefesto(baseUrl);
    h.child = child;
    h._port = port;
    h._version = version;
    h._defaultModel = await h.pickDefaultModel();

    for (const connector of opts.connectors ?? []) {
      try {
        await client.addMcp(connector.alias, connector.config);
        h.registeredConnectors.push(connector.alias);
      } catch (e) {
        console.error(`[hefesto] falha ao registrar conector ${connector.alias}:`, (e as Error).message);
      }
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
          killProcess(child, true);
        } catch {
          /* already gone */
        }
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolveExit();
      });
      killProcess(child, false);
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

  async status(): Promise<HefestoStatus> {
    return {
      running: this.child?.exitCode === null,
      port: this._port,
      baseUrl: this.baseUrl,
      version: this._version,
      defaultModel: this._defaultModel,
      connectors: [...this.registeredConnectors],
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Windows cannot spawn `.cmd`/`.bat` shims directly (Node returns EINVAL), so
 * route them through `cmd.exe` the same way Node's `shell: true` does.
 */
function spawnCommand(bin: string, args: string[], options: SpawnOptions): ChildProcess {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    const command = [bin, ...args].map(quoteForCmd).join(" ");
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return spawn(bin, args, options);
}

function quoteForCmd(value: string): string {
  return /[\s"&|<>^()]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** On Windows the spawned process may be a `cmd.exe` wrapper, so kill the tree. */
function killProcess(child: ChildProcess, force: boolean): void {
  if (process.platform === "win32" && child.pid) {
    // spawnSync so no handle is left open when the host process exits.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill(force ? "SIGKILL" : "SIGTERM");
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
  const extensions =
    process.platform === "win32" && !extname(name)
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = resolve(dir, name + extension);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Could not find executable "${name}" in PATH (set OPENCODE_BIN to override)`);
}
