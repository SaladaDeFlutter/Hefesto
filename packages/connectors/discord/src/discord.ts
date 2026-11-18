import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type GuildChannelCreateOptions,
  type GuildChannelEditOptions,
  type Collection,
  type GuildMember,
  type Invite,
  type Message,
  type NonThreadGuildBasedChannel,
  type PermissionOverwriteOptions,
  type Role,
  type RoleData,
  type ThreadChannel,
} from "discord.js";
import { config } from "./config.js";
import { addWarning, clearWarnings, listWarnings } from "./warnings.js";

export let client: Client;

let loginPromise: Promise<void> | null = null;

function createClient(useMessageContent: boolean): Client {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
  ];
  if (useMessageContent) intents.push(GatewayIntentBits.MessageContent);

  const instance = new Client({ intents });
  instance.on("error", (error) => console.error("[discord] discord error:", error.message));
  instance.on("warn", (warning) => console.error("[discord] discord warn:", warning));
  return instance;
}

async function detectMessageContentIntent(): Promise<boolean> {
  if (!config.messageContent) return false;
  try {
    const response = await fetch("https://discord.com/api/v10/applications/@me", {
      headers: { Authorization: `Bot ${config.token}` },
    });
    if (!response.ok) {
      console.error(
        `[discord] nao consegui verificar os intents (${response.status}); usando DISCORD_MESSAGE_CONTENT.`,
      );
      return config.messageContent;
    }
    const data = (await response.json()) as { flags?: number };
    const messageContent = 1 << 18;
    const messageContentLimited = 1 << 19;
    return Boolean((data.flags ?? 0) & (messageContent | messageContentLimited));
  } catch (error) {
    console.error("[discord] falha ao verificar intents:", error);
    return config.messageContent;
  }
}

export async function initClient(): Promise<{ messageContent: boolean }> {
  const messageContent = await detectMessageContentIntent();
  config.messageContent = messageContent;
  client = createClient(messageContent);
  return { messageContent };
}

export function login(): Promise<void> {
  if (!client) throw new Error("Cliente do Discord nao inicializado.");
  if (!loginPromise) {
    loginPromise = client
      .login(config.token)
      .then(() => undefined)
      .catch((error) => {
        loginPromise = null;
        throw error;
      });
  }
  return loginPromise;
}

export async function waitReady(): Promise<Client<true>> {
  if (!client) throw new Error("Cliente do Discord nao inicializado.");
  const current = client;
  if (current.isReady()) return current;
  await login();
  if (!current.isReady()) {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        current.off("ready", onReady);
        reject(new Error("O cliente do Discord nao ficou pronto."));
      }, 15000);
      current.once("ready", onReady);
    });
  }
  return current as Client<true>;
}

export async function getGuild(reference?: string): Promise<Guild> {
  const ready = await waitReady();
  const ref = reference?.trim();

  if (ref) {
    const byId =
      ready.guilds.cache.get(ref) ??
      (await ready.guilds.fetch(ref).catch(() => null));
    if (byId) return byId;

    const lower = ref.toLowerCase();
    const matches = ready.guilds.cache.filter(
      (guild) => guild.name.toLowerCase() === lower,
    );
    if (matches.size === 1) return matches.first()!;
    if (matches.size > 1) {
      throw new Error(`Mais de um servidor chamado "${ref}". Use o ID.`);
    }
    throw new Error(
      `Servidor "${ref}" nao encontrado. Disponiveis: ${describeGuilds(ready)}`,
    );
  }

  if (ready.guilds.cache.size === 1) return ready.guilds.cache.first()!;
  if (ready.guilds.cache.size === 0) {
    throw new Error("O bot nao esta em nenhum servidor. Use o link de convite do README.");
  }
  throw new Error(
    `Informe o servidor (guild). Disponiveis: ${describeGuilds(ready)}`,
  );
}

export async function listGuilds() {
  const ready = await waitReady();
  return ready.guilds.cache.map((guild) => ({
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    ownerId: guild.ownerId,
    configured: guild.id === config.guildId,
  }));
}

function describeGuilds(ready: Client<true>): string {
  if (ready.guilds.cache.size === 0) return "nenhum";
  return ready.guilds.cache.map((guild) => `${guild.name} (${guild.id})`).join(", ");
}

const PERMISSION_NAMES = new Map<bigint, string>(
  Object.entries(PermissionFlagsBits)
    .filter(([, value]) => typeof value === "bigint")
    .map(([name, value]) => [value as bigint, name]),
);

export async function requirePermissions(
  guild: Guild,
  required: bigint[],
  action: string,
): Promise<void> {
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const missing = required.filter((bit) => !me.permissions.has(bit));
  if (missing.length > 0) {
    const names = missing.map((bit) => PERMISSION_NAMES.get(bit) ?? bit.toString());
    throw new Error(`Faltam permissoes para ${action}: ${names.join(", ")}.`);
  }
}

export type DiscordChannelType =
  | "text"
  | "voice"
  | "announcement"
  | "forum"
  | "stage"
  | "media";

type CreatableChannelType = Exclude<
  ChannelType,
  | ChannelType.DM
  | ChannelType.GroupDM
  | ChannelType.PublicThread
  | ChannelType.AnnouncementThread
  | ChannelType.PrivateThread
>;

const CHANNEL_TYPES: Record<DiscordChannelType, CreatableChannelType> = {
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  announcement: ChannelType.GuildAnnouncement,
  forum: ChannelType.GuildForum,
  stage: ChannelType.GuildStageVoice,
  media: ChannelType.GuildMedia,
};

