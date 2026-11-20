#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const args = process.argv.slice(2);
const command = args[0];

try {
  process.loadEnvFile(resolve(root, ".env"));
} catch {
  /* sem .env */
}

const basePort = Number(process.env.PORT ?? 4100);
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
const statePath = resolve(dataDir, "hefesto-run.json");
const logPath = resolve(dataDir, "hefesto.log");
const noOpen = args.includes("--no-open") || process.env.HEFESTO_NO_OPEN === "1";
const startTimeout = Number(process.env.HEFESTO_START_TIMEOUT_MS ?? 60_000);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function optionValue(names) {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index >= 0) return args[index + 1];
  }
  return undefined;
}

function ensureDataDir() {
  mkdirSync(dataDir, { recursive: true });
}

function readState() {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state && Number.isInteger(state.pid) && Number.isInteger(state.port)) return state;
  } catch {
    /* sem estado */
  }
  return undefined;
}

function writeState(state) {
  ensureDataDir();
  writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
}

function clearState() {
  try {
    rmSync(statePath, { force: true });
  } catch {
    /* sem estado */
  }
}

function rotateLog() {
  try {
    if (statSync(logPath).size > 5 * 1024 * 1024) renameSync(logPath, `${logPath}.1`);
  } catch {
    /* sem log */
  }
}

function tailLines(path, count = 40) {
  try {
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - count)).join("\n").trimEnd();
  } catch {
    return "";
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function commandLine(pid) {
  if (process.platform === "win32") {
    return await runCapture("powershell.exe", [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
    ]);
  }
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ").trim();
  } catch {
    return (await runCapture("ps", ["-o", "command=", "-p", String(pid)])).trim();
  }
}

async function looksLikeHefesto(pid) {
  if (!isAlive(pid)) return false;
  const cmd = (await commandLine(pid)).replace(/\\/g, "/").toLowerCase();
  if (!cmd) return true;
  return cmd.includes("packages/server/src/index.ts") || cmd.includes("bin/hefesto.mjs");
}

async function probeStatus(port, timeout = 800) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    if (
      data &&
      (data.running === true || typeof data.appVersion === "string") &&
      Array.isArray(data.connectors)
    ) {
      return data;
    }
  } catch {
    /* porta livre ou outro serviço */
  }
  return undefined;
}

function portIsFree(port) {
  return new Promise((resolveFree) => {
    const server = createServer();
    server.once("error", () => resolveFree(false));
    server.once("listening", () => server.close(() => resolveFree(true)));
    try {
      server.listen(port, "127.0.0.1");
    } catch {
      resolveFree(false);
    }
  });
}

async function waitForServer(port, child) {
  const deadline = Date.now() + startTimeout;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || (child.pid && !isAlive(child.pid)))) return false;
    if (await probeStatus(port, 1000)) return true;
    await sleep(350);
  }
  return Boolean(await probeStatus(port));
}

async function waitForHealth(port) {
  const deadline = Date.now() + startTimeout;
  while (Date.now() < deadline) {
    if (await probeStatus(port, 1000)) return true;
    await sleep(350);
  }
  return Boolean(await probeStatus(port));
}

async function chooseEndpoint() {
  const state = readState();
  if (state?.port) {
    if (await probeStatus(state.port)) return { port: state.port, existing: true };
    if (await looksLikeHefesto(state.pid)) {
      return { port: state.port, existing: true, starting: true };
    }
  }
  if (await probeStatus(basePort)) return { port: basePort, existing: true };
  if (await portIsFree(basePort)) return { port: basePort, existing: false };
  for (let port = basePort + 1; port <= basePort + 20; port++) {
    if (await portIsFree(port)) return { port, existing: false, shifted: true };
  }
  throw new Error(`nenhuma porta livre entre ${basePort} e ${basePort + 20}`);
}

