import type { Client, Message } from "discord.js";
import { config } from "./config.js";

interface SendableChannel {
  sendTyping?: () => Promise<void>;
  send?: (options: { content: string; allowedMentions: { parse: [] } }) => Promise<unknown>;
}

function stripMention(text: string, botId: string): string {
  return text.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
}

function splitMessage(text: string, limit = 1900): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(" ", limit);
    if (cut < limit / 2) cut = limit;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function replyOnDiscord(message: Message, text: string): Promise<void> {
  const channel = message.channel as unknown as SendableChannel;
  if (typeof channel.send !== "function") return;
  for (const part of splitMessage(text)) {
    await channel.send({ content: part, allowedMentions: { parse: [] } });
  }
}

async function handleMessage(client: Client, message: Message): Promise<void> {
  const serverUrl = config.hefestoServerUrl;
  const instanceId = config.instanceId;
  if (!serverUrl || !instanceId) return;
  if (message.author.bot || message.system) return;
  if (config.guildId && message.guildId && message.guildId !== config.guildId) return;

  const botId = client.user?.id;
  const mentioned = Boolean(
    botId &&
      (message.mentions.users.has(botId) || message.mentions.repliedUser?.id === botId),
  );
  const isDirectMessage = !message.guild;
  if (!mentioned && !isDirectMessage) return;

  const content = botId ? stripMention(message.content ?? "", botId) : (message.content ?? "").trim();
  if (!content) return;

  const author = message.member?.displayName ?? message.author.username;
  const guild = message.guild?.name;
  const channelName =
    "name" in message.channel && typeof message.channel.name === "string"
      ? message.channel.name
      : undefined;
  const context = [
    "Mensagem recebida no Discord.",
    `Autor: ${author}`,
    guild ? `Servidor: ${guild}` : "Conversa direta",
    channelName ? `Canal: #${channelName}` : undefined,
    "",
    content,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  const channel = message.channel as unknown as SendableChannel;
  await channel.sendTyping?.().catch(() => undefined);
  const typing = setInterval(() => {
    void channel.sendTyping?.().catch(() => undefined);
  }, 8_000);

  try {
    const response = await fetch(
      `${serverUrl}/api/instances/${encodeURIComponent(instanceId)}/bridge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: context }),
        signal: AbortSignal.timeout(600_000),
      },
    );
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Hefesto ${response.status}: ${raw.slice(0, 300)}`);
    }
    const data = raw ? (JSON.parse(raw) as { reply?: unknown }) : {};
    const reply = typeof data.reply === "string" ? data.reply.trim() : "";
    await replyOnDiscord(
      message,
      reply || "Não consegui gerar uma resposta agora. Tente novamente em instantes.",
    );
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(`[discord] bridge falhou: ${messageText}`);
    await replyOnDiscord(message, "Não consegui processar essa mensagem agora.").catch(
      () => undefined,
    );
  } finally {
    clearInterval(typing);
  }
}

export function startBridge(client: Client): void {
  if (config.dryRun || !config.hefestoServerUrl || !config.instanceId) return;
  let queue = Promise.resolve();
  client.on("messageCreate", (message) => {
    queue = queue
      .then(() => handleMessage(client, message))
      .catch((error) => {
        console.error("[discord] bridge:", error instanceof Error ? error.message : error);
      });
  });
  console.error(`[discord] bridge ativo para a instância ${config.instanceId}`);
}