function channelTypeName(type: ChannelType): string {
  switch (type) {
    case ChannelType.GuildText:
      return "text";
    case ChannelType.GuildVoice:
      return "voice";
    case ChannelType.GuildCategory:
      return "category";
    case ChannelType.GuildAnnouncement:
      return "announcement";
    case ChannelType.GuildStageVoice:
      return "stage";
    case ChannelType.GuildForum:
      return "forum";
    case ChannelType.GuildMedia:
      return "media";
    default:
      return String(type);
  }
}

export interface ChannelSummary {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  position: number;
  topic?: string | null;
  nsfw?: boolean;
  slowmode?: number;
}

function summarize(channel: NonThreadGuildBasedChannel): ChannelSummary {
  const details = channel as unknown as {
    topic?: string | null;
    nsfw?: boolean;
    rateLimitPerUser?: number;
  };

  return {
    id: channel.id,
    name: channel.name,
    type: channelTypeName(channel.type),
    parentId: channel.parentId ?? null,
    position: channel.rawPosition,
    ...(channel.type !== ChannelType.GuildCategory
      ? {
          topic: details.topic ?? null,
          nsfw: details.nsfw ?? false,
          slowmode: details.rateLimitPerUser ?? 0,
        }
      : {}),
  };
}

function isGuildChannel(channel: GuildBasedChannel): channel is NonThreadGuildBasedChannel {
  return "rawPosition" in channel;
}

function allChannels(guild: Guild): NonThreadGuildBasedChannel[] {
  return [...guild.channels.cache.values()].filter(isGuildChannel);
}

export function listTree(guild: Guild) {
  const channels = allChannels(guild).sort((a, b) => a.rawPosition - b.rawPosition);
  const categories = channels.filter(
    (channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory,
  );

  return {
    guild: { id: guild.id, name: guild.name },
    categories: categories.map((category) => ({
      ...summarize(category),
      channels: channels
        .filter((channel) => channel.parentId === category.id)
        .map(summarize),
    })),
    uncategorized: channels
      .filter(
        (channel) =>
          channel.parentId === null && channel.type !== ChannelType.GuildCategory,
      )
      .map(summarize),
  };
}

export async function serverInfo(includeRoles = true, guildRef?: string) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ViewChannel], "ler detalhes do servidor");

  const tree = listTree(guild);
  const channels = allChannels(guild);
  const roles = includeRoles
    ? [...guild.roles.cache.values()]
        .sort((a, b) => b.position - a.position)
        .map((role) => ({
          id: role.id,
          name: role.name,
          color: role.hexColor,
          position: role.position,
          managed: role.managed,
          mentionable: role.mentionable,
        }))
    : undefined;

  return {
    guild: {
      id: guild.id,
      name: guild.name,
      description: guild.description ?? null,
      ownerId: guild.ownerId,
      memberCount: guild.memberCount,
      createdAt: guild.createdAt.toISOString(),
      preferredLocale: guild.preferredLocale,
      verificationLevel: guild.verificationLevel,
      premiumTier: guild.premiumTier,
      boostCount: guild.premiumSubscriptionCount ?? 0,
    },
    counts: {
      channels: channels.length,
      categories: tree.categories.length,
      roles: guild.roles.cache.size,
      emojis: guild.emojis.cache.size,
      stickers: guild.stickers.cache.size,
    },
    categories: tree.categories,
    uncategorized: tree.uncategorized,
    ...(roles ? { roles } : {}),
  };
}

export interface ReadMessagesInput {
  channel: string;
  limit?: number;
  before?: string;
  after?: string;
  around?: string;
  guild?: string;
}

export interface MessageSummary {
  id: string;
  createdAt: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    bot: boolean;
  };
  content: string;
  attachments: { name: string; url: string; contentType: string | null }[];
  replyTo: string | null;
}

type ReadableChannel = NonThreadGuildBasedChannel & {
  messages: {
    fetch: (options: {
      limit: number;
      before?: string;
      after?: string;
      around?: string;
    }) => Promise<Collection<string, Message>>;
  };
};

function summarizeMessage(message: Message): MessageSummary {
  return {
    id: message.id,
    createdAt: new Date(message.createdTimestamp).toISOString(),
    author: {
      id: message.author.id,
      username: message.author.username,
      displayName:
        message.member?.displayName ??
        message.author.globalName ??
        message.author.username,
      bot: message.author.bot,
    },
    content: message.content.slice(0, 2_000),
    attachments: [...message.attachments.values()].map((attachment) => ({
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType ?? null,
    })),
    replyTo: message.reference?.messageId ?? null,
  };
}

