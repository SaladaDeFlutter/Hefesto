import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface Settings {
  defaultConnectors: string[];
}

export class SettingsStore {
  private readonly file: string;
  private data: Settings = { defaultConnectors: [] };
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.file = join(dir, "settings.json");
  }

  async get(): Promise<Settings> {
    await this.ensureLoaded();
    return { defaultConnectors: [...this.data.defaultConnectors] };
  }

  async setDefaultConnectors(ids: string[]): Promise<Settings> {
    await this.ensureLoaded();
    this.data = { defaultConnectors: [...ids] };
    await this.persist();
    return this.get();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<Settings>;
      if (Array.isArray(raw.defaultConnectors)) {
        this.data.defaultConnectors = raw.defaultConnectors.filter(
          (id): id is string => typeof id === "string" && Boolean(id.trim()),
        );
      }
    } catch {
      this.data = { defaultConnectors: ["discord"] };
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
