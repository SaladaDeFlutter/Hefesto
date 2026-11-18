import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { config } from "./config.js";

export interface WarningEntry {
  id: string;
  guildId: string;
  memberId: string;
  memberName: string;
  reason: string;
  moderatorId?: string;
  moderatorName?: string;
  createdAt: number;
}

interface WarningStore {
  guilds: Record<string, WarningEntry[]>;
}

let cache: WarningStore | null = null;

function load(): WarningStore {
  if (cache) return cache;
  try {
    if (!existsSync(config.warningsFile)) {
      cache = { guilds: {} };
      return cache;
    }
    const parsed = JSON.parse(readFileSync(config.warningsFile, "utf8")) as WarningStore;
    if (!parsed || typeof parsed !== "object" || typeof parsed.guilds !== "object") {
      cache = { guilds: {} };
      return cache;
    }
    cache = parsed;
    return cache;
  } catch (error) {
    console.error("[discord] falha ao ler avisos:", error);
    cache = { guilds: {} };
    return cache;
  }
}

function save(store: WarningStore) {
  try {
    const temp = `${config.warningsFile}.tmp`;
    writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
    renameSync(temp, config.warningsFile);
  } catch (error) {
    console.error("[discord] falha ao salvar avisos:", error);
  }
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function addWarning(entry: Omit<WarningEntry, "id" | "createdAt">): WarningEntry {
  const store = load();
  const list = store.guilds[entry.guildId] ?? [];
  const warning: WarningEntry = { ...entry, id: newId(), createdAt: Date.now() };
  list.push(warning);
  store.guilds[entry.guildId] = list;
  save(store);
  return warning;
}

export function listWarnings(guildId: string, memberId?: string): WarningEntry[] {
  const all = load().guilds[guildId] ?? [];
  const filtered = memberId ? all.filter((entry) => entry.memberId === memberId) : all;
  return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
}

export function clearWarnings(guildId: string, memberId?: string): number {
  const store = load();
  const all = store.guilds[guildId] ?? [];
  const next = memberId ? all.filter((entry) => entry.memberId !== memberId) : [];
  const removed = all.length - next.length;
  if (next.length === 0) {
    delete store.guilds[guildId];
  } else {
    store.guilds[guildId] = next;
  }
  if (removed > 0) save(store);
  return removed;
}