function openUrl(url) {
  if (noOpen) return;
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

function openBrowser(port) {
  openUrl(`http://127.0.0.1:${port}/`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

function openErrorPage(message, detail) {
  try {
    ensureDataDir();
    const file = resolve(dataDir, "erro.html");
    const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Hefesto não iniciou</title>
    <style>
      body { margin: 0; background: #070b13; color: #e7eef9; font: 14px/1.5 ui-monospace, Menlo, Consolas, monospace; }
      main { max-width: 860px; margin: 0 auto; padding: 48px 24px; }
      h1 { color: #f5a524; margin: 0 0 12px; font-size: 24px; }
      p { color: #a8b8d0; }
      pre { background: #0d1626; border: 1px solid #1c2a42; border-radius: 10px; padding: 16px; overflow: auto; max-height: 420px; white-space: pre-wrap; }
      code { color: #f5a524; }
      button { background: #f5a524; border: 0; border-radius: 8px; color: #0a0f18; padding: 9px 14px; font: inherit; font-weight: 700; cursor: pointer; margin-top: 8px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Hefesto não iniciou</h1>
      <p>${escapeHtml(message)}</p>
      <pre>${escapeHtml(detail)}</pre>
      <p>Log completo: <code>${escapeHtml(logPath)}</code></p>
      <p>Rode <code>hefesto logs</code> ou <code>hefesto doctor</code> no terminal. Depois de corrigir, inicie de novo com <code>hefesto</code>.</p>
      <button onclick="window.close()">fechar</button>
    </main>
  </body>
</html>`;
    writeFileSync(file, html);
    if (!noOpen) openUrl(pathToFileURL(file).href);
  } catch (error) {
    console.error(`não consegui abrir a página de erro: ${error.message}`);
  }
}

async function startDetached(port) {
  ensureDataDir();
  rotateLog();
  const fd = openSync(logPath, "a");
  let child;
  try {
    child = spawn(process.execPath, [resolve(root, "packages/server/src/index.ts")], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, PORT: String(port), HEFESTO_DATA_DIR: dataDir },
    });
  } finally {
    closeSync(fd);
  }
  child.unref();

  const startedAt = new Date().toISOString();
  let wroteState = false;
  if (child.pid) {
    try {
      writeState({ pid: child.pid, port, version: pkg.version, startedAt });
      wroteState = true;
    } catch {
      /* estado é opcional */
    }
  }
  const ready = await waitForServer(port, child);
  if (ready) {
    if (child.pid && !isAlive(child.pid)) clearState();
    return { port, slow: false };
  }
  if (await probeStatus(port)) {
    if (child.pid && !isAlive(child.pid)) clearState();
    return { port, slow: false };
  }
  if (child.pid && isAlive(child.pid)) return { port, slow: true };
  if (wroteState) {
    const current = readState();
    if (!current || current.pid !== child.pid) return { port, stopped: true };
  }
  clearState();
  const details = tailLines(logPath, 30);
  const message = `não consegui confirmar o servidor em http://127.0.0.1:${port}`;
  console.error(message);
  if (details) console.error(details);
  console.error(`log completo: ${logPath}`);
  openErrorPage(message, details || `Veja o log em ${logPath}`);
  process.exit(1);
}

async function openOrStart() {
  const endpoint = await chooseEndpoint();
  if (endpoint.existing) {
    if (endpoint.starting) {
      console.log(`Hefesto já está iniciando em http://127.0.0.1:${endpoint.port}/ ...`);
      const ready = await waitForHealth(endpoint.port);
      console.log(ready ? "pronto." : "ainda subindo; o navegador vai abrir mesmo assim.");
      openBrowser(endpoint.port);
      return;
    }
    console.log(`Hefesto ${pkg.version} já está rodando.`);
    openBrowser(endpoint.port);
    return;
  }
  if (endpoint.shifted) console.log(`porta ${basePort} ocupada; usando ${endpoint.port}.`);
  console.log(`Hefesto ${pkg.version}`);
  console.log(`iniciando em http://127.0.0.1:${endpoint.port}/ ...`);
  console.log(`log: ${logPath}`);
  const result = await startDetached(endpoint.port);
  if (result.stopped) {
    console.log("Hefesto foi encerrado durante a inicialização.");
    return;
  }
  console.log(result.slow ? "ainda subindo; o navegador vai abrir mesmo assim." : "pronto.");
  openBrowser(endpoint.port);
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

async function startForeground() {
  ensureDataDir();
  rotateLog();
  const guard = await run(process.execPath, [resolve(root, "scripts/ensure-port.ts")]);
  if (guard.code !== 0) process.exit(guard.code);
  const child = spawn(process.execPath, [resolve(root, "packages/server/src/index.ts")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, PORT: String(basePort), HEFESTO_DATA_DIR: dataDir },
  });
  if (child.pid) {
    try {
      writeState({
        pid: child.pid,
        port: basePort,
        version: pkg.version,
        startedAt: new Date().toISOString(),
      });
    } catch {
      /* estado é opcional */
    }
  }
  child.on("exit", (code) => {
    clearState();
    process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    clearState();
    console.error(error.message);
    process.exit(1);
  });
  void waitForServer(basePort, child).then((ready) => {
    if (ready) openBrowser(basePort);
  });
}

function runCapture(cmd, cmdArgs, options = {}) {
  return new Promise((resolveCapture) => {
    execFile(
      cmd,
      cmdArgs,
      { encoding: "utf8", windowsHide: true, ...options },
      (error, stdout) => {
        resolveCapture(error ? "" : String(stdout ?? ""));
      },
    );
  });
}

async function descendants(pid) {
  const output = await runCapture("ps", ["-eo", "pid=,ppid="]);
  const children = new Map();
  for (const line of output.split(/\r?\n/)) {
    const [child, parent] = line
      .trim()
      .split(/\s+/)
      .map(Number);
    if (!Number.isInteger(child) || !Number.isInteger(parent)) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  const result = new Set();
  const stack = [...(children.get(pid) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (result.has(current)) continue;
    result.add(current);
    stack.push(...(children.get(current) ?? []));
  }
  return result;
}

async function findListeningPids(port) {
  const pids = new Set();
  if (process.platform === "win32") {
    const output = await runCapture("netstat", ["-ano", "-p", "tcp"]);
    const pattern = new RegExp(`^\\s*TCP\\s+\\S*:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(pattern);
      if (match) pids.add(Number(match[1]));
    }
    return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0);
  }
  const ss = await runCapture("ss", ["-ltnp", `sport = :${port}`]);
  for (const match of ss.matchAll(/pid=(\d+)/g)) pids.add(Number(match[1]));
  if (pids.size === 0) {
    const lsof = await runCapture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    for (const part of lsof.split(/\s+/)) {
      if (part) pids.add(Number(part));
    }
  }
  return [...pids].filter((pid) => Number.isInteger(pid) && pid > 0);
}

function killPid(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function terminate(pid, force, group = false) {
  if (process.platform === "win32") {
    await runCapture("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])]);
    return;
  }
  const signal = force ? "SIGKILL" : "SIGTERM";
  if (group && killPid(-pid, signal)) return;
  killPid(pid, signal);
}

async function waitForStopped(port, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return true;
    await sleep(200);
  }
  return portIsFree(port);
}

async function waitForPidsGone(pids, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if ([...pids].every((pid) => !isAlive(pid))) return true;
    await sleep(200);
  }
  return [...pids].every((pid) => !isAlive(pid));
}

async function stop(options = {}) {
  const state = readState();
  const candidates = options.onlyState ? [state?.port] : [state?.port, basePort];
  const ports = [...new Set(candidates.filter((port) => Number.isInteger(port)))];
  const hefestoPorts = [];
  for (const port of ports) {
    if (await probeStatus(port)) hefestoPorts.push(port);
  }
  if (hefestoPorts.length === 0 && state?.port && (await looksLikeHefesto(state.pid))) {
    hefestoPorts.push(state.port);
  }
  const pids = new Set();
  const groups = new Set();
  for (const port of hefestoPorts) {
    const found = await findListeningPids(port);
    for (const pid of found) {
      pids.add(pid);
      if (pid === state?.pid) groups.add(pid);
    }
    if (port === state?.port && state?.pid && (found.length === 0 || found.includes(state.pid))) {
      pids.add(state.pid);
      groups.add(state.pid);
    }
  }
  if (process.platform !== "win32") {
    for (const pid of [...pids]) {
      for (const child of await descendants(pid)) pids.add(child);
    }
  }
  if (pids.size === 0) {
    clearState();
    console.log("Hefesto não está rodando.");
    return;
  }
  console.log("encerrando Hefesto ...");
  clearState();
  for (const pid of pids) await terminate(pid, false, groups.has(pid));
  if (!(await waitForPidsGone(pids, 6000))) {
    for (const pid of pids) await terminate(pid, true, groups.has(pid));
    await waitForPidsGone(pids, 3000);
  }
  for (const port of hefestoPorts) await waitForStopped(port, 3000);
  const remaining = [...pids].filter((pid) => isAlive(pid));
  clearState();
  if (remaining.length > 0) {
    console.error(`não consegui encerrar o Hefesto (pid ${remaining.join(", ")})`);
    process.exit(1);
  }
  console.log("Hefesto encerrado.");
}

async function status() {
  const state = readState();
  const ports = [...new Set([state?.port, basePort].filter((port) => Number.isInteger(port)))];
  let found;
  for (const port of ports) {
    const info = await probeStatus(port);
    if (info) {
      found = { port, info };
      break;
    }
  }
  const starting = !found && state?.pid && (await looksLikeHefesto(state.pid));
  console.log(`Hefesto ${pkg.version}`);
  console.log(`  estado: ${found ? "rodando" : starting ? "iniciando" : "parado"}`);
  if (found) {
    console.log(`  url: http://127.0.0.1:${found.port}/`);
    if (state?.pid) console.log(`  pid: ${state.pid}`);
    if (found.info.opencode?.ok === false) {
      console.log(
        `  opencode: indisponível${found.info.opencode.error ? ` (${found.info.opencode.error})` : ""}`,
      );
    } else {
      const version = found.info.opencode?.version ?? found.info.version;
      if (version) console.log(`  opencode: ${version}`);
    }
  } else if (starting) {
    console.log(`  url: http://127.0.0.1:${state.port}/`);
    console.log(`  pid: ${state.pid}`);
  }
  console.log(`  dados: ${dataDir}`);
  console.log(`  log: ${logPath}`);
}

function followLog() {
  const child =
    process.platform === "win32"
      ? spawn(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `Get-Content -LiteralPath '${logPath.replace(/'/g, "''")}' -Wait -Tail 50`,
          ],
          { stdio: "inherit" },
        )
      : spawn("tail", ["-n", "50", "-f", logPath], { stdio: "inherit" });
  child.on("error", () => console.log(`log: ${logPath}`));
}

async function logs() {
  const count = Number(optionValue(["-n", "--lines"]) ?? 200);
  if (!existsSync(logPath)) {
    console.log(`sem log ainda em ${logPath}`);
    return;
  }
  const tail = tailLines(logPath, Number.isInteger(count) && count > 0 ? count : 200);
  if (tail) console.log(tail);
  if (args.includes("-f") || args.includes("--follow")) followLog();
}

function data() {
  console.log(dataDir);
}

async function doctor() {
  const checks = [];
  const problems = [];
  const nodeVersion = process.versions.node;
  const nodeMajor = Number(nodeVersion.split(".")[0]);
  const nodeOk = nodeMajor >= 26;
  checks.push({
    ok: nodeOk,
    label: `Node.js ${nodeVersion}${nodeOk ? "" : " (precisa de 26+)"}`,
  });
  if (!nodeOk) problems.push("Node.js");

  const bundledOpencode =
    process.platform === "win32"
      ? resolve(root, "opencode", "opencode.exe")
      : resolve(root, "opencode", "opencode");
  const opencodeBin =
    process.env.OPENCODE_BIN ?? (existsSync(bundledOpencode) ? bundledOpencode : "opencode");
  let opencodeVersion = (
    await runCapture(opencodeBin, ["--version"], { timeout: 5000 })
  ).trim();
  if (!opencodeVersion && process.platform === "win32") {
    opencodeVersion = (
      await runCapture(opencodeBin, ["--version"], { shell: true, timeout: 5000 })
    ).trim();
  }
  checks.push({
    ok: Boolean(opencodeVersion),
    label: opencodeVersion
      ? `${opencodeBin} ${opencodeVersion}`
      : `opencode não encontrado (${opencodeBin})`,
  });
  if (!opencodeVersion) problems.push("opencode");

  const webBuild = resolve(root, "packages/web/dist/index.html");
  const webOk = existsSync(webBuild);
  checks.push({
    ok: webOk,
    label: `build da web ${webOk ? "presente" : "ausente"}`,
  });
  if (!webOk) problems.push("build da web");

  let writable = false;
  let writeError = "";
  try {
    ensureDataDir();
    const probe = resolve(dataDir, ".doctor");
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    writable = true;
  } catch (error) {
    writeError = error.message;
  }
  checks.push({
    ok: writable,
    label: `dados graváveis em ${dataDir}${writeError ? ` (${writeError})` : ""}`,
  });
  if (!writable) problems.push("dados");

  const state = readState();
  const running =
    (state?.port ? await probeStatus(state.port) : undefined) ?? (await probeStatus(basePort));
  if (running) {
    checks.push({
      ok: true,
      label: `Hefesto rodando em http://127.0.0.1:${state?.port ?? basePort}/`,
    });
  } else {
    const free = await portIsFree(basePort);
    checks.push({
      ok: free,
      label: free ? `porta ${basePort} livre` : `porta ${basePort} em uso por outro processo`,
    });
    if (!free) problems.push("porta");
  }

  console.log(`Hefesto ${pkg.version}\n`);
  for (const check of checks) console.log(`  ${check.ok ? "✓" : "✗"} ${check.label}`);
  console.log(`\n  dados: ${dataDir}\n  log:   ${logPath}`);
  if (problems.length > 0) {
    console.error(`\nproblemas: ${problems.join(", ")}`);
    process.exit(1);
  }
  console.log("\nTudo certo.");
}

async function uninstall() {
  if (isPackaged) {
    console.log(`Use o desinstalador do Windows em ${resolve(root, "uninstall.exe")}.`);
    return;
  }
  if (process.env.HEFESTO_BOOTSTRAP === "1" || isSourceCheckout) {
    const script = resolve(root, "scripts", "uninstall.sh");
    if (!existsSync(script)) {
      console.error("desinstalador não encontrado em scripts/uninstall.sh");
      process.exit(1);
    }
    const result = await run("bash", [script, ...args.slice(1)]);
    process.exit(result.code);
  }
  console.log(`Remova com: npm uninstall -g ${pkg.name}`);
}

function help() {
  console.log(`Hefesto ${pkg.version}

Uso:
  hefesto                 inicia (se preciso) e abre no navegador
  hefesto open            o mesmo que hefesto
  hefesto start           inicia em segundo plano
  hefesto start --foreground   roda o servidor no terminal (dev)
  hefesto stop            encerra o servidor
  hefesto status          mostra estado, porta e log
  hefesto logs [-n N] [-f]     mostra os logs
  hefesto data            mostra o diretório de dados
  hefesto doctor          diagnostica Node, opencode, porta e dados
  hefesto uninstall       remove a instalação (Linux/bootstrap)
  hefesto upgrade         atualiza para a versão atual
  hefesto version         mostra a versão
  hefesto help            mostra esta ajuda

Opções:
  --no-open               não abre o navegador
  --foreground            roda o servidor no terminal
  --dry-run               no upgrade, apenas mostra os comandos

Requisitos:
  ${isPackaged ? "Esta instalação já inclui Node.js 26 e opencode." : "Node.js 26+, npm e opencode no PATH."}`);
}

function compareVersions(a, b) {
  const left = a.split(".").map((part) => Number(part) || 0);
  const right = b.split(".").map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const x = left[index] ?? 0;
    const y = right[index] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

async function fetchLatestRelease() {
  const res = await fetch("https://api.github.com/repos/SaladaDeFlutter/Hefesto/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Hefesto" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

async function downloadFile(url, dest) {
  const res = await fetch(url, { headers: { "User-Agent": "Hefesto" }, redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolveHash(hash.digest("hex")))
      .on("error", reject);
  });
}

async function upgrade() {
  const dryRun = args.includes("--dry-run") || process.env.HEFESTO_UPGRADE_DRY_RUN === "1";
  if (isPackaged) {
    const page = "https://github.com/SaladaDeFlutter/Hefesto/releases/latest";
    if (dryRun) {
      console.log(page);
      return;
    }
    if (process.platform !== "win32") {
      console.log(`Atualização automática indisponível neste sistema. Baixe em ${page}`);
      return;
    }
    let stopped = false;
    try {
      const release = await fetchLatestRelease();
      const latest = String(release.tag_name ?? "").replace(/^v/, "");
      if (!latest) throw new Error("release sem tag");
      if (compareVersions(latest, pkg.version) <= 0) {
        console.log(`Hefesto já está atualizado (${pkg.version}).`);
        return;
      }
      const arch = process.arch === "arm64" ? "arm64" : "x64";
      const installerName = `Hefesto-Setup-${arch}.exe`;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const installer = assets.find((asset) => asset && asset.name === installerName);
      if (!installer?.browser_download_url) {
        throw new Error(`instalador ${installerName} não encontrado na release`);
      }
      const checksum = assets.find(
        (asset) => asset && typeof asset.name === "string" && asset.name.endsWith(".sha256"),
      );
      if (!checksum?.browser_download_url || !checksum.name) {
        throw new Error("checksum da release não encontrado");
      }
      const updateDir = resolve(dataDir, "update");
      mkdirSync(updateDir, { recursive: true });
      const installerPath = resolve(updateDir, installerName);
      console.log(`baixando Hefesto ${latest} (${installerName}) ...`);
      await downloadFile(installer.browser_download_url, installerPath);
      const checksumPath = resolve(updateDir, checksum.name);
      await downloadFile(checksum.browser_download_url, checksumPath);
      const lines = readFileSync(checksumPath, "utf8").split(/\r?\n/);
      const line = lines.find((item) => item.trim().endsWith(installerName));
      const expected = line?.trim().split(/\s+/)[0];
      if (!expected) throw new Error("checksum do instalador não encontrado");
      const actual = await sha256File(installerPath);
      if (actual.toLowerCase() !== expected.toLowerCase()) {
        throw new Error("checksum do instalador não confere");
      }
      console.log("parando o Hefesto para aplicar a atualização ...");
      await stop({ onlyState: true });
      stopped = true;
      const scriptPath = resolve(updateDir, "update.ps1");
      const windir = process.env.WINDIR ?? "C:\\Windows";
      const powershellPath = resolve(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const wscriptPath = resolve(windir, "System32", "wscript.exe");
      const vbsPath = resolve(root, "hefesto.vbs");
      const q = (value) => value.replace(/'/g, "''");
      const script = [
        "$ErrorActionPreference = 'SilentlyContinue'",
        `Wait-Process -Id ${process.pid} -Timeout 60 -ErrorAction SilentlyContinue`,
        `try { Start-Process -FilePath '${q(installerPath)}' -ArgumentList '/S' -Wait } finally { Start-Process -FilePath '${q(wscriptPath)}' -ArgumentList '"${q(vbsPath)}"'; Start-Sleep -Seconds 2; Remove-Item -LiteralPath '${q(installerPath)}' -Force -ErrorAction SilentlyContinue }`,
      ].join("\r\n");
      writeFileSync(scriptPath, script, "utf8");
      const child = spawn(
        powershellPath,
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      child.unref();
      console.log("Atualização preparada. O Hefesto vai reiniciar em instantes.");
      return;
    } catch (error) {
      console.error(`falha no upgrade: ${error.message}`);
      console.error(`Baixe manualmente em ${page}`);
      if (stopped) await openOrStart();
      process.exit(1);
    }
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

if (!Number.isInteger(basePort) || basePort < 1 || basePort > 65535) {
  console.error(`PORT inválida: ${process.env.PORT}`);
  process.exit(1);
}

switch (command) {
  case undefined:
  case "open":
  case "start":
  case "--no-open":
    if (args.includes("--foreground")) await startForeground();
    else await openOrStart();
    break;
  case "stop":
    await stop();
    break;
  case "status":
    await status();
    break;
  case "logs":
    await logs();
    break;
  case "data":
    data();
    break;
  case "doctor":
    await doctor();
    break;
  case "uninstall":
    await uninstall();
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
