import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PermissionFlagsBits } from "discord.js";
import { z } from "zod";
import {
  addReaction,
  assignRole,
  clearMemberWarnings,
  createCategory,
  createChannel,
  createInvite,
  createRole,
  createStructure,
  deleteChannel,
  deleteRole,
  editChannel,
  editPermissions,
  editRole,
  getGuild,
  kickMember,
  listGuilds,
  listMemberWarnings,
  listRoles,
  listThreads,
  listTree,
  readMessages,
  readThread,
  requirePermissions,
  removeRole,
  removeTimeout,
  sendMessage,
  sendThreadMessage,
  serverInfo,
  timeoutMember,
  warnMember,
} from "./discord.js";
import { config } from "./config.js";
import { forgetAlias, listAliases, rememberAlias } from "./memory.js";

const CHANNEL_TYPE = z.enum(["text", "voice", "announcement", "forum", "stage", "media"]);
const GUILD = z
  .string()
  .optional()
  .describe(
    "ID ou nome do servidor. Use o ID informado no contexto atual; obrigatorio quando o bot esta em mais de um servidor.",
  );
const ROLE_COLOR = z
  .union([z.string(), z.number().int(), z.null()])
  .optional()
  .describe("Cor em #RRGGBB ou numero; null remove a cor");
const PERMISSIONS = z
  .array(z.string())
  .optional()
  .describe('Nomes das permissoes, ex.: ["ViewChannel", "SendMessages"]');
const EMBED = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    url: z.string().url().optional(),
    color: z.number().int().optional().describe("Cor em decimal, ex.: 5814783"),
    footer: z.string().optional(),
  })
  .optional()
  .describe("Embed opcional");

type TextContent = { type: "text"; text: string };
type ToolResult = { content: TextContent[]; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function run(action: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    return ok(await action());
  } catch (error) {
    return fail(error);
  }
}

function serverSummary(guild: { id: string; name: string }) {
  return {
    guildId: guild.id,
    guildName: guild.name,
    dryRun: config.dryRun,
  };
}

