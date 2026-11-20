<p align="center">
  <img src="docs/hefesto-banner.svg" alt="Hefesto — a forja de agentes opencode" width="100%">
</p>

Hefesto é uma aplicação web local para criar e operar agentes de código. Cada agente é uma **instância**
independente (o termo interno usado na API), com identidade própria, modelo selecionado, conversa persistida e um
processo `opencode serve` isolado.

A interface reúne onboarding, painel, chat, configurações e ferramentas MCP em um só lugar. O catálogo e os
processos `opencode` dos agentes são separados: nenhuma credencial ou ferramenta vaza de um agente para outro.

## Destaques

- Agentes com foto, nome, descrição, personalidade, instruções, cor e modelo.
- Um `opencode serve` isolado por agente, com portas e diretórios próprios.
- Chat com histórico, streaming, status de execução, parada por `Esc` e renderização Markdown.
- Modelos gratuitos do pacote embutido do opencode: `opencode` e `opencode-go`.
- Provedores externos conectados com API key apenas no opencode do agente.
- Ferramentas MCP por agente, com configuração guiada, credenciais mascaradas e status real.
- Ferramenta Discord (conector MCP) com 34 ferramentas, convite de bot e bridge inbound para menções/DMs.
- Servidor local com API HTTP, proxy SSE/HTTP e banner ASCII.
- Status de saúde do opencode, versão do app, logs e `hefesto doctor` para diagnóstico.
- Instaladores Linux e Windows em user-space, sem sudo/admin.
- Abre pelo ícone/atalho, roda em segundo plano e abre o navegador; sem terminal no uso normal.
- Porta ocupada: o launcher usa a próxima livre; `npm start` pergunta antes de encerrar o processo.

## Requisitos

- **Windows 10/11 x64/arm64:** nada além do instalador.
- **Linux x86_64/arm64:** `curl`, `tar`, `gzip` e conexão com a internet para o bootstrap.
- **Código-fonte:** Node.js 26+, npm e o binário `opencode` no `PATH`.

O instalador do Windows e o bootstrap do Linux já incluem Node.js e opencode.

## Instalação

### Linux

O bootstrap instala tudo em `~/.hefesto`, sem sudo: Node 26 portátil, opencode da arquitetura correta, código do
Hefesto, build da web e o comando `hefesto`.

```bash
curl -fsSL https://raw.githubusercontent.com/SaladaDeFlutter/Hefesto/refs/heads/main/scripts/bootstrap.sh | bash
```

Abra um novo terminal ou ajuste o `PATH` se o instalador avisar:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Depois é só abrir **Hefesto** no menu de aplicativos (o atalho é criado pelo bootstrap) ou rodar:

```bash
hefesto
```

O comando inicia o servidor em segundo plano, abre o navegador e devolve o terminal. O banner fica no log. Para não
abrir o navegador:

```bash
hefesto --no-open
```

Para controlar o processo:

```bash
hefesto status
hefesto logs
hefesto stop
```

Para atualizar:

```bash
hefesto upgrade
```

O upgrade baixa a versão atual do repositório, rebuilda e troca o código. A instalação ocupa aproximadamente 600 MB.
Você pode trocar o destino com `HEFESTO_HOME` e o diretório do comando com `HEFESTO_BIN_DIR`.

### Windows (instalador, sem pré-requisitos)

Baixe e execute o instalador — ele já inclui Node.js 26 e opencode 1.19.6, então não precisa de nada instalado:

- [Hefesto-Setup-x64.exe](https://github.com/SaladaDeFlutter/Hefesto/releases/latest/download/Hefesto-Setup-x64.exe) (Windows x64)
- [Hefesto-Setup-arm64.exe](https://github.com/SaladaDeFlutter/Hefesto/releases/latest/download/Hefesto-Setup-arm64.exe) (Windows ARM64)

O instalador é NSIS, instala em `%LOCALAPPDATA%\Programs\Hefesto` **só para o usuário** (sem admin), cria atalhos no
Menu Iniciar/Área de Trabalho, adiciona ao Path do usuário e registra o desinstalador. Os atalhos abrem o app sem
console; o servidor fica em segundo plano. Depois é só abrir **Hefesto**. No terminal: `hefesto`, `hefesto stop`,
`hefesto status` e `hefesto upgrade`.

Também dá para instalar pelo winget (o manifesto está em `packaging/winget`; disponível após aprovação na Microsoft):

```cmd
winget install SaladaDeFlutter.Hefesto
```

> O `.exe` ainda não é assinado com certificado de código; o SmartScreen pode pedir
> "Mais informações → Executar assim mesmo". A assinatura é o próximo passo para remover esse aviso.

### Desenvolvedor / checkout

Para trabalhar no código no Linux/macOS:

```bash
git clone https://github.com/SaladaDeFlutter/Hefesto.git
cd Hefesto
./scripts/install.sh
```

O instalador roda o build, cria o comando `hefesto` em `~/.local/bin` e deixa o upgrade ligado ao git. Nesse modo,
`hefesto upgrade` faz `git pull --ff-only`, `npm install` e `npm run build`.

No Windows, use `npm install`, `npm run build` e `npm start` para rodar a partir do checkout.

Instalações feitas a partir do checkout usam `./data`. O bootstrap do Linux usa `~/.local/share/hefesto` e o
instalador do Windows usa `%LOCALAPPDATA%\Hefesto` por padrão; defina `HEFESTO_DATA_DIR` para escolher outro
diretório.

## Atualizações

- **Windows instalado:** `hefesto upgrade` consulta a release mais recente, baixa o instalador da arquitetura,
  valida o SHA-256, para o app, aplica a atualização silenciosa e reabre o Hefesto. Os dados são preservados.
- **Linux bootstrap:** `hefesto upgrade` baixa o código atual e rebuilda em `~/.hefesto`.
- **Checkout:** `hefesto upgrade` faz `git pull --ff-only`, `npm install` e `npm run build`.
- **npm:** `hefesto upgrade` roda `npm install -g`.

A home mostra um aviso quando há versão nova. No CI, uma tag `v*` gera os instaladores, os checksums e o manifesto
winget atualizado em `dist/SaladaDeFlutter.Hefesto.yaml`, publicados como assets da release.

## Como rodar

```bash
npm install
npm start
```

Abra <http://127.0.0.1:4100>.

O `npm start` executa o build da interface e inicia o servidor em primeiro plano (desenvolvimento). Se a porta
configurada já estiver em uso, o script `prestart` mostra o processo, pergunta se pode encerrá-lo e só continua após
confirmação. Para rodar o modo instalado, use `hefesto`; para desenvolvimento com o mesmo fluxo, use
`hefesto start --foreground`.

Para iniciar apenas o servidor usando a web já buildada:

```bash
npm run build
npm run start:server
```

Para usar outra porta:

```bash
PORT=4200 npm start
```

## Fluxo da interface

| Tela | Rota | O que faz |
| --- | --- | --- |
| Início | `/` | Apresentação do Hefesto, CTA principal, "Seus agentes" (continuar conversa e lista) e recursos. |
| Onboarding | `/comecar` | Duas etapas: modelo/provedor (grátis do opencode ou adicionar) e dados do agente + ferramentas. |
| Painel | `/i/:id/painel` | Atalhos para chat, modelo, ferramentas e ajustes. |
| Chat | `/i/:id/chat` | Conversa, modelo, ferramentas e nova conversa. `/i/:id` redireciona para cá. |
| Ferramentas | `/i/:id/conectores` | Lista limpa das ferramentas MCP instaladas. |
| Ferramenta | `/i/:id/conectores/:alias` | Página dedicada com configuração em passos: criar bot, credenciais, convite e conexão. |
| Ajustes | `/i/:id/config` | Identidade, provedores e exclusão do agente. |

A página inicial é a apresentação. "Começar agora" leva à criação em duas etapas: primeiro o modelo ou provedor
(os modelos grátis do opencode já aparecem selecionados), depois os dados do agente e as ferramentas MCP. Depois
de criar, o chat abre. Se já existem agentes, a página inicial mostra "continuar conversa" e a lista. A rota
`/sobre` redireciona para `/`. Novos agentes começam sem ferramentas: os conectores MCP são adicionados
explicitamente depois. Na interface, cada instância é chamada de agente e cada conector MCP aparece como
ferramenta.

A navegação entre painel, chat, ferramentas e ajustes é consistente em todas as telas de um agente. Links
antigos de configuração de conector (`?config=1`) são redirecionados para a página dedicada.

## Como funciona

1. O servidor sobe um processo `opencode` de catálogo isolado em `data/catalog`.
2. Ao criar um agente, o Hefesto inicia outro `opencode serve` em `data/engines/<id>`.
3. O Hefesto cria um agente do opencode por instância com o prompt da instância e usa esse agente nas conversas.
4. Provedores conectados pela interface gravam a chave somente no opencode do agente.
5. Ferramentas MCP são registradas no opencode do agente e reiniciam esse processo quando necessário.
6. O status das ferramentas vem do endpoint `GET /mcp` do opencode.

Cada processo `opencode` recebe um ambiente limpo. Variáveis como `OPENCODE_CONFIG`, `OPENCODE_DB`, `*_API_KEY`, `*_TOKEN`,
`AWS_*`, `AZURE_*` e `GOOGLE_APPLICATION_CREDENTIALS` são removidas para evitar vazamento de credenciais globais.

## Modelos e provedores

- Modelos marcados como grátis na interface pertencem apenas aos provedores embutidos `opencode` e `opencode-go`.
- Provedores adicionados pelo usuário aparecem somente quando configurados no agente.
- A API key é enviada ao opencode isolado e não é persistida pelo Hefesto.
- O modelo pode ser trocado no painel ou no chat; a escolha é salva no agente.

## Ferramentas MCP (conectores)

O catálogo começa com a ferramenta `discord` e aceita servidores MCP próprios via `local` (stdio) ou `remote`
(SSE/HTTP). Cada agente mantém sua própria lista de ferramentas.

### Discord

O conector `discord` executa um servidor MCP local por stdio e expõe 34 ferramentas com prefixo `discord_`:
guilds, canais, mensagens, threads, cargos, membros, avisos, aliases, permissões e utilitários (`echo`, `ping`,
`hora`).

A página da ferramenta conduz o usuário por quatro passos:

1. Criar a aplicação e o bot no Portal do Desenvolvedor do Discord.
2. Salvar o token do bot e o Application ID.
3. Convidar o bot para um servidor com o botão de convite.
4. Conectar a ferramenta ao opencode do agente.

O convite é gerado a partir do Application ID salvo e usa permissão de administrador. O token fica salvo apenas
em `data/instances.json`, nunca é devolvido pela API e aparece mascarado na interface.

Campos da ferramenta:

| Campo | Variável | Observação |
| --- | --- | --- |
| Token do bot | `DISCORD_TOKEN` | Obrigatório; salvo por agente e mascarado na API/UI. |
| Application ID | `DISCORD_APP_ID` | Opcional; necessário para gerar o convite. |
| Guild ID | `DISCORD_GUILD_ID` | Obrigatório para o bridge; o bot só responde a membros deste servidor. |
| Ativar bridge | `DISCORD_BRIDGE_ENABLED` | Desligado por padrão. Quando ativo, membros conversam com o agente pelo Discord. |
| Permitir DMs | `DISCORD_ALLOW_DMS` | Desligado por padrão. DMs não têm permissões de servidor e ficam no nível 1 (exceto o criador do bot). |
| Intent de conteúdo | `DISCORD_MESSAGE_CONTENT` | Ativo por padrão; ative o Message Content Intent no Portal para o bot ler mensagens no servidor. |
| Modo simulação | `DRY_RUN` | Opcional; não executa ações reais no Discord. |

O conector roda dentro do próprio Hefesto, em `packages/connectors/discord`. O bridge é opt-in: com `bridgeEnabled` ligado, `guildId` preenchido e token salvo, o servidor sobe um processo separado só para o bridge. O bridge responde a menções no servidor configurado e, se `allowDms` estiver ligado, a DMs.

O acesso tem três níveis. Membros usam conversa e ferramentas seguras de leitura. Quem tem a permissão específica da ação (canais, cargos, membros, convites) pode executá-la, sempre validada contra a hierarquia de cargos. O criador do bot tem acesso total, inclusive ferramentas do PC. Os agentes dos níveis 1 e 2 rodam com workspace vazio e sem shell, rede, edição de arquivos ou outros conectores; o criador usa o agente principal, com acesso ao PC.

## Configuração

O servidor carrega automaticamente o arquivo `.env` da raiz.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `4100` | Porta da interface web. No modo instalado, se estiver ocupada o launcher usa a próxima livre. |
| `OPENCODE_BIN` | `opencode` no PATH | Binário do opencode. |
| `HEFESTO_MODEL` | automático | Modelo padrão no formato `provedor/modelo`. |
| `HEFESTO_DATA_DIR` | `./data` no checkout; `~/.local/share/hefesto` no Linux instalado; `%LOCALAPPDATA%\Hefesto` no Windows | Diretório de persistência. |

## Persistência e segredos

| Caminho | Conteúdo |
| --- | --- |
| `data/instances.json` | Agentes (instâncias), modelos, sessões e ferramentas. |
| `data/instances.json.bak` | Versão anterior do arquivo de agentes. |
| `data/settings.json` | Ferramentas padrão do onboarding (legado). |
| `data/discord-memory.json` | Apelidos memorizados pelo conector Discord. |
| `data/discord-warnings.json` | Avisos registrados pelo conector Discord. |
| `data/catalog/` | Engine isolada do catálogo de modelos. |
| `data/engines/<id>/` | Dados, configuração, estado e cache de cada agente. |
| `data/hefesto-run.json` | PID e porta do servidor iniciado em segundo plano. |
| `data/hefesto.log` | Log do servidor iniciado em segundo plano. |

O diretório `data/` é ignorado pelo git. Campos secretos são mantidos localmente e mascarados em todas as respostas
da API.

Ao excluir um agente, o diretório `data/engines/<id>` é removido por padrão. Use a opção "Manter a conversa no
opencode" em Ajustes (ou `DELETE /api/instances/:id?keepHistory=1`) para preservar esse histórico. Os arquivos
`instances.json` e `settings.json` são versionados para permitir migrações futuras.

## API principal

| Rota | Descrição |
| --- | --- |
| `GET /api/status` | Status do app e do opencode (versões e saúde). |
| `GET /api/update` | Consulta (com cache) a última release e informa se há atualização. |
| `GET /api/provider-catalog` | Catálogo completo de provedores/modelos. |
| `GET /api/provider-catalog?meta=1` | Nomes de provedores para rótulos. |
| `GET/POST /api/instances` | Lista/cria agentes. |
| `GET/PATCH/DELETE /api/instances/:id` | Consulta/edita/exclui agente. `?keepHistory=1` preserva a conversa. |
| `GET /api/instances/:id/providers` | Provedores do opencode isolado. |
| `PUT /api/instances/:id/providers/:provider/auth` | Conecta chave no opencode isolado. |
| `GET /api/connectors/catalog` | Catálogo de ferramentas disponíveis. |
| `GET/PUT /api/settings/connectors/defaults` | Ferramentas padrão do onboarding (legado). |
| `GET/POST /api/instances/:id/connectors` | Lista/adiciona ferramentas do agente. |
| `PATCH/DELETE /api/instances/:id/connectors/:alias` | Edita/remove ferramenta. |
| `POST /api/instances/:id/connectors/:alias/connect` | Conecta uma ferramenta. |
| `POST /api/instances/:id/connectors/:alias/disconnect` | Desconecta uma ferramenta. |
| `POST /api/instances/:id/session` | Garante a sessão do agente. |
| `POST /api/instances/:id/reset` | Zera a sessão atual. |
| `POST /api/instances/:id/abort` | Interrompe a tarefa em andamento. |
| `POST /api/instances/:id/bridge` | Recebe uma mensagem do bridge Discord e devolve a resposta do agente. |
| `/oc/i/:id/...` | Proxy SSE/HTTP para o opencode do agente. |

## Estrutura

```text
packages/engine      cliente HTTP tipado do opencode (sessões, prompts, SSE, MCP)
packages/core        orquestrador, isolamento de ambiente, health check e registro de conectores
packages/server      API HTTP, proxy /oc/i/:id, estáticos e banner ASCII
packages/web         React + Vite: landing, onboarding, painel, chat, ferramentas e ajustes
packages/connectors  catálogo MCP e ferramenta Discord local (stdio + bridge inbound)
scripts              bootstrap Linux, instalador NSIS, empacotamento Windows, smoke e porta
packaging/winget     manifesto do Windows Package Manager
data/                agentes, catálogo e processos opencode isolados (ignorado pelo git)
```

## Scripts

| Comando | O que faz |
| --- | --- |
| `./scripts/bootstrap.sh` | Instala Node, opencode e Hefesto no Linux em user-space. |
| `./scripts/package-windows.sh [x64\|arm64]` | Gera o instalador `.exe` de Windows em `dist/` (Node + opencode inclusos). |
| `scripts/installer.nsi` | Script do instalador NSIS (atalhos, Path do usuário e desinstalador). |
| `hefesto` / `hefesto open` | Inicia (se preciso) em segundo plano e abre o navegador. |
| `hefesto stop` | Encerra o servidor em segundo plano. |
| `hefesto status` | Mostra estado, porta, PID e caminho do log. |
| `hefesto logs [-n N] [-f]` | Mostra (ou segue) o log do servidor em segundo plano. |
| `hefesto data` | Mostra o diretório de dados. |
| `hefesto doctor` | Diagnostica Node, opencode, build, porta e permissões. |
| `hefesto uninstall` | Remove a instalação (Linux/bootstrap); no Windows aponta o desinstalador. |
| `./scripts/uninstall.sh [--purge]` | Remove a instalação Linux, atalho e (com `--purge`) os dados. |
| `scripts/winget-manifest.mjs` | Gera o manifesto winget a partir dos checksums da release. |
| `hefesto start --foreground` | Roda o servidor no terminal, para desenvolvimento. |
| `hefesto upgrade` | Atualiza conforme a instalação (git, bootstrap ou instalador). |
| `npm start` | Builda a web e inicia o servidor; pergunta antes de encerrar um processo na porta. |
| `npm run start:server` | Inicia o servidor sem rebuildar a web. |
| `npm run dev` | Alias de `npm start`. |
| `npm run build` | Builda a interface web. |
| `npm run typecheck` | Checa tipos do servidor e da web. |
| `npm run smoke` | Smoke ponta a ponta, incluindo chamada de tool. |
| `SMOKE_SKIP_PROMPT=1 npm run smoke` | Smoke rápido, sem enviar prompt. |

## Solução de problemas

- **Porta ocupada:** no modo instalado o launcher inicia na próxima porta livre; no `npm start` ele pergunta se pode
  encerrar o processo atual. Defina `PORT` para escolher a porta base.
- **`opencode` não encontrado ou indisponível:** rode `hefesto doctor`, confira o `PATH` ou defina `OPENCODE_BIN` com o caminho do binário.
- **O app não inicia:** o launcher abre uma página local de erro com o final do log; use `hefesto logs` para ver tudo.
- **Ferramenta sem credenciais:** abra a ferramenta no painel e siga o passo de credenciais.
- **Histórico ausente:** o chat cria uma nova sessão automaticamente quando a anterior não existe mais.

---

Feito por **Salada de Flutrer**.
