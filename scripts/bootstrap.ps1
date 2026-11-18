[CmdletBinding()]
param(
  [switch]$Upgrade
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest

$HefestoHome = if ($env:HEFESTO_HOME) { $env:HEFESTO_HOME } else { Join-Path $HOME ".hefesto" }
$SrcDir = Join-Path $HefestoHome "src"
$NodeDir = Join-Path $HefestoHome "node"
$OpencodePrefix = Join-Path $HefestoHome "opencode"
$BinDir = if ($env:HEFESTO_BIN_DIR) { $env:HEFESTO_BIN_DIR } else { Join-Path $HOME ".local\bin" }
$Target = Join-Path $BinDir "hefesto.cmd"
$BootstrapCopy = Join-Path $HefestoHome "bootstrap.ps1"
$NodeExe = Join-Path $NodeDir "node.exe"
$NpmCmd = Join-Path $NodeDir "npm.cmd"
$RepoZip = if ($env:HEFESTO_REPO_ZIP) { $env:HEFESTO_REPO_ZIP } else { "https://github.com/SaladaDeFlutter/Hefesto/archive/refs/heads/main.zip" }
$BootstrapUrl = "https://raw.githubusercontent.com/SaladaDeFlutter/Hefesto/refs/heads/main/scripts/bootstrap.ps1"
$script:OpencodeBin = $null
$script:Tmp = $null

function Step([string]$Text) {
  Write-Host ""
  Write-Host "▸ $Text" -ForegroundColor DarkYellow
}

function Ok([string]$Text) {
  Write-Host "  ✓ $Text" -ForegroundColor Green
}

function Warn([string]$Text) {
  Write-Host "  ! $Text" -ForegroundColor Yellow
}

function Fail([string]$Text) {
  Write-Host ""
  Write-Host "  ✗ $Text" -ForegroundColor Red
  exit 1
}

function Banner {
  Write-Host ""
  Write-Host @'
██╗  ██╗███████╗███████╗███████╗███████╗████████╗ ███████╗
██║  ██║██╔════╝██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔═══██╗
███████║█████╗  █████╗  █████╗  ███████╗   ██║   ██║   ██║
██╔══██║██╔══╝  ██╔══╝  ██╔══╝  ╚════██║   ██║   ██║   ██║
██║  ██║███████╗██║     ███████╗███████║   ██║   ╚██████╔╝
╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚══════╝   ╚═╝    ╚══════╝
'@ -ForegroundColor DarkYellow
  Write-Host "  a forja de agentes opencode" -ForegroundColor DarkGray
  Write-Host "  instalador Windows · user-space · sem admin" -ForegroundColor DarkGray
  Write-Host ""
}

function Download([string]$Url, [string]$Path) {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path
}

function Test-Node {
  if (-not (Test-Path $NodeExe) -or -not (Test-Path $NpmCmd)) { return $false }
  & $NodeExe -e 'const [m]=process.versions.node.split(".").map(Number); process.exit(m>=26?0:1)' 2>$null
  return $LASTEXITCODE -eq 0
}

function Get-OpencodeExe {
  if (-not (Test-Path $OpencodePrefix)) { return $null }
  Get-ChildItem -Path $OpencodePrefix -Recurse -Filter "opencode.exe" -File -ErrorAction SilentlyContinue |
    Select-Object -First 1
}

function Install-Node {
  Step "1/4  Node.js 26 portátil"
  $index = "https://nodejs.org/dist/latest-v26.x/SHASUMS256.txt"
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri $index).Content -split "`n"
  $line = $sums | Where-Object { $_ -match "win-$arch\.zip$" } | Select-Object -First 1
  if (-not $line) { Fail "Node.js indisponível para win-$arch" }
  $parts = ($line.Trim() -split '\s+')
  $expected = $parts[0]
  $file = $parts[1]
  $url = "https://nodejs.org/dist/latest-v26.x/$file"
  $zip = Join-Path $script:Tmp $file
  Write-Host "  baixando $file" -ForegroundColor DarkGray
  Download $url $zip
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLowerInvariant()
  if ($actual -ne $expected.ToLowerInvariant()) { Fail "checksum do Node.js não confere" }
  $extract = Join-Path $script:Tmp "node"
  if (Test-Path $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $folder = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
  if (-not $folder) { Fail "pacote do Node.js inválido" }
  if (Test-Path $NodeDir) { Remove-Item -LiteralPath $NodeDir -Recurse -Force }
  Move-Item -LiteralPath $folder.FullName -Destination $NodeDir
  Ok "$(& $NodeExe -v) instalado em $NodeDir"
}

function Install-Opencode {
  Step "2/4  opencode"
  $pkg = "opencode-windows-$arch"
  if (Test-Path $OpencodePrefix) { Remove-Item -LiteralPath $OpencodePrefix -Recurse -Force }
  & $NpmCmd install -g "$pkg@latest" --prefix $OpencodePrefix --no-fund --no-audit --loglevel=error
  if ($LASTEXITCODE -ne 0) { Fail "falhou a instalação do opencode" }
  $exe = Get-OpencodeExe
  if (-not $exe) { Fail "binário do opencode não encontrado" }
  $script:OpencodeBin = Split-Path -Parent $exe.FullName
  Ok "opencode $(& $exe.FullName --version) instalado em $OpencodePrefix"
}

function Install-Hefesto {
  Step "3/4  Hefesto"
  $newSrc = Join-Path $HefestoHome "src.new"
  $oldSrc = Join-Path $HefestoHome "src.old"
  if (Test-Path $newSrc) { Remove-Item -LiteralPath $newSrc -Recurse -Force }
  if (Test-Path $oldSrc) { Remove-Item -LiteralPath $oldSrc -Recurse -Force }
  $zip = Join-Path $script:Tmp "hefesto.zip"
  $extract = Join-Path $script:Tmp "source"
  Write-Host "  baixando código do Hefesto" -ForegroundColor DarkGray
  Download $RepoZip $zip
  if (Test-Path $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
  $source = Get-ChildItem -LiteralPath $extract -Directory | Select-Object -First 1
  if (-not $source) { Fail "pacote do Hefesto inválido" }
  New-Item -ItemType Directory -Force -Path $newSrc | Out-Null
  Get-ChildItem -LiteralPath $source.FullName -Force | Copy-Item -Destination $newSrc -Recurse -Force
  Push-Location $newSrc
  try {
    & $NpmCmd install --no-fund --no-audit --loglevel=error
    if ($LASTEXITCODE -ne 0) { Fail "falhou o npm install do Hefesto" }
    & $NpmCmd run build
    if ($LASTEXITCODE -ne 0) { Fail "falhou o build da interface" }
    if (-not (Test-Path (Join-Path $newSrc "packages\web\dist\index.html"))) {
      Fail "build da web não foi gerado"
    }
  } finally {
    Pop-Location
  }
  if (Test-Path $SrcDir) { Rename-Item -LiteralPath $SrcDir -NewName "src.old" }
  Rename-Item -LiteralPath $newSrc -NewName "src"
  if (Test-Path $oldSrc) { Remove-Item -LiteralPath $oldSrc -Recurse -Force }
  Ok "Hefesto instalado em $SrcDir"
}

function Save-Bootstrap {
  if ($PSCommandPath -and (Test-Path $PSCommandPath)) {
    $sourcePath = (Resolve-Path -LiteralPath $PSCommandPath).Path
    $targetPath = if (Test-Path $BootstrapCopy) { (Resolve-Path -LiteralPath $BootstrapCopy).Path } else { $null }
    if ($sourcePath -ne $targetPath) {
      Copy-Item -LiteralPath $sourcePath -Destination $BootstrapCopy -Force
    }
    return
  }
  Download $BootstrapUrl $BootstrapCopy
}

function Install-Command {
  Step "4/4  comando hefesto"
  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $content = @"
@echo off
set "HEFESTO_HOME=$HefestoHome"
set "HEFESTO_BIN_DIR=$BinDir"
set "HEFESTO_BOOTSTRAP=1"
set "HEFESTO_BOOTSTRAP_SCRIPT=$BootstrapCopy"
set "PATH=$NodeDir;$($script:OpencodeBin);%PATH%"
"$NodeExe" "$SrcDir\bin\hefesto.mjs" %*
"@
  Set-Content -LiteralPath $Target -Value $content -Encoding ASCII
  Ok "comando criado em $Target"

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = if ($userPath) { $userPath -split ';' } else { @() }
  if ($parts -notcontains $BinDir) {
    [Environment]::SetEnvironmentVariable("Path", "$BinDir;$userPath", "User")
  }
  $env:Path = "$BinDir;$NodeDir;$($script:OpencodeBin);$env:Path"
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  Fail "este instalador é para Windows. No Linux use scripts/bootstrap.sh."
}

$rawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($rawArch.ToUpperInvariant()) {
  "AMD64" { "x64" }
  "ARM64" { "arm64" }
  default { Fail "arquitetura não suportada: $rawArch" }
}

Banner
Write-Host "  destino  $HefestoHome"
Write-Host "  mode     $(if ($Upgrade) { 'upgrade' } else { 'install' })"
Write-Host ""

New-Item -ItemType Directory -Force -Path $HefestoHome | Out-Null
$script:Tmp = Join-Path ([IO.Path]::GetTempPath()) ("hefesto-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $script:Tmp | Out-Null

try {
  if (Test-Node) {
    Step "0/4  verificando dependências"
    Ok "Node $(& $NodeExe -v) já instalado"
  } else {
    Install-Node
  }

  $existingOpencode = Get-OpencodeExe
  if ($existingOpencode) {
    $script:OpencodeBin = Split-Path -Parent $existingOpencode.FullName
    Step "0/4  verificando dependências"
    Ok "opencode $(& $existingOpencode.FullName --version) já instalado"
  } else {
    Install-Opencode
  }

  $env:Path = "$NodeDir;$($script:OpencodeBin);$env:Path"
  Install-Hefesto
  Save-Bootstrap
  Install-Command

  Write-Host ""
  Write-Host "  Hefesto pronto." -ForegroundColor Green
  Write-Host ""
  Write-Host "  hefesto          inicia e abre o navegador" -ForegroundColor DarkYellow
  Write-Host "  hefesto upgrade  atualiza para a versão atual" -ForegroundColor DarkYellow
  Write-Host "  hefesto help     mostra os comandos" -ForegroundColor DarkYellow
  Write-Host ""
  Warn "Abra um novo terminal para o comando entrar no PATH."
} finally {
  if ($script:Tmp -and (Test-Path $script:Tmp)) {
    Remove-Item -LiteralPath $script:Tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