export function registerTools(server: McpServer) {
  server.registerTool(
    "echo",
    {
      title: "Eco",
      description: "Retorna o texto recebido de volta.",
      inputSchema: {
        text: z.string().describe("Texto a ecoar"),
      },
    },
    async ({ text }) => run(() => ({ echo: text })),
  );

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Responde com pong, devolvendo o texto opcional recebido.",
      inputSchema: {
        text: z.string().optional().describe("Texto opcional a ecoar"),
      },
    },
    async ({ text }) => run(() => ({ pong: true, echo: text ?? null })),
  );

  server.registerTool(
    "list_guilds",
    {
      title: "Listar servidores",
      description: "Lista os servidores em que o bot esta presente, com IDs.",
      annotations: { readOnlyHint: true },
    },
    async () => run(() => listGuilds()),
  );

  server.registerTool(
    "list_channels",
    {
      title: "Listar canais e categorias",
      description:
        "Lista a arvore de categorias e canais de um servidor, com IDs, topicos e posicoes.",
      annotations: { readOnlyHint: true },
      inputSchema: { guild: GUILD },
    },
    async ({ guild }) =>
      run(async () => {
        const resolved = await getGuild(guild);
        await requirePermissions(resolved, [PermissionFlagsBits.ViewChannel], "listar canais");
        return { ...serverSummary(resolved), ...listTree(resolved) };
      }),
  );

  server.registerTool(
    "server_info",
    {
      title: "Detalhes do servidor",
      description:
        "Retorna nome, dono, membros, contagem, categorias/canais com topicos e a lista de cargos.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        includeRoles: z
          .boolean()
          .optional()
          .describe("Incluir a lista de cargos (padrao: true)"),
        guild: GUILD,
      },
    },
    async ({ includeRoles, guild }) =>
      run(() => serverInfo(includeRoles ?? true, guild)),
  );

  server.registerTool(
    "read_messages",
    {
      title: "Ler mensagens",
      description:
        "Le mensagens de um canal, incluindo historico antigo. Use before/after/around com um ID de mensagem para paginar.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        channel: z.string().describe("Nome (#canal) ou ID do canal"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Quantidade de mensagens (padrao: 20, maximo: 100)"),
        before: z.string().optional().describe("Buscar mensagens antes deste ID"),
        after: z.string().optional().describe("Buscar mensagens depois deste ID"),
        around: z.string().optional().describe("Buscar mensagens ao redor deste ID"),
        guild: GUILD,
      },
    },
    async ({ channel, limit, before, after, around, guild }) =>
      run(() => readMessages({ channel, limit, before, after, around, guild })),
  );

  server.registerTool(
    "create_category",
    {
      title: "Criar categoria",
      description: "Cria uma categoria no servidor informado.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Nome da categoria"),
        position: z.number().int().min(0).optional().describe("Posicao na lista de canais"),
        guild: GUILD,
      },
    },
    async ({ name, position, guild }) =>
      run(() => createCategory(name, position, guild)),
  );

  server.registerTool(
    "create_channel",
    {
      title: "Criar canal",
      description:
        "Cria um canal (texto, voz, anuncio, forum, palco ou midia), opcionalmente dentro de uma categoria.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Nome do canal"),
        type: CHANNEL_TYPE.optional().describe("Tipo do canal (padrao: text)"),
        category: z
          .string()
          .optional()
          .describe("Nome ou ID da categoria onde o canal sera criado"),
        topic: z.string().max(1024).optional().describe("Topico do canal"),
        nsfw: z.boolean().optional().describe("Marcar como NSFW"),
        position: z.number().int().min(0).optional().describe("Posicao na lista de canais"),
        guild: GUILD,
      },
    },
    async ({ name, type, category, topic, nsfw, position, guild }) =>
      run(() => createChannel({ name, type, category, topic, nsfw, position, guild })),
  );

  server.registerTool(
    "create_structure",
    {
      title: "Criar categoria com canais",
      description:
        "Cria uma categoria e varios canais dentro dela em uma unica chamada. Ideal para montar uma area inteira.",
      inputSchema: {
        category: z.string().min(1).max(100).describe("Nome da categoria"),
        position: z.number().int().min(0).optional().describe("Posicao da categoria"),
        channels: z
          .array(
            z.object({
              name: z.string().min(1).max(100),
              type: CHANNEL_TYPE.optional(),
              topic: z.string().max(1024).optional(),
              nsfw: z.boolean().optional(),
            }),
          )
          .max(50)
          .optional()
          .describe("Canais a criar dentro da categoria"),
        guild: GUILD,
      },
    },
    async ({ category, position, channels, guild }) =>
      run(() => createStructure({ category, position, channels, guild })),
  );

  server.registerTool(
    "edit_channel",
    {
      title: "Editar canal",
      description:
        'Renomeia, altera o topico, move de categoria ou reposiciona um canal. Use category: "none" para remover da categoria.',
      inputSchema: {
        channel: z.string().describe("Nome (#canal) ou ID do canal"),
        name: z.string().min(1).max(100).optional().describe("Novo nome"),
        topic: z.string().max(1024).nullable().optional().describe("Novo topico"),
        category: z
          .string()
          .optional()
          .describe('Categoria de destino (nome/ID) ou "none" para remover'),
        position: z.number().int().min(0).optional().describe("Nova posicao"),
        guild: GUILD,
      },
    },
    async ({ channel, name, topic, category, position, guild }) =>
      run(() => editChannel({ channel, name, topic, category, position, guild })),
  );

  server.registerTool(
    "delete_channel",
    {
      title: "Apagar canal",
      description:
        "Apaga um canal ou categoria. Exige confirm: true. Categorias com canais podem deixar os canais sem categoria.",
      annotations: { destructiveHint: true },
      inputSchema: {
        channel: z.string().describe("Nome (#canal) ou ID do canal/categoria"),
        confirm: z.boolean().describe("Precisa ser true para confirmar a exclusao"),
        guild: GUILD,
      },
    },
    async ({ channel, confirm, guild }) =>
      run(() => deleteChannel(channel, confirm, guild)),
  );

  server.registerTool(
    "send_message",
    {
      title: "Enviar mensagem",
      description: "Envia uma mensagem de texto e/ou embed em um canal.",
      inputSchema: {
        channel: z.string().describe("Nome (#canal) ou ID do canal"),
        content: z.string().max(2000).optional().describe("Texto da mensagem"),
        embed: EMBED,
        guild: GUILD,
      },
    },
    async ({ channel, content, embed, guild }) =>
      run(() => sendMessage({ channel, content, embed, guild })),
  );

  server.registerTool(
    "add_reaction",
    {
      title: "Reagir a mensagem",
      description: "Adiciona uma reacao (emoji) a uma mensagem existente do canal.",
      inputSchema: {
        channel: z.string().describe("Nome (#canal) ou ID do canal"),
        messageId: z.string().describe("ID da mensagem que vai receber a reacao"),
        emoji: z.string().describe("Emoji da reacao, ex.: 🔥"),
        guild: GUILD,
      },
    },
    async ({ channel, messageId, emoji, guild }) =>
      run(() => addReaction({ channel, messageId, emoji, guild })),
  );

  server.registerTool(
    "create_invite",
    {
      title: "Criar convite",
      description: "Cria um link de convite para um canal.",
      inputSchema: {
        channel: z.string().describe("Nome (#canal) ou ID do canal"),
        maxAge: z
          .number()
          .int()
          .min(0)
          .max(604800)
          .optional()
          .describe("Validade em segundos (padrao 86400; 0 = nunca expira)"),
        maxUses: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe("Usos maximos (0 = ilimitado)"),
        guild: GUILD,
      },
    },
    async ({ channel, maxAge, maxUses, guild }) =>
      run(() => createInvite(channel, maxAge, maxUses, guild)),
  );

  server.registerTool(
    "edit_permissions",
    {
      title: "Editar permissoes de canal",
      description:
        "Aplica overwrites de permissao em um canal ou categoria para cargos ou um membro. Use allow/deny/neutral; includeChildren aplica tambem aos canais filhos de uma categoria; clear remove a overwrite.",
      inputSchema: {
        channel: z.string().describe("Nome (#canal) ou ID do canal ou categoria"),
        role: z.string().optional().describe("Cargo alvo (nome, ID ou mencao)"),
        roles: z.array(z.string()).optional().describe("Varios cargos alvo"),
        member: z.string().optional().describe("Membro alvo (ID, username ou mencao)"),
        allow: z.array(z.string()).optional().describe("Permissoes a permitir"),
        deny: z.array(z.string()).optional().describe("Permissoes a negar"),
        neutral: z
          .array(z.string())
          .optional()
          .describe("Permissoes a deixar neutras (herdar)"),
        clear: z.boolean().optional().describe("Remove a overwrite do alvo"),
        includeChildren: z
          .boolean()
          .optional()
          .describe("Se for categoria, aplica tambem nos canais filhos"),
        guild: GUILD,
      },
    },
    async ({ channel, role, roles, member, allow, deny, neutral, clear, includeChildren, guild }) =>
      run(() =>
        editPermissions({
          channel,
          role,
          roles,
          member,
          allow,
          deny,
          neutral,
          clear,
          includeChildren,
          guild,
        }),
      ),
  );

  server.registerTool(
    "remember_alias",
    {
      title: "Memorizar apelido",
      description:
        "Guarda um apelido usado no servidor e a quem ele se refere, para lembrar em conversas futuras.",
      inputSchema: {
        alias: z.string().min(1).max(60).describe("Apelido usado, ex.: Jow"),
        target: z
          .string()
          .min(1)
          .max(120)
          .describe("Quem e a pessoa, ex.: Joao (@joao)"),
        note: z
          .string()
          .max(200)
          .optional()
          .describe("Contexto opcional, ex.: apelido usado pela Ana"),
        guild: GUILD,
      },
    },
    async ({ alias, target, note, guild }) =>
      run(async () => {
        const resolved = await getGuild(guild);
        return rememberAlias(resolved.id, alias, target, note);
      }),
  );

  server.registerTool(
    "list_aliases",
    {
      title: "Listar apelidos",
      description: "Lista os apelidos memorizados de um servidor.",
      inputSchema: { guild: GUILD },
    },
    async ({ guild }) =>
      run(async () => {
        const resolved = await getGuild(guild);
        return listAliases(resolved.id);
      }),
  );

  server.registerTool(
    "list_threads",
    {
      title: "Listar topicos de forum",
      description:
        "Lista os topicos/threads de um forum ou canal de texto, com IDs, nomes e estado (ativo/arquivado).",
      annotations: { readOnlyHint: true },
      inputSchema: {
        channel: z.string().describe("Nome (#canal) ou ID do forum/canal"),
        includeArchived: z
          .boolean()
          .optional()
          .describe("Incluir topicos arquivados (padrao: true)"),
        guild: GUILD,
      },
    },
    async ({ channel, includeArchived, guild }) =>
      run(() => listThreads({ channel, includeArchived, guild })),
  );

  server.registerTool(
    "read_thread",
    {
      title: "Ler topico de forum",
      description:
        "Le as mensagens de um topico/thread de forum. Use o ID ou o nome do topico; channel ajuda a desambiguar.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        thread: z.string().describe("ID ou nome do topico/thread"),
        channel: z
          .string()
          .optional()
          .describe("Forum/canal pai (nome ou ID) para desambiguar"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Quantidade de mensagens (padrao: 20, maximo: 100)"),
        before: z.string().optional().describe("Buscar mensagens antes deste ID"),
        after: z.string().optional().describe("Buscar mensagens depois deste ID"),
        around: z.string().optional().describe("Buscar mensagens ao redor deste ID"),
        guild: GUILD,
      },
    },
    async ({ thread, channel, limit, before, after, around, guild }) =>
      run(() => readThread({ thread, channel, limit, before, after, around, guild })),
  );

  server.registerTool(
    "send_thread_message",
    {
      title: "Responder em topico de forum",
      description:
        "Envia uma mensagem de texto e/ou embed dentro de um topico/thread de forum.",
      inputSchema: {
        thread: z.string().describe("ID ou nome do topico/thread"),
        channel: z
          .string()
          .optional()
          .describe("Forum/canal pai (nome ou ID) para desambiguar"),
        content: z.string().max(2000).optional().describe("Texto da mensagem"),
        embed: EMBED,
        guild: GUILD,
      },
    },
    async ({ thread, channel, content, embed, guild }) =>
      run(() => sendThreadMessage({ thread, channel, content, embed, guild })),
  );

  server.registerTool(
    "list_roles",
    {
      title: "Listar cargos",
      description:
        "Lista os cargos do servidor com ID, cor, posicao, permissoes e flags (hoist, mentionable, managed).",
      annotations: { readOnlyHint: true },
      inputSchema: { guild: GUILD },
    },
    async ({ guild }) => run(() => listRoles(guild)),
  );

  server.registerTool(
    "create_role",
    {
      title: "Criar cargo",
      description:
        "Cria um cargo com nome, cor, hoist, mentionable, permissoes e posicao.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Nome do cargo"),
        color: ROLE_COLOR,
        hoist: z.boolean().optional().describe("Mostrar separado na lista de membros"),
        mentionable: z.boolean().optional().describe("Permitir mencao ao cargo"),
        permissions: PERMISSIONS,
        position: z.number().int().min(0).optional().describe("Posicao do cargo"),
        guild: GUILD,
      },
    },
    async ({ name, color, hoist, mentionable, permissions, position, guild }) =>
      run(() =>
        createRole({ name, color, hoist, mentionable, permissions, position }, guild),
      ),
  );

  server.registerTool(
    "edit_role",
    {
      title: "Editar cargo",
      description:
        "Altera nome, cor, hoist, mentionable, permissoes ou posicao de um cargo. O cargo @everyone nao pode ser editado por aqui.",
      inputSchema: {
        role: z.string().describe("Nome, ID ou mencao do cargo"),
        name: z.string().min(1).max(100).optional().describe("Novo nome"),
        color: ROLE_COLOR,
        hoist: z.boolean().optional().describe("Mostrar separado na lista de membros"),
        mentionable: z.boolean().optional().describe("Permitir mencao ao cargo"),
        permissions: PERMISSIONS,
        position: z.number().int().min(0).optional().describe("Nova posicao"),
        guild: GUILD,
      },
    },
    async ({ role, name, color, hoist, mentionable, permissions, position, guild }) =>
      run(() =>
        editRole(
          { role, name, color, hoist, mentionable, permissions, position },
          guild,
        ),
      ),
  );

  server.registerTool(
    "delete_role",
    {
      title: "Apagar cargo",
      description:
        "Apaga um cargo. Exige confirm: true. Nao apaga @everyone nem cargos gerenciados.",
      annotations: { destructiveHint: true },
      inputSchema: {
        role: z.string().describe("Nome, ID ou mencao do cargo"),
        confirm: z.boolean().describe("Precisa ser true para confirmar a exclusao"),
        guild: GUILD,
      },
    },
    async ({ role, confirm, guild }) => run(() => deleteRole(role, confirm, guild)),
  );

  server.registerTool(
    "assign_role",
    {
      title: "Atribuir cargo",
      description:
        "Adiciona um cargo a um membro. Use o ID do membro sempre que possivel.",
      inputSchema: {
        member: z.string().describe("ID, username ou mencao do membro"),
        role: z.string().describe("Nome, ID ou mencao do cargo"),
        guild: GUILD,
      },
    },
    async ({ member, role, guild }) => run(() => assignRole(member, role, guild)),
  );

  server.registerTool(
    "remove_role",
    {
      title: "Remover cargo",
      description:
        "Remove um cargo de um membro. Use o ID do membro sempre que possivel.",
      annotations: { destructiveHint: true },
      inputSchema: {
        member: z.string().describe("ID, username ou mencao do membro"),
        role: z.string().describe("Nome, ID ou mencao do cargo"),
        guild: GUILD,
      },
    },
    async ({ member, role, guild }) => run(() => removeRole(member, role, guild)),
  );

  server.registerTool(
    "timeout_member",
    {
      title: "Silenciar membro (timeout)",
      description:
        "Aplica um timeout (silencio temporario) em um membro. Informe a duracao em segundos (maximo 28 dias). Use o ID do membro sempre que possivel.",
      annotations: { destructiveHint: true },
      inputSchema: {
        member: z.string().describe("ID, username ou mencao do membro"),
        seconds: z
          .number()
          .int()
          .min(1)
          .max(28 * 24 * 60 * 60)
          .describe("Duracao do timeout em segundos"),
        reason: z.string().max(512).optional().describe("Motivo do timeout"),
        guild: GUILD,
      },
    },
    async ({ member, seconds, reason, guild }) =>
      run(() => timeoutMember(member, seconds, reason, guild)),
  );

  server.registerTool(
    "remove_timeout",
    {
      title: "Remover silenciamento",
      description: "Remove o timeout (silencio temporario) de um membro.",
      inputSchema: {
        member: z.string().describe("ID, username ou mencao do membro"),
        reason: z.string().max(512).optional().describe("Motivo da remocao"),
        guild: GUILD,
      },
    },
    async ({ member, reason, guild }) => run(() => removeTimeout(member, reason, guild)),
  );

  server.registerTool(
    "kick_member",
    {
      title: "Expulsar membro (kick)",
      description:
        "Expulsa (kick) um membro do servidor. Exige confirm: true. O membro pode voltar com um novo convite. Nao funciona no dono do servidor nem em cargos acima do bot.",
      annotations: { destructiveHint: true },
      inputSchema: {
        member: z.string().describe("ID, username ou mencao do membro"),
        reason: z.string().max(512).optional().describe("Motivo da expulsao"),
        confirm: z.boolean().describe("Precisa ser true para confirmar a expulsao"),
        guild: GUILD,
      },
    },
    async ({ member, reason, confirm, guild }) =>
      run(() => kickMember(member, reason, guild, confirm)),
  );

  server.registerTool(
    "warn_member",
    {
      title: "Avisar membro (warn)",
      description:
        "Registra um aviso (warn) para um membro, com motivo e contador total. Nao aplica punicao automatica.",
      inputSchema: {
        member: z.string().describe("ID, username ou mencao do membro"),
        reason: z.string().min(1).max(512).describe("Motivo do aviso"),
        guild: GUILD,
      },
    },
    async ({ member, reason, guild }) => run(() => warnMember(member, reason, guild)),
  );

  server.registerTool(
    "list_warnings",
    {
      title: "Listar avisos",
      description:
        "Lista os avisos (warns) de um membro ou de todo o servidor quando member e omitido.",
      inputSchema: {
        member: z.string().optional().describe("ID, username ou mencao do membro"),
        guild: GUILD,
      },
    },
    async ({ member, guild }) => run(() => listMemberWarnings(member, guild)),
  );

  server.registerTool(
    "clear_warnings",
    {
      title: "Limpar avisos",
      description: "Apaga todos os avisos de um membro. Exige confirm: true.",
      annotations: { destructiveHint: true },
      inputSchema: {
        member: z.string().describe("ID, username ou mencao do membro"),
        confirm: z.boolean().describe("Precisa ser true para confirmar a limpeza"),
        guild: GUILD,
      },
    },
    async ({ member, confirm, guild }) =>
      run(() => clearMemberWarnings(member, confirm, guild)),
  );

  server.registerTool(
    "forget_alias",
    {
      title: "Esquecer apelido",
      description: "Remove um apelido da memoria de um servidor.",
      inputSchema: {
        alias: z.string().min(1).max(60).describe("Apelido a remover"),
        guild: GUILD,
      },
    },
    async ({ alias, guild }) =>
      run(async () => {
        const resolved = await getGuild(guild);
        return { removed: forgetAlias(resolved.id, alias), alias };
      }),
  );

  server.registerTool(
    "hora",
    {
      title: "Hora atual",
      description: "Retorna a hora atual em formato ISO.",
      annotations: { readOnlyHint: true },
    },
    async () => run(() => ({ iso: new Date().toISOString() })),
  );
}