export async function readMessages(input: ReadMessagesInput) {
  const guild = await getGuild(input.guild);
  await requirePermissions(
    guild,
    [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    "ler mensagens",
  );

  const channel = await resolveChannel(guild, input.channel);
  if (!("messages" in channel)) {
    throw new Error(`O canal #${channel.name} nao tem historico de mensagens.`);
  }

  const anchors = [input.before, input.after, input.around].filter(Boolean);
  if (anchors.length > 1) {
    throw new Error("Use apenas um entre before, after e around.");
  }

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const fetched = await (channel as ReadableChannel).messages.fetch({
    limit,
    ...(input.before ? { before: input.before } : {}),
    ...(input.after ? { after: input.after } : {}),
    ...(input.around ? { around: input.around } : {}),
  });

  const messages = [...fetched.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(summarizeMessage);

  return {
    channel: summarize(channel),
    count: messages.length,
    messages,
  };
}

export async function resolveCategory(
  guild: Guild,
  reference: string,
): Promise<CategoryChannel | null> {
  const value = reference.trim().replace(/^#/, "");
  if (!value || value.toLowerCase() === "none") return null;

  const cached = guild.channels.cache.get(value);
  if (cached?.type === ChannelType.GuildCategory) return cached;

  const lower = value.toLowerCase();
  const matches = guild.channels.cache.filter(
    (channel): channel is CategoryChannel =>
      channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === lower,
  );
  if (matches.size === 1) return matches.first()!;
  if (matches.size > 1) {
    throw new Error(`Mais de uma categoria chamada "${value}". Use o ID.`);
  }
  throw new Error(`Categoria "${reference}" nao encontrada.`);
}

export async function resolveChannel(
  guild: Guild,
  reference: string,
): Promise<NonThreadGuildBasedChannel> {
  const value = reference.trim().replace(/^#/, "");
  if (!value) throw new Error("Informe o canal.");

  const cached = guild.channels.cache.get(value);
  if (cached && isGuildChannel(cached)) return cached;

  const fetched = await guild.channels.fetch(value).catch(() => null);
  if (fetched && isGuildChannel(fetched)) return fetched;

  const lower = value.toLowerCase();
  const matches = allChannels(guild).filter(
    (channel) => channel.name.toLowerCase() === lower,
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(
      `Mais de um canal chamado "${value}" (${matches.map((c) => c.id).join(", ")}). Use o ID.`,
    );
  }
  throw new Error(`Canal "${reference}" nao encontrado.`);
}

export async function createCategory(name: string, position?: number, guildRef?: string) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ManageChannels], "criar categoria");

  if (config.dryRun) {
    return { dryRun: true, action: "create_category", name, position: position ?? null };
  }

  const category = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    ...(position !== undefined ? { position } : {}),
  });
  return summarize(category);
}

export interface CreateChannelInput {
  name: string;
  type?: DiscordChannelType;
  category?: string;
  topic?: string;
  nsfw?: boolean;
  position?: number;
  guild?: string;
}

