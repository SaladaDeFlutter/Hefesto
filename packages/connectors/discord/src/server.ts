import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "hefesto-discord", version: "0.0.0" });

server.registerTool(
  "discord_send_message",
  {
    title: "Send a Discord message",
    description: "[Fase 0 stub] Pretends to send a message to a Discord channel and returns a confirmation.",
    inputSchema: {
      channel_id: z.string().describe("Discord channel ID or name"),
      content: z.string().describe("Message content to send"),
    },
  },
  async ({ channel_id, content }) => ({
    content: [{ type: "text", text: `[stub] mensagem enviada em #${channel_id}: ${content}` }],
  }),
);

server.registerTool(
  "discord_list_channels",
  {
    title: "List Discord channels",
    description: "[Fase 0 stub] Returns a fake list of channels on the configured server.",
    inputSchema: {
      guild: z.string().optional().describe("Optional guild (server) name or ID"),
    },
  },
  async ({ guild }) => ({
    content: [
      {
        type: "text",
        text: `[stub] canais em ${guild ?? "servidor"}: #geral, #dev, #off-topic`,
      },
    ],
  }),
);

process.stderr.write("[hefesto-discord] MCP server started (stdin/jsonrpc)\n");
await server.connect(new StdioServerTransport());
