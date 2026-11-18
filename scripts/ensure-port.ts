import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

try {
  process.loadEnvFile(resolve(ROOT, ".env"));
} catch {
  /* sem .env */
}

const rawPort = process.env.PORT ?? "4100";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`PORT inválida: ${rawPort}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

async function listeningPids(port: number): Promise<number[]> {
  const pids = new Set<number>();
  if (process.platform === "win32") {
    try {
      const output = await run("netstat", ["-ano", "-p", "tcp"]);
      const pattern = new RegExp(`^\\s*TCP\\s+\\S*:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
      for (const line of output.split(/\r?\n/)) {
        const match = line.match(pattern);
        if (match) pids.add(Number(match[1]));
      }
    } catch {
      /* netstat indisponível */
    }
    return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0);
  }
  try {
    const output = await run("ss", ["-ltnp", `sport = :${port}`]);
    for (const match of output.matchAll(/pid=(\d+)/g)) pids.add(Number(match[1]));
  } catch {
    /* ss indisponível */
  }
  if (pids.size === 0) {
    try {
      const output = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
      for (const part of output.split(/\s+/)) {
        if (part) pids.add(Number(part));
      }
    } catch {
      /* lsof indisponível */
    }
  }
  return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function processDetails(pids: number[]): Promise<string[]> {
  if (pids.length === 0) return [];
  if (process.platform === "win32") {
    const lines: string[] = [];
    for (const pid of pids) {
      try {
        const output = await run("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]);
        if (output.trim()) lines.push(output.trim());
      } catch {
        /* tasklist indisponível */
      }
    }
    return lines.length > 0 ? lines : pids.map((pid) => `PID ${pid}`);
  }
  try {
    const output = await run("ps", ["-o", "pid=,args=", "-p", pids.join(",")]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function terminate(pid: number, force: boolean): Promise<void> {
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])]).catch(() => undefined);
    return;
  }
  try {
    process.kill(pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    /* processo já encerrado */
  }
}

async function waitForFreePort(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await sleep(200);
  }
  return portIsFree(port);
}

async function main() {
  if (await portIsFree(port)) return;

  const pids = await listeningPids(port);
  const details = await processDetails(pids);

  console.error(`A porta ${port} já está em uso.`);
  if (details.length > 0) console.error(details.join("\n"));

  if (pids.length === 0) {
    console.error("Não foi possível identificar o processo que está usando a porta.");
    process.exit(1);
  }

  if (!process.stdin.isTTY) {
    console.error("Encerre o processo manualmente ou defina PORT para iniciar em outra porta.");
    process.exit(1);
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let answer = "";
  try {
    answer = await readline.question(`Encerrar esse processo para iniciar o Hefesto? [s/N] `);
  } finally {
    readline.close();
  }

  if (!/^(s|sim|y|yes)$/i.test(answer.trim())) {
    console.log("Início cancelado.");
    process.exit(1);
  }

  for (const pid of pids) await terminate(pid, false);

  if (await waitForFreePort(8_000)) {
    console.log(`Porta ${port} liberada.`);
    return;
  }

  console.error(
    process.platform === "win32"
      ? "O processo não encerrou; forçando com taskkill /F."
      : "O processo não encerrou com SIGTERM; enviando SIGKILL.",
  );
  for (const pid of pids) await terminate(pid, true);

  if (await waitForFreePort(3_000)) {
    console.log(`Porta ${port} liberada.`);
    return;
  }

  console.error(`Não foi possível liberar a porta ${port}.`);
  process.exit(1);
}

await main();
