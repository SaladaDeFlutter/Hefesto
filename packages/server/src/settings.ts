import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SETTINGS_VERSION = 1;

export interface Settings {
  version: number;
  defaultConnectors: string[];
}

export class SettingsStore {
  private readonly file: string;
  private data: Settings = { version: SETTINGS_VERSION, defaultConnectors: [] };
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.file = join(dir, "settings.json");
  }

  async get(): Promise<Settings> {
    await this.ensureLoaded();
    return { version: SETTINGS_VERSION, defaultConnectors: [...this.data.defaultConnectors] };
  }

  async setDefaultConnectors(ids: string[]): Promise<Settings> {
    await this.ensureLoaded();
    this.data = { version: SETTINGS_VERSION, defaultConnectors: [...ids] };
    await this.persist();
    return this.get();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<Settings>;
      const version = Number(raw.version ?? SETTINGS_VERSION);
      if (version > SETTINGS_VERSION) {
        console.warn(`[hefesto] settings.json versão ${version}; lendo como ${SETTINGS_VERSION}`);
      }
      this.data = {
        version: SETTINGS_VERSION,
        defaultConnectors: Array.isArray(raw.defaultConnectors)
          ? raw.defaultConnectors.filter(
              (id): id is string => typeof id === "string" && Boolean(id.trim()),
            )
          : [],
      };
      if (raw.version !== SETTINGS_VERSION) await this.persist();
    } catch {
      this.data = { version: SETTINGS_VERSION, defaultConnectors: [] };
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    this.queue = this.queue.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data, null, 2), "utf8");
      await rename(tmp, this.file);
    });
    await this.queue;
  }
}