async function createChannelInGuild(guild: Guild, input: CreateChannelInput) {
  const type = input.type ?? "text";
  const discordType = CHANNEL_TYPES[type];
  if (discordType === undefined) {
    throw new Error(`Tipo de canal invalido: ${type}. Use ${Object.keys(CHANNEL_TYPES).join(", ")}.`);
  }

  const parent = input.category ? await resolveCategory(guild, input.category) : null;
  const supportsTopic = ["text", "announcement", "forum", "media"].includes(type);
  const supportsNsfw = type !== "voice" && type !== "stage";

  const options: GuildChannelCreateOptions = {
    name: input.name,
    type: discordType,
    ...(parent ? { parent: parent.id } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
    ...(input.topic && supportsTopic ? { topic: input.topic } : {}),
    ...(input.nsfw !== undefined && supportsNsfw ? { nsfw: input.nsfw } : {}),
  };

  const channel = await guild.channels.create(options);
  return summarize(channel);
}

export async function createChannel(input: CreateChannelInput) {
  const guild = await getGuild(input.guild);
  await requirePermissions(guild, [PermissionFlagsBits.ManageChannels], "criar canal");

  if (config.dryRun) {
    return { dryRun: true, action: "create_channel", ...input };
  }
  return createChannelInGuild(guild, input);
}

export interface CreateStructureInput {
  category: string;
  channels?: CreateChannelInput[];
  position?: number;
  guild?: string;
}

export async function createStructure(input: CreateStructureInput) {
  const guild = await getGuild(input.guild);
  await requirePermissions(guild, [PermissionFlagsBits.ManageChannels], "criar estrutura");

  if (config.dryRun) {
    return { dryRun: true, action: "create_structure", ...input };
  }

  const category = await guild.channels.create({
    name: input.category,
    type: ChannelType.GuildCategory,
    ...(input.position !== undefined ? { position: input.position } : {}),
  });

  const created: ChannelSummary[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const channel of input.channels ?? []) {
    try {
      created.push(
        await createChannelInGuild(guild, { ...channel, category: category.id }),
      );
    } catch (error) {
      failed.push({
        name: channel.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { category: summarize(category), created, failed };
}

export interface EditChannelInput {
  channel: string;
  name?: string;
  topic?: string | null;
  category?: string;
  position?: number;
  guild?: string;
}

export async function editChannel(input: EditChannelInput) {
  const guild = await getGuild(input.guild);
  await requirePermissions(guild, [PermissionFlagsBits.ManageChannels], "editar canal");

  const channel = await resolveChannel(guild, input.channel);
  const data: GuildChannelEditOptions = {};

  if (input.name !== undefined) data.name = input.name;
  if (input.topic !== undefined) data.topic = input.topic;
  if (input.position !== undefined) data.position = input.position;
  if (input.category !== undefined) {
    const parent = await resolveCategory(guild, input.category);
    data.parent = parent?.id ?? null;
  }

  if (config.dryRun) {
    return { dryRun: true, action: "edit_channel", channel: summarize(channel), changes: data };
  }

  const updated = await channel.edit(data);
  return summarize(updated);
}

export async function deleteChannel(
  channelReference: string,
  confirm: boolean,
  guildRef?: string,
) {
  if (!confirm) {
    throw new Error("Confirmacao necessaria: chame de novo com confirm: true para apagar.");
  }

  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ManageChannels], "apagar canal");

  const channel = await resolveChannel(guild, channelReference);
  const summary = summarize(channel);

  if (config.dryRun) {
    return { dryRun: true, action: "delete_channel", channel: summary };
  }

  await channel.delete("Solicitado via Hefesto (opencode)");
  return { deleted: summary };
}

export interface EmbedInput {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  footer?: string;
}

export interface SendMessageInput {
  channel: string;
  content?: string;
  embed?: EmbedInput;
  guild?: string;
}

type EmbedPayload = Omit<EmbedInput, "footer"> & { footer?: { text: string } };

type SendableChannel = GuildBasedChannel & {
  send: (options: { content?: string; embeds?: EmbedPayload[] }) => Promise<Message>;
};

export async function sendMessage(input: SendMessageInput) {
  if (!input.content && !input.embed) {
    throw new Error("Informe content e/ou embed.");
  }

  const guild = await getGuild(input.guild);
  await requirePermissions(
    guild,
    [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    "enviar mensagem",
  );

  const channel = await resolveChannel(guild, input.channel);
  if (!("send" in channel)) {
    throw new Error(`O canal #${channel.name} nao aceita mensagens.`);
  }

  if (config.dryRun) {
    return {
      dryRun: true,
      action: "send_message",
      channelRef: input.channel,
      content: input.content ?? null,
      embed: input.embed ?? null,
      channel: summarize(channel),
    };
  }

  let embed: EmbedPayload | undefined;
  if (input.embed) {
    const { footer, ...rest } = input.embed;
    embed = { ...rest, ...(footer ? { footer: { text: footer } } : {}) };
  }

  const message = await (channel as SendableChannel).send({
    ...(input.content ? { content: input.content } : {}),
    ...(embed ? { embeds: [embed] } : {}),
  });

  return {
    id: message.id,
    channelId: message.channelId,
    url: message.url,
  };
}

export interface AddReactionInput {
  channel: string;
  messageId: string;
  emoji: string;
  guild?: string;
}

type ReactableChannel = NonThreadGuildBasedChannel & {
  messages: {
    fetch: (messageId: string) => Promise<Message>;
  };
};

export async function addReaction(input: AddReactionInput) {
  const emoji = input.emoji.trim();
  if (!emoji) throw new Error("Informe o emoji da reacao.");
  const messageId = input.messageId.trim();
  if (!/^\d{5,}$/.test(messageId)) {
    throw new Error("Informe um ID de mensagem valido.");
  }

  const guild = await getGuild(input.guild);
  await requirePermissions(
    guild,
    [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
    ],
    "reagir a mensagem",
  );

  const channel = await resolveChannel(guild, input.channel);
  if (!("messages" in channel)) {
    throw new Error(`O canal #${channel.name} nao tem mensagens.`);
  }

  if (config.dryRun) {
    return {
      dryRun: true,
      action: "add_reaction",
      channel: summarize(channel),
      messageId,
      emoji,
    };
  }

  const message = await (channel as ReactableChannel).messages
    .fetch(messageId)
    .catch(() => null);
  if (!message) {
    throw new Error(`Mensagem ${messageId} nao encontrada em #${channel.name}.`);
  }

  await message.react(emoji);

  return {
    ok: true,
    channelId: channel.id,
    messageId: message.id,
    emoji,
    author: summarizeMessage(message).author,
  };
}

type InviteableChannel = GuildBasedChannel & {
  createInvite: (options: {
    maxAge?: number;
    maxUses?: number;
    unique?: boolean;
    reason?: string;
  }) => Promise<Invite>;
};

export async function createInvite(
  channelReference: string,
  maxAge?: number,
  maxUses?: number,
  guildRef?: string,
) {
  const guild = await getGuild(guildRef);
  await requirePermissions(
    guild,
    [PermissionFlagsBits.CreateInstantInvite],
    "criar convite",
  );

  const channel = await resolveChannel(guild, channelReference);
  if (!("createInvite" in channel)) {
    throw new Error(`O canal #${channel.name} nao suporta convite.`);
  }

  if (config.dryRun) {
    return { dryRun: true, action: "create_invite", channel: summarize(channel) };
  }

  const invite = await (channel as InviteableChannel).createInvite({
    maxAge: maxAge ?? 86400,
    maxUses: maxUses ?? 0,
    unique: true,
    reason: "Criado via Hefesto (opencode)",
  });

  return {
    code: invite.code,
    url: invite.url,
    channelId: invite.channelId,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    maxUses: invite.maxUses,
  };
}

function resolvePermissions(names?: string[]): bigint | undefined {
  if (names === undefined) return undefined;
  let bits = 0n;
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    if (/^\d+$/.test(name)) {
      bits |= BigInt(name);
      continue;
    }
    const value = (PermissionFlagsBits as unknown as Record<string, bigint | undefined>)[name];
    if (value === undefined) {
      throw new Error(
        `Permissao invalida: ${name}. Use nomes como ManageChannels, ViewChannel, SendMessages.`,
      );
    }
    bits |= value;
  }
  return bits;
}

function resolveColor(value?: string | number | null): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number") return value;
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) {
    throw new Error(`Cor invalida: ${value}. Use #RRGGBB.`);
  }
  return Number.parseInt(hex, 16);
}

function permissionNames(bits: bigint): string[] {
  const names = new Set<string>();
  for (const [name, value] of Object.entries(PermissionFlagsBits)) {
    if (typeof value === "bigint" && value !== 0n && (bits & value) === value) {
      names.add(name);
    }
  }
  return [...names].sort();
}

function summarizeRole(role: Role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    position: role.position,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    permissions: permissionNames(role.permissions.bitfield),
    permissionsBitfield: role.permissions.bitfield.toString(),
  };
}

