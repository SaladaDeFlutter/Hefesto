import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { config } from "./config.js";

export interface AliasEntry {
  alias: string;
  target: string;
  note?: string;
  updatedAt: number;
}

interface MemoryStore {
  guilds: Record<string, AliasEntry[]>;
}

let cache: MemoryStore | null = null;

function load(): MemoryStore {
  if (cache) return cache;
  try {
    if (!existsSync(config.memoryFile)) {
      cache = { guilds: {} };
      return cache;
    }
    const parsed = JSON.parse(readFileSync(config.memoryFile, "utf8")) as MemoryStore;
    if (!parsed || typeof parsed !== "object" || typeof parsed.guilds !== "object") {
      cache = { guilds: {} };
      return cache;
    }
    cache = parsed;
    return cache;
  } catch (error) {
    console.error("[discord] falha ao ler memoria:", error);
    cache = { guilds: {} };
    return cache;
  }
}

function save(store: MemoryStore) {
  try {
    const temp = `${config.memoryFile}.tmp`;
    writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(temp, config.memoryFile);
  } catch (error) {
    console.error("[discord] falha ao salvar memoria:", error);
  }
}

export function listAliases(guildId: string): AliasEntry[] {
  return [...(load().guilds[guildId] ?? [])].sort((a, b) => a.alias.localeCompare(b.alias));
}

export function rememberAlias(
  guildId: string,
  alias: string,
  target: string,
  note?: string,
): AliasEntry {
  const store = load();
  const entries = store.guilds[guildId] ?? [];
  const cleanAlias = alias.trim();
  const key = cleanAlias.toLowerCase();
  const existing = entries.find((entry) => entry.alias.toLowerCase() === key);

  const entry: AliasEntry = {
    alias: cleanAlias,
    target: target.trim(),
    ...(note?.trim() ? { note: note.trim() } : {}),
    updatedAt: Date.now(),
  };

  if (existing) {
    Object.assign(existing, entry);
  } else {
    entries.push(entry);
  }

  store.guilds[guildId] = entries;
  save(store);
  return entry;
}

export function forgetAlias(guildId: string, alias: string): boolean {
  const store = load();
  const entries = store.guilds[guildId] ?? [];
  const key = alias.trim().toLowerCase();
  const next = entries.filter((entry) => entry.alias.toLowerCase() !== key);
  if (next.length === entries.length) return false;
  store.guilds[guildId] = next;
  save(store);
  return true;
}

export function formatAliases(guildId: string | null): string {
  if (!guildId) return "Nenhum apelido registrado.";
  const entries = listAliases(guildId);
  if (entries.length === 0) return "Nenhum apelido registrado ainda.";
  return entries
    .slice(0, 200)
    .map(
      (entry) =>
        `- "${entry.alias}" = ${entry.target}${entry.note ? ` (${entry.note})` : ""}`,
    )
    .join("\n");
}
