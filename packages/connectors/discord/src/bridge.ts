import { PermissionFlagsBits, type Client, type Message } from "discord.js";
import { setBridgeActor } from "./actor.js";
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
  const parts = splitMessage(text);
  for (let index = 0; index < parts.length; index++) {
    const content = parts[index]!;
    if (index === 0) {
      try {
        await message.reply({ content, allowedMentions: { parse: [] } });
        continue;
      } catch {
        /* mensagem original indisponível: envia sem referência */
      }
    }
    await channel.send({ content, allowedMentions: { parse: [] } });
  }
}

let ownerIdsCache: Set<string> | undefined;

async function resolveOwnerIds(client: Client): Promise<Set<string>> {
  if (ownerIdsCache) return ownerIdsCache;
  try {
    const application = client.application?.owner
      ? client.application
      : await client.application?.fetch().catch(() => null);
    const owner = application?.owner;
    if (!owner) return new Set();
    if ("members" in owner) {
      const ids = [...owner.members.values()].map((member) => member.id);
      return (ownerIdsCache = new Set(ids));
    }
    return (ownerIdsCache = new Set([owner.id]));
  } catch {
    return new Set();
  }
}

async function handleMessage(client: Client, message: Message): Promise<void> {
  const serverUrl = config.hefestoServerUrl;
  const instanceId = config.instanceId;
  if (!serverUrl || !instanceId) return;
  if (message.author.bot || message.system) return;
  const isDirectMessage = !message.guild;
  if (isDirectMessage && !config.allowDms) return;
  if (!isDirectMessage && (!config.guildId || message.guildId !== config.guildId)) return;

  const botId = client.user?.id;
  const mentioned = Boolean(
    botId &&
      (message.mentions.users.has(botId) || message.mentions.repliedUser?.id === botId),
  );
  if (!mentioned && !isDirectMessage) return;

  const content = botId ? stripMention(message.content ?? "", botId) : (message.content ?? "").trim();
  if (!content) return;

  const author = message.member?.displayName ?? message.author.username;
  const guild = message.guild?.name;
  const channelName =
    "name" in message.channel && typeof message.channel.name === "string"
      ? message.channel.name
      : undefined;

  const owners = await resolveOwnerIds(client);
  const owner = owners.has(message.author.id);
  const member =
    message.member ??
    (message.guild
      ? await message.guild.members.fetch(message.author.id).catch(() => undefined)
      : undefined);
  const elevated = Boolean(
    member?.permissions.any([
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.CreateInstantInvite,
      PermissionFlagsBits.AddReactions,
    ]),
  );
  const tier: 1 | 2 | 3 = owner ? 3 : elevated ? 2 : 1;

  const channel = message.channel as unknown as SendableChannel;
  await channel.sendTyping?.().catch(() => undefined);
  const typing = setInterval(() => {
    void channel.sendTyping?.().catch(() => undefined);
  }, 8_000);

  console.error(
    `[discord] bridge tier=${tier} autor=${author} guild=${guild ?? "DM"} canal=${channelName ? `#${channelName}` : "DM"}`,
  );
  setBridgeActor({ member, owner, tier });
  try {
    const response = await fetch(
      `${serverUrl}/api/instances/${encodeURIComponent(instanceId)}/bridge`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: content,
          author,
          authorId: message.author.id,
          guild: guild ?? "",
          guildId: message.guildId ?? "",
          channel: channelName ? `#${channelName}` : "",
          channelId: message.channelId,
          isDm: isDirectMessage,
          tier,
        }),
        signal: AbortSignal.timeout(600_000),
      },
    );
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Hefesto ${response.status}: ${raw.slice(0, 300)}`);
    }
    const data = raw ? (JSON.parse(raw) as { reply?: unknown; sent?: unknown }) : {};
    if (data.sent === true) return;
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
    setBridgeActor(undefined);
    clearInterval(typing);
  }
}

export function startBridge(client: Client): void {
  if (process.env.DISCORD_BRIDGE_DISABLED === "1") return;
  if (!config.bridgeEnabled || config.dryRun || !config.hefestoServerUrl || !config.instanceId) {
    return;
  }
  if (!config.guildId) {
    console.error("[discord] bridge desativado: configure o Guild ID.");
    return;
  }
  let queue = Promise.resolve();
  client.on("messageCreate", (message) => {
    queue = queue
      .then(() => handleMessage(client, message))
      .catch((error) => {
        console.error("[discord] bridge:", error instanceof Error ? error.message : error);
      });
  });
  console.error(
    `[discord] bridge ativo para a instância ${config.instanceId} (guild ${config.guildId})`,
  );
}
