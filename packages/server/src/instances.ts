import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRef } from "../../engine/src/index.ts";

export interface Instance {
  id: string;
  name: string;
  slug: string;
  avatar?: string;
  tagline?: string;
  personality?: string;
  instructions?: string;
  accent: string;
  systemPrompt: string;
  model?: ModelRef;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface InstanceInput {
  name: string;
  avatar?: string;
  tagline?: string;
  personality?: string;
  instructions?: string;
  accent?: string;
  model?: ModelRef;
}

export interface InstancePatch extends Partial<InstanceInput> {
  clearModel?: boolean;
}

interface StoreFile {
  version: 1;
  instances: Instance[];
}

const MAX_AVATAR = 400_000;

function text(value: unknown, max: number, field: string, allowEmpty = false): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} deve ser texto`);
  const clean = value.trim();
  if (!clean) return allowEmpty ? "" : undefined;
  if (clean.length > max) throw new Error(`${field} deve ter no máximo ${max} caracteres`);
  return clean;
}

function parseModel(value: unknown): ModelRef | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object") throw new Error("modelo inválido");
  const { providerID, modelID } = value as Record<string, unknown>;
  if (typeof providerID !== "string" || typeof modelID !== "string" || !providerID || !modelID) {
    throw new Error("modelo inválido");
  }
  return { providerID: providerID.slice(0, 120), modelID: modelID.slice(0, 160) };
}

function parseAvatar(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "") return "";
  if (typeof value !== "string" || !value.startsWith("data:image/")) throw new Error("foto inválida");
  if (value.length > MAX_AVATAR) throw new Error("foto muito grande (máx. 400 KB)");
  return value;
}

export function parseInstanceInput(body: unknown, partial = false): InstanceInput | InstancePatch {
  if (!body || typeof body !== "object") throw new Error("payload inválido");
  const b = body as Record<string, unknown>;
  const name = text(b.name, 80, "nome");
  if (!partial && !name) throw new Error("nome é obrigatório");

  const input: InstancePatch = {
    name,
    avatar: parseAvatar(b.avatar),
    tagline: text(b.tagline, 200, "tagline", partial),
    personality: text(b.personality, 2000, "personalidade", partial),
    instructions: text(b.instructions, 4000, "instruções", partial),
    model: parseModel(b.model),
  };

  if (b.accent !== undefined && b.accent !== null) {
    const accent = String(b.accent).trim();
    if (accent) {
      if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new Error("cor inválida");
      input.accent = accent;
    }
  }

  if (Object.prototype.hasOwnProperty.call(b, "model") && (b.model === null || b.model === "")) {
    input.clearModel = true;
  }

  return partial ? input : (input as InstanceInput);
}

function buildSystemPrompt(i: {
  name: string;
  tagline?: string;
  personality?: string;
  instructions?: string;
}): string {
  const lines = [
    `Você é ${i.name}, uma instância do Hefesto — um ambiente local de agentes de código baseado no opencode.`,
  ];
  if (i.tagline) lines.push(`Resumo: ${i.tagline}.`);
  if (i.personality) lines.push(`Personalidade e tom: ${i.personality}.`);
  if (i.instructions) lines.push(`Instruções permanentes: ${i.instructions}.`);
  lines.push(
    "Diretrizes: responda em português do Brasil por padrão e seja direto e útil. Ao usar ferramentas, explique brevemente o que fez e o resultado.",
  );
  return lines.join("\n\n");
}

function uniqueSlug(name: string, items: Instance[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "instancia";
  let slug = base;
  let n = 2;
  while (items.some((i) => i.slug === slug)) slug = `${base}-${n++}`;
  return slug;
}

export class InstanceStore {
  private readonly dir: string;
  private readonly file: string;
  private items: Instance[] = [];
  private loaded = false;
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.dir = dir;
    this.file = join(dir, "instances.json");
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.items = (await this.readStore(this.file)) ?? (await this.readStore(`${this.file}.bak`)) ?? [];
    this.loaded = true;
  }

  private async readStore(file: string): Promise<Instance[] | undefined> {
    try {
      const raw = await readFile(file, "utf8");
      const parsed = JSON.parse(raw) as Partial<StoreFile>;
      return Array.isArray(parsed.instances) ? parsed.instances : undefined;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<Instance[]> {
    await this.ensureLoaded();
    return [...this.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(id: string): Promise<Instance | undefined> {
    await this.ensureLoaded();
    return this.items.find((i) => i.id === id);
  }

  async create(input: InstanceInput): Promise<Instance> {
    await this.ensureLoaded();
    const now = new Date().toISOString();
    const base = {
      name: input.name,
      tagline: input.tagline,
      personality: input.personality,
      instructions: input.instructions,
    };
    const instance: Instance = {
      id: randomUUID(),
      slug: uniqueSlug(input.name, this.items),
      ...base,
      avatar: input.avatar,
      accent: input.accent ?? "#f59e0b",
      model: input.model,
      systemPrompt: buildSystemPrompt(base),
      createdAt: now,
      updatedAt: now,
    };
    this.items.push(instance);
    await this.persist();
    return instance;
  }

  async update(id: string, patch: InstancePatch): Promise<Instance | undefined> {
    await this.ensureLoaded();
    const instance = this.items.find((i) => i.id === id);
    if (!instance) return undefined;

    const base = {
      name: patch.name ?? instance.name,
      tagline: patch.tagline ?? instance.tagline,
      personality: patch.personality ?? instance.personality,
      instructions: patch.instructions ?? instance.instructions,
    };

    Object.assign(instance, {
      ...base,
      avatar: patch.avatar ?? instance.avatar,
      accent: patch.accent ?? instance.accent,
      systemPrompt: buildSystemPrompt(base),
      updatedAt: new Date().toISOString(),
    });

    if (patch.clearModel) delete instance.model;
    else if (patch.model !== undefined) instance.model = patch.model;

    await this.persist();
    return instance;
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureLoaded();
    const before = this.items.length;
    this.items = this.items.filter((i) => i.id !== id);
    if (this.items.length === before) return false;
    await this.persist();
    return true;
  }

  async setSession(id: string, sessionId: string | undefined): Promise<Instance | undefined> {
    await this.ensureLoaded();
    const instance = this.items.find((i) => i.id === id);
    if (!instance) return undefined;
    if (sessionId) instance.sessionId = sessionId;
    else delete instance.sessionId;
    instance.updatedAt = new Date().toISOString();
    await this.persist();
    return instance;
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify({ version: 1, instances: this.items }, null, 2);
    this.saveQueue = this.saveQueue.then(async () => {
      await mkdir(this.dir, { recursive: true });
      try {
        await copyFile(this.file, `${this.file}.bak`);
      } catch {
        /* primeira escrita */
      }
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, payload, "utf8");
      await rename(tmp, this.file);
    });
    await this.saveQueue;
  }
}
