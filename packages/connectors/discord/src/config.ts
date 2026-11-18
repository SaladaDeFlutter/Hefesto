import { resolve } from "node:path";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Variável ${name} ausente. Configure o conector Discord no Hefesto.`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = optional(name);
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export const config = {
  token: required("DISCORD_TOKEN"),
  appId: optional("DISCORD_APP_ID"),
  guildId: optional("DISCORD_GUILD_ID"),
  dryRun: bool("DRY_RUN", false),
  messageContent: bool("DISCORD_MESSAGE_CONTENT", false),
  memoryFile: optional("DISCORD_MEMORY_FILE") ?? resolve(process.cwd(), ".discord-memory.json"),
  warningsFile: optional("DISCORD_WARNINGS_FILE") ?? resolve(process.cwd(), ".discord-warnings.json"),
  hefestoServerUrl: optional("HEFESTO_SERVER_URL"),
  instanceId: optional("HEFESTO_INSTANCE_ID"),
};