async function resolveRole(guild: Guild, reference: string): Promise<Role> {
  const ref = reference.trim();
  if (!ref) throw new Error("Informe o cargo.");
  if (ref.toLowerCase() === "@everyone") return guild.roles.everyone;

  const id = ref.match(/^<@&(\d+)>$/)?.[1] ?? ref;
  const cached = guild.roles.cache.get(id);
  if (cached) return cached;

  const fetched = await guild.roles.fetch(id).catch(() => null);
  if (fetched) return fetched;

  const lower = ref.toLowerCase();
  const matches = guild.roles.cache.filter(
    (role) => role.name.toLowerCase() === lower,
  );
  if (matches.size === 1) return matches.first()!;
  if (matches.size > 1) {
    throw new Error(`Mais de um cargo chamado "${ref}". Use o ID.`);
  }
  throw new Error(`Cargo "${reference}" nao encontrado.`);
}

async function resolveMember(guild: Guild, reference: string): Promise<GuildMember> {
  const ref = reference.trim();
  if (!ref) throw new Error("Informe o membro.");

  const id = ref.match(/^<@!?(\d+)>$/)?.[1] ?? ref.match(/^(\d+)$/)?.[1];
  if (id) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (member) return member;
    throw new Error(`Membro ${id} nao encontrado.`);
  }

  const lower = ref.toLowerCase().replace(/^@/, "");
  const matches = guild.members.cache.filter((member) => {
    return (
      member.user.username.toLowerCase() === lower ||
      member.user.globalName?.toLowerCase() === lower ||
      member.displayName.toLowerCase() === lower
    );
  });
  if (matches.size === 1) return matches.first()!;
  if (matches.size > 1) {
    throw new Error(`Mais de um membro chamado "${ref}". Use o ID.`);
  }
  throw new Error(`Membro "${reference}" nao encontrado no cache. Use o ID.`);
}

export async function listRoles(guildRef?: string) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ManageRoles], "listar cargos");
  return [...guild.roles.cache.values()]
    .sort((a, b) => b.position - a.position)
    .map(summarizeRole);
}

export interface CreateRoleInput {
  name: string;
  color?: string | number | null;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string[];
  position?: number;
}

export async function createRole(input: CreateRoleInput, guildRef?: string) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ManageRoles], "criar cargo");

  const color = resolveColor(input.color);
  const permissions = resolvePermissions(input.permissions);

  if (config.dryRun) {
    return { dryRun: true, action: "create_role", ...input };
  }

  const role = await guild.roles.create({
    name: input.name,
    ...(color !== undefined && color !== null ? { color } : {}),
    ...(input.hoist !== undefined ? { hoist: input.hoist } : {}),
    ...(input.mentionable !== undefined ? { mentionable: input.mentionable } : {}),
    ...(permissions !== undefined ? { permissions } : {}),
    ...(input.position !== undefined ? { position: input.position } : {}),
    reason: "Criado via Hefesto (opencode)",
  });

  return summarizeRole(role);
}

export interface EditRoleInput {
  role: string;
  name?: string;
  color?: string | number | null;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string[];
  position?: number;
}

export async function editRole(input: EditRoleInput, guildRef?: string) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ManageRoles], "editar cargo");

  const role = await resolveRole(guild, input.role);
  if (role.id === guild.id) {
    throw new Error("O cargo @everyone nao pode ser editado por aqui.");
  }

  const color = resolveColor(input.color);
  const permissions = resolvePermissions(input.permissions);

  if (config.dryRun) {
    return { dryRun: true, action: "edit_role", role: summarizeRole(role), changes: input };
  }

  const data: RoleData = {};
  if (input.name !== undefined) data.name = input.name;
  if (color !== undefined) data.color = color === null ? 0 : color;
  if (input.hoist !== undefined) data.hoist = input.hoist;
  if (input.mentionable !== undefined) data.mentionable = input.mentionable;
  if (permissions !== undefined) data.permissions = permissions;
  if (input.position !== undefined) data.position = input.position;

  const updated = await role.edit(data);
  return summarizeRole(updated);
}

export async function deleteRole(
  roleReference: string,
  confirm: boolean,
  guildRef?: string,
) {
  if (!confirm) {
    throw new Error("Confirmacao necessaria: chame de novo com confirm: true para apagar.");
  }

  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ManageRoles], "apagar cargo");

  const role = await resolveRole(guild, roleReference);
  if (role.id === guild.id) {
    throw new Error("O cargo @everyone nao pode ser apagado.");
  }
  if (role.managed) {
    throw new Error(
      `O cargo "${role.name}" e gerenciado por uma integracao e nao pode ser apagado.`,
    );
  }

  const summary = summarizeRole(role);
  if (config.dryRun) {
    return { dryRun: true, action: "delete_role", role: summary };
  }

  await role.delete("Solicitado via Hefesto (opencode)");
  return { deleted: summary };
}

export async function assignRole(
  memberReference: string,
  roleReference: string,
  guildRef?: string,
) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ManageRoles], "atribuir cargo");

  const member = await resolveMember(guild, memberReference);
  const role = await resolveRole(guild, roleReference);

  if (role.id === guild.id) throw new Error("Nao e possivel atribuir @everyone.");
  if (role.managed) {
    throw new Error(`O cargo "${role.name}" e gerenciado e nao pode ser atribuido manualmente.`);
  }

  if (config.dryRun) {
    return {
      dryRun: true,
      action: "assign_role",
      member: { id: member.id, username: member.user.username },
      role: summarizeRole(role),
    };
  }

  await member.roles.add(role, "Atribuido via Hefesto (opencode)");
  return {
    member: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    },
    role: summarizeRole(role),
    assigned: true,
  };
}

