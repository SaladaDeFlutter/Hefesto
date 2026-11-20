import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Hefesto, type ConnectorLaunch } from "./index.ts";

export function isolatedEnv(baseDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^OPENCODE_(CONFIG|CONFIG_DIR|DB)$/i.test(key)) continue;
    if (/(_API_KEY|_TOKEN|_SECRET)$/i.test(key)) continue;
    if (/^(AWS_|AZURE_|GOOGLE_APPLICATION_CREDENTIALS$)/i.test(key)) continue;
    env[key] = value;
  }
  Object.assign(env, {
    XDG_DATA_HOME: join(baseDir, "data"),
    XDG_CONFIG_HOME: join(baseDir, "config"),
    XDG_STATE_HOME: join(baseDir, "state"),
    XDG_CACHE_HOME: join(baseDir, "cache"),
    OPENCODE_DISABLE_AUTOUPDATE: "1",
  });
  return env;
}

interface Entry {
  hefesto: Hefesto;
  used: number;
}

export class EngineManager {
  private readonly root: string;
  private readonly resolveConnectors: (id: string) => Promise<ConnectorLaunch[]>;
  private readonly prepare?: (id: string) => Promise<void>;
  private readonly cwd?: (id: string) => string;
  private readonly entries = new Map<string, Entry>();
  private readonly starting = new Map<string, Promise<Hefesto>>();

  constructor(
    root: string,
    resolveConnectors: (id: string) => Promise<ConnectorLaunch[]>,
    prepare?: (id: string) => Promise<void>,
    cwd?: (id: string) => string,
  ) {
    this.root = root;
    this.resolveConnectors = resolveConnectors;
    this.prepare = prepare;
    this.cwd = cwd;
  }

  dir(id: string): string {
    return join(this.root, id);
  }

  async get(id: string): Promise<Hefesto> {
    const current = this.entries.get(id);
    if (current) {
      current.used = Date.now();
      return current.hefesto;
    }

    let pending = this.starting.get(id);
    if (!pending) {
      pending = this.launch(id).finally(() => this.starting.delete(id));
      this.starting.set(id, pending);
    }
    const hefesto = await pending;
    this.entries.set(id, { hefesto, used: Date.now() });
    return hefesto;
  }

  private async launch(id: string): Promise<Hefesto> {
    const dir = this.dir(id);
    await mkdir(dir, { recursive: true });
    const connectors = await this.resolveConnectors(id);
    await this.prepare?.(id);
    return Hefesto.start({
      connectors,
      env: isolatedEnv(dir),
      ...(this.cwd ? { cwd: this.cwd(id) } : {}),
    });
  }

  async stop(id: string): Promise<void> {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (entry) await entry.hefesto.stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
    const pending = [...this.starting.values()];
    this.starting.clear();
    for (const p of pending) {
      try {
        const hefesto = await p;
        await hefesto.stop();
      } catch {
        /* engine que falhou ao iniciar não tem o que parar */
      }
    }
  }
}
