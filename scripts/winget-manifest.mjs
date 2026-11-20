#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [versionArg, checksumsArg, outputArg] = process.argv.slice(2);

if (!versionArg || !checksumsArg || !outputArg) {
  console.error("uso: node scripts/winget-manifest.mjs <versao> <sha256> <saida.yaml>");
  process.exit(1);
}

const version = versionArg.replace(/^v/, "");
const checksums = readFileSync(resolve(checksumsArg), "utf8");

function hashFor(name) {
  const line = checksums.split(/\r?\n/).find((item) => item.trim().endsWith(name));
  return line?.trim().split(/\s+/)[0]?.toUpperCase();
}

const x64 = hashFor("Hefesto-Setup-x64.exe");
const arm64 = hashFor("Hefesto-Setup-arm64.exe");
if (!x64 || !arm64) {
  console.error("checksums dos instaladores x64/arm64 não encontrados");
  process.exit(1);
}

const templatePath = resolve(root, "packaging/winget/SaladaDeFlutter.Hefesto.yaml");
let yaml = readFileSync(templatePath, "utf8");
yaml = yaml.replace(/^PackageVersion:.*$/m, `PackageVersion: ${version}`);
yaml = yaml.replaceAll(
  /\/download\/v[^/]+\/Hefesto-Setup-x64\.exe/g,
  `/download/v${version}/Hefesto-Setup-x64.exe`,
);
yaml = yaml.replaceAll(
  /\/download\/v[^/]+\/Hefesto-Setup-arm64\.exe/g,
  `/download/v${version}/Hefesto-Setup-arm64.exe`,
);
yaml = yaml.replace(
  /(Architecture: x64[\s\S]*?InstallerSha256: )[A-Fa-f0-9]+/,
  `$1${x64}`,
);
yaml = yaml.replace(
  /(Architecture: arm64[\s\S]*?InstallerSha256: )[A-Fa-f0-9]+/,
  `$1${arm64}`,
);

const outputPath = resolve(outputArg);
writeFileSync(outputPath, yaml);
console.log(outputPath);