export async function removeRole(
  memberReference: string,
  roleReference: string,
  guildRef?: string,
) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ManageRoles], "remover cargo");

  const member = await resolveMember(guild, memberReference);
  const role = await resolveRole(guild, roleReference);

  if (role.id === guild.id) throw new Error("Nao e possivel remover @everyone.");

  if (config.dryRun) {
    return {
      dryRun: true,
      action: "remove_role",
      member: { id: member.id, username: member.user.username },
      role: summarizeRole(role),
    };
  }

  await member.roles.remove(role, "Removido via Hefesto (opencode)");
  return {
    member: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    },
    role: summarizeRole(role),
    removed: true,
  };
}

export async function timeoutMember(
  memberReference: string,
  durationSeconds: number,
  reason?: string,
  guildRef?: string,
) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ModerateMembers], "silenciar membro");

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Informe uma duracao em segundos maior que zero.");
  }
  const MAX_SECONDS = 28 * 24 * 60 * 60;
  if (durationSeconds > MAX_SECONDS) {
    throw new Error("A duracao maxima de um timeout no Discord e de 28 dias.");
  }

  const member = await resolveMember(guild, memberReference);
  const until = new Date(Date.now() + durationSeconds * 1000);
  const motivo = reason?.trim() || "Silenciado via Hefesto (opencode)";

  if (config.dryRun) {
    return {
      dryRun: true,
      action: "timeout_member",
      member: { id: member.id, username: member.user.username },
      durationSeconds,
      until: until.toISOString(),
    };
  }

  await member.timeout(durationSeconds * 1000, motivo);
  return {
    member: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    },
    timedOut: true,
    durationSeconds,
    until: until.toISOString(),
  };
}

export async function removeTimeout(
  memberReference: string,
  reason?: string,
  guildRef?: string,
) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ModerateMembers], "remover silenciamento");

  const member = await resolveMember(guild, memberReference);
  const motivo = reason?.trim() || "Silenciamento removido via Hefesto (opencode)";

  if (config.dryRun) {
    return {
      dryRun: true,
      action: "remove_timeout",
      member: { id: member.id, username: member.user.username },
    };
  }

  await member.timeout(null, motivo);
  return {
    member: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    },
    timedOut: false,
  };
}

export async function kickMember(
  memberReference: string,
  reason?: string,
  guildRef?: string,
  confirm?: boolean,
) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.KickMembers], "expulsar membro");

  if (confirm !== true) {
    throw new Error("Expulsao exige confirmacao: chame de novo com confirm: true.");
  }

  const member = await resolveMember(guild, memberReference);

  if (member.id === guild.ownerId) {
    throw new Error("Nao e possivel expulsar o dono do servidor.");
  }
  if (member.id === guild.members.me?.id) {
    throw new Error("Nao e possivel expulsar o proprio bot.");
  }

  const target = {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
  };
  const motivo = reason?.trim() || "Expulso via Hefesto (opencode)";

  if (config.dryRun) {
    return { dryRun: true, action: "kick_member", member: target };
  }

  await guild.members.kick(member, motivo);
  return { member: target, kicked: true };
}

export async function warnMember(
  memberReference: string,
  reason: string,
  guildRef?: string,
  moderator?: { id?: string; name?: string },
) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ModerateMembers], "avisar membro");

  const motivo = reason?.trim();
  if (!motivo) throw new Error("Informe o motivo do aviso.");

  const member = await resolveMember(guild, memberReference);
  const warning = addWarning({
    guildId: guild.id,
    memberId: member.id,
    memberName: member.displayName,
    reason: motivo,
    ...(moderator?.id ? { moderatorId: moderator.id } : {}),
    ...(moderator?.name ? { moderatorName: moderator.name } : {}),
  });
  const total = listWarnings(guild.id, member.id).length;

  return {
    member: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    },
    warning: { id: warning.id, reason: warning.reason, createdAt: warning.createdAt },
    totalWarnings: total,
  };
}

export async function listMemberWarnings(memberReference?: string, guildRef?: string) {
  const guild = await getGuild(guildRef);
  const member = memberReference ? await resolveMember(guild, memberReference) : null;
  const entries = listWarnings(guild.id, member?.id);

  return {
    guild: { id: guild.id, name: guild.name },
    member: member
      ? {
          id: member.id,
          username: member.user.username,
          displayName: member.displayName,
        }
      : null,
    total: entries.length,
    warnings: entries.slice(0, 50).map((entry) => ({
      id: entry.id,
      memberId: entry.memberId,
      memberName: entry.memberName,
      reason: entry.reason,
      moderatorName: entry.moderatorName ?? null,
      createdAt: new Date(entry.createdAt).toISOString(),
    })),
  };
}

export async function clearMemberWarnings(
  memberReference: string,
  confirm?: boolean,
  guildRef?: string,
) {
  const guild = await getGuild(guildRef);
  await requirePermissions(guild, [PermissionFlagsBits.ModerateMembers], "limpar avisos");

  if (confirm !== true) {
    throw new Error("Limpar avisos exige confirmacao: chame de novo com confirm: true.");
  }

  const member = await resolveMember(guild, memberReference);
  const removed = clearWarnings(guild.id, member.id);

  return {
    member: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    },
    removed,
  };
}

function assertPermissionName(
  name: string,
): asserts name is keyof typeof PermissionFlagsBits {
  if (!(name in PermissionFlagsBits)) {
    throw new Error(
      `Permissao invalida: ${name}. Use nomes como ViewChannel, SendMessages, ManageChannels.`,
    );
  }
}

