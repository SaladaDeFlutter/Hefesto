import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startBridge } from "./bridge.js";
import { config } from "./config.js";
import { client, initClient, login } from "./discord.js";
import { registerTools } from "./tools.js";

async function main() {
  const { messageContent } = await initClient();

  login().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[discord] falha no login: ${message}`);
  });

  if (messageContent) {
    console.error("[discord] Message Content Intent ativo.");
  } else {
    console.error("[discord] Message Content Intent inativo: o bridge ouve menções e DMs.");
  }

  startBridge(client);

  const server = new McpServer({ name: "hefesto-discord", version: "0.1.0" });
  registerTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`[discord] MCP pronto${config.dryRun ? " (DRY_RUN ativo)" : ""}`);

  const shutdown = async () => {
    await server.close().catch(() => undefined);
    client.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.stdin.once("error", shutdown);
  process.stdout.once("error", shutdown);

  const parentPid = process.ppid;
  const parentWatch = setInterval(() => {
    if (process.ppid !== parentPid) void shutdown();
  }, 5_000);
  parentWatch.unref();
}

main().catch((error) => {
  console.error("[discord] erro fatal:", error);
  process.exit(1);
});
