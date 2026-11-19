#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const args = process.argv.slice(2);
const command = args[0];

try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  /* sem .env */
}

const port = Number(process.env.PORT ?? 4100);
const isSourceCheckout = existsSync(resolve(root, ".git"));
const isPackaged =
  existsSync(resolve(root, "node", process.platform === "win32" ? "node.exe" : "node")) &&
  existsSync(resolve(root, "opencode"));
const dataDir =
  process.env.HEFESTO_DATA_DIR ??
  (isSourceCheckout
    ? resolve(root, "data")
    : process.platform === "win32"
      ? resolve(process.env.LOCALAPPDATA ?? resolve(homedir(), "AppData", "Local"), "Hefesto")
      : resolve(process.env.XDG_DATA_HOME ?? resolve(homedir(), ".local", "share"), "hefesto"));

function help() {
  console.log(`Hefesto ${pkg.version}

Uso:
  hefesto                 inicia o servidor e abre o navegador
  hefesto start           inicia o servidor
  hefesto upgrade         atualiza para a versão atual
  hefesto version         mostra a versão
  hefesto help            mostra esta ajuda

Opções:
  --no-open               não abre o navegador ao iniciar
  --dry-run               no upgrade, apenas mostra os comandos

Requisitos:
  ${isPackaged ? "Esta instalação já inclui Node.js 26 e opencode." : "Node.js 26+, npm e opencode no PATH."}`);
}

function run(cmd, cmdArgs, options = {}) {
  return new Promise((resolveExit) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: root,
      stdio: "inherit",
      ...options,
    });
    child.on("exit", (code, signal) => resolveExit({ code: code ?? (signal ? 1 : 0), signal }));
    child.on("error", (error) => {
      console.error(error.message);
      resolveExit({ code: 1, signal: null });
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 350));
  }
  return false;
}

function openBrowser(url) {
  if (args.includes("--no-open") || process.env.HEFESTO_NO_OPEN === "1") return;
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => console.log(`Abra ${url}`));
    child.unref();
    return;
  }
  const opener = process.platform === "linux" ? "xdg-open" : "open";
  const child = spawn(opener, [url], { detached: true, stdio: "ignore" });
  child.on("error", () => console.log(`Abra ${url}`));
  child.unref();
}

async function start() {
  const dist = resolve(root, "packages/web/dist/index.html");
  if (!existsSync(dist)) {
    console.error("Build da web ausente. Rode: npm run build");
    process.exit(1);
  }

  const guard = await run(process.execPath, [resolve(root, "scripts/ensure-port.ts")]);
  if (guard.code !== 0) process.exit(guard.code);

  const url = `http://127.0.0.1:${port}/`;
  const child = spawn(process.execPath, [resolve(root, "packages/server/src/index.ts")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), HEFESTO_DATA_DIR: dataDir },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });

  void waitForServer(url, child).then((ready) => {
    if (ready) openBrowser(url);
  });
}

async function upgrade() {
  const dryRun = args.includes("--dry-run") || process.env.HEFESTO_UPGRADE_DRY_RUN === "1";
  if (isPackaged) {
    const url = "https://github.com/SaladaDeFlutter/Hefesto/releases/latest";
    if (dryRun) {
      console.log(url);
      return;
    }
    console.log(
      `Esta instalação veio do instalador do Windows.\n` +
        `Baixe a versão mais recente em ${url}\n` +
        `O instalador roda por cima e mantém seus dados.`,
    );
    return;
  }
  if (process.env.HEFESTO_BOOTSTRAP === "1") {
    const windows = process.platform === "win32";
    const script =
      process.env.HEFESTO_BOOTSTRAP_SCRIPT ??
      resolve(root, "scripts", windows ? "bootstrap.ps1" : "bootstrap.sh");
    if (!existsSync(script)) {
      console.error("Instalador bootstrap não encontrado. Reinstale com o one-liner do README.");
      process.exit(1);
    }
    const bootstrapCommand = windows ? (process.env.HEFESTO_POWERSHELL ?? "powershell.exe") : "bash";
    const bootstrapArgs = windows
      ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Upgrade"]
      : [script, "--upgrade"];
    if (dryRun) {
      console.log([bootstrapCommand, ...bootstrapArgs].join(" "));
      return;
    }
    const result = await run(bootstrapCommand, bootstrapArgs, {
      cwd: process.env.HEFESTO_HOME ?? homedir(),
    });
    if (result.code !== 0) process.exit(result.code);
    console.log("Hefesto atualizado. Reinicie o comando hefesto.");
    return;
  }
  if (isSourceCheckout) {
    const commands = [
      ["git", ["pull", "--ff-only"]],
      ["npm", ["install"]],
      ["npm", ["run", "build"]],
    ];
    if (dryRun) {
      for (const [cmd, cmdArgs] of commands) console.log([cmd, ...cmdArgs].join(" "));
      return;
    }
    for (const [cmd, cmdArgs] of commands) {
      const result = await run(cmd, cmdArgs);
      if (result.code !== 0) process.exit(result.code);
    }
    console.log("Hefesto atualizado. Reinicie o comando hefesto.");
    return;
  }

  if (dryRun) {
    console.log(`npm install -g ${pkg.name}@latest`);
    return;
  }
  const result = await run("npm", ["install", "-g", `${pkg.name}@latest`]);
  if (result.code !== 0) process.exit(result.code);
  console.log("Hefesto atualizado via npm. Reinicie o comando hefesto.");
}

switch (command) {
  case "start":
  case undefined:
  case "--no-open":
    await start();
    break;
  case "upgrade":
    await upgrade();
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(pkg.version);
    break;
  case "help":
  case "--help":
  case "-h":
    help();
    break;
  default:
    console.error(`comando desconhecido: ${command}`);
    help();
    process.exit(1);
}
