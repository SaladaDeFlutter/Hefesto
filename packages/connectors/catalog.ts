import { resolve } from "node:path";
import type { McpConfig } from "../engine/src/index.ts";

export interface ConnectorTool {
  name: string;
  description?: string;
}

export interface ConnectorField {
  key: string;
  label: string;
  type: "text" | "number" | "checkbox";
  env?: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
  default?: string | number | boolean;
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  auth: "none" | "api_key" | "oauth";
  defaultEnabled: boolean;
  fields: ConnectorField[];
  tools: ConnectorTool[];
  transport: (root: string) => McpConfig;
}

const DISCORD_TOOLS: ConnectorTool[] = [
  { name: "discord_echo", description: "Devolve o texto recebido." },
  { name: "discord_ping", description: "Responde pong com um eco opcional." },
  { name: "discord_list_guilds", description: "Lista os servidores em que o bot está." },
  { name: "discord_list_channels", description: "Lista categorias e canais de um servidor." },
  { name: "discord_server_info", description: "Mostra dados do servidor: dono, contagens, canais e cargos." },
  { name: "discord_read_messages", description: "Lê o histórico de um canal com paginação." },
  { name: "discord_create_category", description: "Cria uma categoria." },
  { name: "discord_create_channel", description: "Cria um canal de texto, voz, anúncio, fórum, palco ou mídia." },
  { name: "discord_create_structure", description: "Cria uma categoria com até 50 canais de uma vez." },
  { name: "discord_edit_channel", description: "Edita nome, tópico, categoria e posição de um canal." },
  { name: "discord_delete_channel", description: "Exclui um canal ou categoria (exige confirm=true)." },
  { name: "discord_send_message", description: "Envia texto e/ou embed em um canal." },
  { name: "discord_add_reaction", description: "Adiciona uma reação em uma mensagem." },
  { name: "discord_create_invite", description: "Cria um convite para um canal." },
  { name: "discord_edit_permissions", description: "Ajusta permissões de cargo ou membro em um canal." },
  { name: "discord_remember_alias", description: "Salva um apelido para uma pessoa." },
  { name: "discord_list_aliases", description: "Lista os apelidos salvos do servidor." },
  { name: "discord_list_threads", description: "Lista threads ativas e arquivadas de um canal." },
  { name: "discord_read_thread", description: "Lê as mensagens de uma thread." },
  { name: "discord_send_thread_message", description: "Responde dentro de uma thread." },
  { name: "discord_list_roles", description: "Lista cargos com ID, cor, posição e permissões." },
  { name: "discord_create_role", description: "Cria um cargo." },
  { name: "discord_edit_role", description: "Edita nome, cor, posição e permissões de um cargo." },
  { name: "discord_delete_role", description: "Exclui um cargo (exige confirm=true)." },
  { name: "discord_assign_role", description: "Atribui um cargo a um membro." },
  { name: "discord_remove_role", description: "Remove um cargo de um membro." },
  { name: "discord_timeout_member", description: "Aplica timeout de até 28 dias em um membro." },
  { name: "discord_remove_timeout", description: "Remove o timeout de um membro." },
  { name: "discord_kick_member", description: "Expulsa um membro (exige confirm=true)." },
  { name: "discord_warn_member", description: "Registra um aviso para um membro." },
  { name: "discord_list_warnings", description: "Lista avisos de um membro ou do servidor." },
  { name: "discord_clear_warnings", description: "Limpa os avisos de um membro (exige confirm=true)." },
  { name: "discord_forget_alias", description: "Remove um apelido salvo." },
  { name: "discord_hora", description: "Retorna a hora atual em ISO." },
];

export const CONNECTOR_CATALOG: ConnectorDefinition[] = [
  {
    id: "discord",
    name: "Discord",
    description:
      "34 ferramentas reais de Discord: servidores, canais, mensagens, threads, cargos, membros, avisos e aliases.",
    category: "Comunicação",
    icon: "/icons/discord.svg",
    auth: "api_key",
    defaultEnabled: true,
    fields: [
      {
        key: "token",
        label: "Token do bot",
        type: "text",
        env: "DISCORD_TOKEN",
        secret: true,
        required: true,
        placeholder: "MTI...",
        help: "Token do bot Discord. Fica salvo nesta instância e nunca é devolvido pela API.",
      },
      {
        key: "appId",
        label: "ID da aplicação (client_id)",
        type: "text",
        env: "DISCORD_APP_ID",
        placeholder: "123456789012345678",
        help: "Opcional. Usado para gerar o convite do bot e para comandos de aplicação.",
      },
      {
        key: "guildId",
        label: "Guild ID",
        type: "text",
        env: "DISCORD_GUILD_ID",
        placeholder: "123456789012345678",
        help: "Opcional. Restringe as ferramentas a um servidor específico.",
      },
      {
        key: "messageContent",
        label: "Intent de conteúdo de mensagens",
        type: "checkbox",
        env: "FLUX_MESSAGE_CONTENT",
        default: false,
        help: "Necessário apenas se o bot precisar ler texto de mensagens.",
      },
      {
        key: "dryRun",
        label: "Modo simulação (DRY_RUN)",
        type: "checkbox",
        env: "DRY_RUN",
        default: false,
        help: "Não executa ações reais no Discord; útil para testar.",
      },
    ],
    tools: DISCORD_TOOLS,
    transport: () => {
      const mcpRoot = resolve(
        process.env.HEFESTO_DISCORD_MCP_ROOT ?? process.env.HEFESTO_FLUX_ROOT ?? "/home/flutter/Projetos/flux",
      );
      return {
        type: "local",
        command: [
          process.execPath,
          resolve(mcpRoot, "node_modules/tsx/dist/cli.mjs"),
          resolve(mcpRoot, "src/index.ts"),
        ],
        cwd: mcpRoot,
        enabled: true,
        timeout: 3_600_000,
      };
    },
  },
];

export function findConnectorDefinition(id: string): ConnectorDefinition | undefined {
  return CONNECTOR_CATALOG.find((item) => item.id === id);
}