export interface EditPermissionsInput {
  channel: string;
  role?: string;
  roles?: string[];
  member?: string;
  allow?: string[];
  deny?: string[];
  neutral?: string[];
  clear?: boolean;
  includeChildren?: boolean;
  guild?: string;
}

interface PermissionTarget {
  kind: "role" | "member";
  value: Role | GuildMember;
  summary: { id: string; name: string; kind: "role" | "member" };
}

export async function editPermissions(input: EditPermissionsInput, guildRef?: string) {
  const guild = await getGuild(guildRef ?? input.guild);
  await requirePermissions(
    guild,
    [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
    "editar permissoes",
  );

  const providedTargets =
    (input.member ? 1 : 0) + (input.role ? 1 : 0) + (input.roles?.length ? 1 : 0);
  if (providedTargets === 0) {
    throw new Error("Informe role, roles ou member.");
  }
  if (providedTargets > 1) {
    throw new Error("Use apenas role, roles ou member por chamada.");
  }

  const targets: PermissionTarget[] = [];
  if (input.member) {
    const member = await resolveMember(guild, input.member);
    targets.push({
      kind: "member",
      value: member,
      summary: { id: member.id, name: member.displayName, kind: "member" },
    });
  } else {
    const refs = input.roles ?? (input.role ? [input.role] : []);
    for (const ref of refs) {
      const role = await resolveRole(guild, ref);
      targets.push({
        kind: "role",
        value: role,
        summary: { id: role.id, name: role.name, kind: "role" },
      });
    }
  }

  const channel = await resolveChannel(guild, input.channel);
  const channels: NonThreadGuildBasedChannel[] = [channel];
  if (input.includeChildren) {
    if (channel.type !== ChannelType.GuildCategory) {
      throw new Error("includeChildren so vale quando o alvo e uma categoria.");
    }
    channels.push(
      ...allChannels(guild).filter((child) => child.parentId === channel.id),
    );
  }

  const allow = input.allow ?? [];
  const deny = input.deny ?? [];
  const neutral = input.neutral ?? [];

  if (input.clear && (allow.length || deny.length || neutral.length)) {
    throw new Error("Com clear: true nao informe allow/deny/neutral.");
  }
  if (!input.clear && !allow.length && !deny.length && !neutral.length) {
    throw new Error("Informe allow, deny, neutral ou clear: true.");
  }

  const options: PermissionOverwriteOptions = {};
  for (const raw of allow) {
    const name = raw.trim();
    assertPermissionName(name);
    options[name] = true;
  }
  for (const raw of deny) {
    const name = raw.trim();
    assertPermissionName(name);
    options[name] = false;
  }
  for (const raw of neutral) {
    const name = raw.trim();
    assertPermissionName(name);
    options[name] = null;
  }

  if (config.dryRun) {
    return {
      dryRun: true,
      action: "edit_permissions",
      channel: summarize(channel),
      channels: channels.map((item) => ({ id: item.id, name: item.name })),
      targets: targets.map((target) => target.summary),
      allow,
      deny,
      neutral,
      clear: Boolean(input.clear),
    };
  }

  const reason = "Atualizado via Hefesto (opencode)";
  const results: unknown[] = [];

  for (const targetChannel of channels) {
    for (const target of targets) {
      if (input.clear) {
        await targetChannel.permissionOverwrites.delete(target.value, reason);
      } else {
        await targetChannel.permissionOverwrites.edit(target.value, options, {
          reason,
        });
      }

      const overwrite = targetChannel.permissionOverwrites.cache.get(target.value.id);
      results.push({
        channel: {
          id: targetChannel.id,
          name: targetChannel.name,
          type: channelTypeName(targetChannel.type),
        },
        target: target.summary,
        allow: overwrite ? permissionNames(overwrite.allow.bitfield) : [],
        deny: overwrite ? permissionNames(overwrite.deny.bitfield) : [],
        cleared: Boolean(input.clear),
      });
    }
  }

  return { applied: results.length, results };
}

function buildEmbedPayload(embed?: EmbedInput): EmbedPayload | undefined {
  if (!embed) return undefined;
  const { footer, ...rest } = embed;
  return { ...rest, ...(footer ? { footer: { text: footer } } : {}) };
}

type ThreadCapableChannel = NonThreadGuildBasedChannel & {
  threads: {
    fetchActive: (cache?: boolean) => Promise<{
      threads: Collection<string, ThreadChannel>;
    }>;
    fetchArchived: (
      options?: { type?: "public" | "private"; limit?: number; before?: string },
      cache?: boolean,
    ) => Promise<{ threads: Collection<string, ThreadChannel> }>;
  };
};

export interface ThreadSummary {
  id: string;
  name: string;
  parentId: string | null;
  archived: boolean;
  locked: boolean;
  createdAt: string;
  messageCount: number | null;
  memberCount: number | null;
}

function summarizeThread(thread: ThreadChannel): ThreadSummary {
  return {
    id: thread.id,
    name: thread.name,
    parentId: thread.parentId ?? null,
    archived: thread.archived ?? false,
    locked: thread.locked ?? false,
    createdAt: thread.createdTimestamp
      ? new Date(thread.createdTimestamp).toISOString()
      : new Date(0).toISOString(),
    messageCount: thread.messageCount ?? null,
    memberCount: thread.memberCount ?? null,
  };
}

function isThreadCapable(
  channel: NonThreadGuildBasedChannel,
): channel is ThreadCapableChannel {
  return "threads" in channel;
}

async function archivedThreadsFor(
  channel: ThreadCapableChannel,
): Promise<ThreadChannel[]> {
  try {
    const archived = await channel.threads.fetchArchived({
      type: "public",
      limit: 100,
    });
    return [...archived.threads.values()];
  } catch {
    return [];
  }
}

export async function resolveThread(
  guild: Guild,
  reference: string,
  parentReference?: string,
): Promise<ThreadChannel> {
  const ref = reference.trim();
  if (!ref) throw new Error("Informe o topico/thread.");

  const id = ref.match(/^<#(\d+)>$/)?.[1] ?? ref.match(/^(\d+)$/)?.[1];
  if (id) {
    const channel =
      guild.channels.cache.get(id) ??
      (await guild.channels.fetch(id).catch(() => null));
    if (channel?.isThread()) return channel;
    if (channel) {
      throw new Error(`O canal #${channel.name} nao e um topico/thread.`);
    }
  }

  const lower = ref.toLowerCase();
  const found = new Map<string, ThreadChannel>();

  if (parentReference) {
    const parent = await resolveChannel(guild, parentReference);
    if (!isThreadCapable(parent)) {
      throw new Error(`O canal #${parent.name} nao suporta topicos.`);
    }
    const active = await parent.threads.fetchActive().catch(() => null);
    for (const thread of active?.threads.values() ?? []) found.set(thread.id, thread);
    for (const thread of await archivedThreadsFor(parent)) found.set(thread.id, thread);
  } else {
    const active = await guild.channels.fetchActiveThreads().catch(() => null);
    for (const thread of active?.threads.values() ?? []) found.set(thread.id, thread);
    for (const channel of allChannels(guild)) {
      if (
        channel.type !== ChannelType.GuildForum &&
        channel.type !== ChannelType.GuildMedia &&
        channel.type !== ChannelType.GuildText &&
        channel.type !== ChannelType.GuildAnnouncement
      ) {
        continue;
      }
      if (!isThreadCapable(channel)) continue;
      for (const thread of await archivedThreadsFor(channel)) {
        found.set(thread.id, thread);
      }
    }
  }

  if (id) {
    const byId = found.get(id);
    if (byId) return byId;
  }

  const threads = [...found.values()];
  const exact = threads.filter((thread) => thread.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) {
    throw new Error(
      `Mais de um topico chamado "${ref}". Use o ID: ${exact.map((t) => t.id).join(", ")}.`,
    );
  }

  const partial = threads.filter((thread) =>
    thread.name.toLowerCase().includes(lower),
  );
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) {
    throw new Error(
      `Mais de um topico corresponde a "${ref}". Use o ID: ${partial.map((t) => t.id).join(", ")}.`,
    );
  }

  throw new Error(`Topico "${reference}" nao encontrado.`);
}

export interface ListThreadsInput {
  channel: string;
  includeArchived?: boolean;
  guild?: string;
}

export async function listThreads(input: ListThreadsInput) {
  const guild = await getGuild(input.guild);
  await requirePermissions(guild, [PermissionFlagsBits.ViewChannel], "listar topicos");

  const parent = await resolveChannel(guild, input.channel);
  if (!isThreadCapable(parent)) {
    throw new Error(`O canal #${parent.name} nao suporta topicos.`);
  }

  const active = await parent.threads.fetchActive().catch(() => null);
  const archived =
    input.includeArchived === false ? [] : await archivedThreadsFor(parent);

  const activeThreads = [...(active?.threads.values() ?? [])];

  return {
    channel: summarize(parent),
    count: activeThreads.length + archived.length,
    active: activeThreads
      .sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0))
      .map(summarizeThread),
    archived: archived
      .sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0))
      .map(summarizeThread),
  };
}

export interface ReadThreadInput {
  thread: string;
  channel?: string;
  limit?: number;
  before?: string;
  after?: string;
  around?: string;
  guild?: string;
}

export async function readThread(input: ReadThreadInput) {
  const guild = await getGuild(input.guild);
  await requirePermissions(
    guild,
    [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    "ler topico",
  );

  const thread = await resolveThread(guild, input.thread, input.channel);
  const anchors = [input.before, input.after, input.around].filter(Boolean);
  if (anchors.length > 1) {
    throw new Error("Use apenas um entre before, after e around.");
  }

  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const fetched = await thread.messages.fetch({
    limit,
    ...(input.before ? { before: input.before } : {}),
    ...(input.after ? { after: input.after } : {}),
    ...(input.around ? { around: input.around } : {}),
  });

  const messages = [...fetched.values()]
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(summarizeMessage);

  return {
    thread: summarizeThread(thread),
    count: messages.length,
    messages,
  };
}

export interface SendThreadMessageInput {
  thread: string;
  channel?: string;
  content?: string;
  embed?: EmbedInput;
  guild?: string;
}

export async function sendThreadMessage(input: SendThreadMessageInput) {
  if (!input.content && !input.embed) {
    throw new Error("Informe content e/ou embed.");
  }

  const guild = await getGuild(input.guild);
  await requirePermissions(
    guild,
    [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    "enviar mensagem no topico",
  );

  const thread = await resolveThread(guild, input.thread, input.channel);
  const embed = buildEmbedPayload(input.embed);

  if (config.dryRun) {
    return {
      dryRun: true,
      action: "send_thread_message",
      thread: summarizeThread(thread),
      content: input.content ?? null,
      embed: input.embed ?? null,
    };
  }

  const message = await thread.send({
    ...(input.content ? { content: input.content } : {}),
    ...(embed ? { embeds: [embed] } : {}),
  });

  return {
    id: message.id,
    channelId: message.channelId,
    url: message.url,
    thread: summarizeThread(thread),
  };
}
