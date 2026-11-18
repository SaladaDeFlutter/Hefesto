<p align="center">
  <img src="docs/hefesto-banner.svg" alt="Hefesto — a forja de agentes opencode" width="100%">
</p>

Hefesto é uma aplicação web local para criar e operar agentes de código. Cada agente é uma **instância**
independente, com identidade própria, modelo selecionado, conversa persistida e um processo `opencode serve`
isolado.

A interface reúne onboarding, painel, chat, configurações e conectores MCP em um só lugar. A engine do catálogo
e as engines das instâncias são separadas: nenhuma credencial ou conector vaza de uma instância para outra.

## Destaques

- Instâncias com foto, nome, descrição, personalidade, instruções, cor e modelo.
- Um `opencode serve` isolado por instância, com portas e diretórios próprios.
- Chat com histórico, streaming, status de execução, parada por `Esc` e renderização Markdown.
- Modelos gratuitos do pacote embutido do opencode: `opencode` e `opencode-go`.
- Provedores externos conectados com API key apenas na engine da instância.
- Conectores MCP por instância, com configuração guiada, credenciais mascaradas e status real.
- Conector Discord com 34 ferramentas, convite de bot e bridge inbound para menções/DMs.
- Servidor local com API HTTP, proxy SSE/HTTP e banner ASCII no terminal.
- `npm start` detecta a porta ocupada e pergunta se pode encerrar o processo atual.

## Requisitos

- Node.js 26 ou superior
- npm
- binário `opencode` disponível no `PATH`

## Instalação no Linux

### Usuário sem nada (recomendado)

Requisitos mínimos: Linux x86_64/arm64 com `curl`, `tar` e `gzip`. O bootstrap instala tudo em `~/.hefesto`, sem
sudo: Node 26 portátil, `opencode-ai`, o código do Hefesto, a build da web e o comando `hefesto`.

```bash
curl -fsSL https://raw.githubusercontent.com/SaladaDeFlutter/Hefesto/refs/heads/main/scripts/bootstrap.sh | bash
```

Abra um novo terminal ou ajuste o `PATH` se o instalador avisar:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Depois:

```bash
hefesto
```

O comando imprime o banner ASCII, sobe o servidor com a web pronta e abre o navegador. Para não abrir:

```bash
hefesto --no-open
```

Para atualizar:

```bash
hefesto upgrade
```

O upgrade baixa a versão atual do repositório, rebuilda e troca o código. A instalação ocupa aproximadamente 500 MB.
Você pode trocar o destino com `HEFESTO_HOME` e o diretório do comando com `HEFESTO_BIN_DIR`.

### Desenvolvedor / checkout

Para trabalhar no código:

```bash
git clone https://github.com/SaladaDeFlutter/Hefesto.git
cd Hefesto
./scripts/install.sh
```

O instalador roda o build, cria o comando `hefesto` em `~/.local/bin` e deixa o upgrade ligado ao git. Nesse modo,
`hefesto upgrade` faz `git pull --ff-only`, `npm install` e `npm run build`.

Instalações feitas a partir do checkout usam `./data`. O bootstrap e o pacote npm usam `~/.local/share/hefesto` por
padrão; defina `HEFESTO_DATA_DIR` para escolher outro diretório.

### Pacote npm

Depois de publicado, o pacote pode ser instalado globalmente:

```bash
npm install -g @saladadeflutter/hefesto
```

Para gerar e instalar um pacote local com a web já buildada:

```bash
npm run build
npm pack
npm install -g ./saladadeflutter-hefesto-0.0.0.tgz
```

Nesse modo, `hefesto upgrade` usa `npm install -g @saladadeflutter/hefesto@latest`.

## Instalação no Windows

Windows nativo não executa `bash`, então o entrypoint é PowerShell. O fluxo é o mesmo do Linux: Node portátil,
opencode, código do Hefesto, build, comando e upgrade.

Abra o PowerShell e rode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/SaladaDeFlutter/Hefesto/refs/heads/main/scripts/bootstrap.ps1 | iex"
```

Depois abra um novo terminal:

```powershell
hefesto
```

O instalador cria `%USERPROFILE%\.local\bin\hefesto.cmd`, adiciona ao PATH do usuário e instala tudo em
`%USERPROFILE%\.hefesto`, sem precisar de administrador. Suporta Windows x64 e arm64.

Para atualizar:

```powershell
hefesto upgrade
```

Feche o Hefesto antes de rodar o upgrade no Windows. O upgrade usa o `bootstrap.ps1` local e não depende de git.

## Como rodar


```bash
npm install
npm start
```

Abra <http://127.0.0.1:4100>.

O `npm start` executa o build da interface e inicia o servidor. Se a porta configurada já estiver em uso, o script
`prestart` mostra o processo, pergunta se pode encerrá-lo e só continua após confirmação.

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
| Início | `/` | Status do catálogo, apresentação e lista de instâncias. |
| Onboarding | `/comecar` | Escolha do modelo, provedor opcional, conectores iniciais e criação da instância. |
| Painel | `/i/:id` | Atalhos para chat, modelo, conectores e ajustes; prompt do agente recolhível. |
| Chat | `/i/:id/chat` | Conversa, modelo, conectores ativos e nova conversa. |
| Conectores | `/i/:id/conectores` | Lista limpa dos conectores instalados. |
| Conector | `/i/:id/conectores/:alias` | Página dedicada com configuração em passos: criar bot, credenciais, convite e conexão. |
| Ajustes | `/i/:id/config` | Identidade, prompt, provedores e exclusão da instância. |

A navegação entre painel, chat, conectores e ajustes é consistente em todas as telas de uma instância. Links
antigos de configuração de conector (`?config=1`) são redirecionados para a página dedicada.

## Como funciona

1. O servidor sobe uma engine de catálogo isolada em `data/catalog`.
2. Ao criar uma instância, o Hefesto inicia outra engine `opencode serve` em `data/engines/<id>`.
3. O modelo escolhido e o prompt da instância são enviados nas conversas daquela engine.
4. Provedores conectados pela interface gravam a chave somente no opencode da instância.
5. Conectores MCP são registrados na engine da instância e reiniciam essa engine quando necessário.
6. O status dos conectores vem do endpoint `GET /mcp` do opencode.

Cada engine recebe um ambiente limpo. Variáveis como `OPENCODE_CONFIG`, `OPENCODE_DB`, `*_API_KEY`, `*_TOKEN`,
`AWS_*`, `AZURE_*` e `GOOGLE_APPLICATION_CREDENTIALS` são removidas para evitar vazamento de credenciais globais.

## Modelos e provedores

- Modelos marcados como grátis na interface pertencem apenas aos provedores embutidos `opencode` e `opencode-go`.
- Provedores adicionados pelo usuário aparecem somente quando configurados na instância.
- A API key é enviada à engine isolada e não é persistida pelo Hefesto.
- O modelo pode ser trocado no painel ou no chat; a escolha é salva na instância.

## Conectores MCP

O catálogo começa com o conector `discord` e aceita servidores MCP próprios via `local` (stdio) ou `remote`
(SSE/HTTP). Cada instância mantém sua própria lista de conectores.

### Discord

O conector `discord` executa um servidor MCP local por stdio e expõe 34 ferramentas com prefixo `discord_`:
guilds, canais, mensagens, threads, cargos, membros, avisos, aliases, permissões e utilitários (`echo`, `ping`,
`hora`).

A página do conector conduz o usuário por quatro passos:

1. Criar a aplicação e o bot no Portal do Desenvolvedor do Discord.
2. Salvar o token do bot e o Application ID.
3. Convidar o bot para um servidor com o botão de convite.
4. Conectar o conector à engine da instância.

O convite é gerado a partir do Application ID salvo e usa permissão de administrador. O token fica salvo apenas
em `data/instances.json`, nunca é devolvido pela API e aparece mascarado na interface.

Campos do conector:

| Campo | Variável | Observação |
| --- | --- | --- |
| Token do bot | `DISCORD_TOKEN` | Obrigatório; salvo por instância e mascarado na API/UI. |
| Application ID | `DISCORD_APP_ID` | Opcional; necessário para gerar o convite. |
| Guild ID | `DISCORD_GUILD_ID` | Opcional; restringe ferramentas a um servidor. |
| Intent de conteúdo | `DISCORD_MESSAGE_CONTENT` | Opcional; necessário para ler texto de mensagens no servidor. |
| Modo simulação | `DRY_RUN` | Opcional; não executa ações reais no Discord. |

O conector roda dentro do próprio Hefesto, em `packages/connectors/discord`. O bridge responde a menções e DMs. Ao iniciar, o servidor sobe automaticamente as instâncias que têm token salvo para manter o bot online.

## Configuração

O servidor carrega automaticamente o arquivo `.env` da raiz.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `4100` | Porta da interface web. |
| `OPENCODE_BIN` | `opencode` no PATH | Binário do motor. |
| `HEFESTO_MODEL` | automático | Modelo padrão no formato `provedor/modelo`. |
| `HEFESTO_DATA_DIR` | `./data` no checkout; `~/.local/share/hefesto` no CLI global | Diretório de persistência. |

## Persistência e segredos

| Caminho | Conteúdo |
| --- | --- |
| `data/instances.json` | Instâncias, modelos, sessões e conectores. |
| `data/instances.json.bak` | Versão anterior do arquivo de instâncias. |
| `data/settings.json` | Conectores padrão do onboarding. |
| `data/discord-memory.json` | Apelidos memorizados pelo conector Discord. |
| `data/discord-warnings.json` | Avisos registrados pelo conector Discord. |
| `data/catalog/` | Engine isolada do catálogo de modelos. |
| `data/engines/<id>/` | Dados, configuração, estado e cache de cada instância. |

O diretório `data/` é ignorado pelo git. Campos secretos são mantidos localmente e mascarados em todas as respostas
da API.

## API principal

| Rota | Descrição |
| --- | --- |
| `GET /api/status` | Status do catálogo opencode. |
| `GET /api/provider-catalog` | Catálogo completo de provedores/modelos. |
| `GET /api/provider-catalog?meta=1` | Nomes de provedores para rótulos. |
| `GET/POST /api/instances` | Lista/cria instâncias. |
| `GET/PATCH/DELETE /api/instances/:id` | Consulta/edita/exclui instância. |
| `GET /api/instances/:id/providers` | Provedores da engine isolada. |
| `PUT /api/instances/:id/providers/:provider/auth` | Conecta chave na engine isolada. |
| `GET /api/connectors/catalog` | Catálogo de conectores disponíveis. |
| `GET/PUT /api/settings/connectors/defaults` | Conectores padrão do onboarding. |
| `GET/POST /api/instances/:id/connectors` | Lista/adiciona conectores da instância. |
| `PATCH/DELETE /api/instances/:id/connectors/:alias` | Edita/remove conector. |
| `POST /api/instances/:id/connectors/:alias/connect` | Conecta um conector. |
| `POST /api/instances/:id/connectors/:alias/disconnect` | Desconecta um conector. |
| `POST /api/instances/:id/session` | Garante a sessão da instância. |
| `POST /api/instances/:id/reset` | Zera a sessão atual. |
| `POST /api/instances/:id/abort` | Interrompe a tarefa em andamento. |
| `POST /api/instances/:id/bridge` | Recebe uma mensagem do bridge Discord e devolve a resposta da instância. |
| `/oc/i/:id/...` | Proxy SSE/HTTP para a engine da instância. |

## Estrutura

```text
packages/engine      cliente HTTP tipado do opencode (sessões, prompts, SSE, MCP)
packages/core        orquestrador, isolamento de ambiente, health check e registro de conectores
packages/server      API HTTP, proxy /oc/i/:id, estáticos e banner ASCII
packages/web         React + Vite: landing, onboarding, painel, chat, conectores e ajustes
packages/connectors  catálogo MCP e conector Discord local (stdio + bridge inbound)
scripts              bootstrap Linux/Windows, instalação, smoke e verificação interativa da porta
data/                instâncias, catálogo e engines isoladas (ignorado pelo git)
```

## Scripts

| Comando | O que faz |
| --- | --- |
| `./scripts/bootstrap.sh` | Instala Node, opencode e Hefesto no Linux em user-space. |
| `scripts/bootstrap.ps1` | Instala Node, opencode e Hefesto no Windows em user-space. |
| `hefesto` | Inicia a build instalada, com banner ASCII e navegador. |
| `hefesto upgrade` | Atualiza o checkout e rebuilda a aplicação. |
| `npm start` | Builda a web e inicia o servidor; pergunta antes de encerrar um processo na porta. |
| `npm run start:server` | Inicia o servidor sem rebuildar a web. |
| `npm run dev` | Alias de `npm start`. |
| `npm run build` | Builda a interface web. |
| `npm run typecheck` | Checa tipos do servidor e da web. |
| `npm run smoke` | Smoke ponta a ponta, incluindo chamada de tool. |
| `SMOKE_SKIP_PROMPT=1 npm run smoke` | Smoke rápido, sem enviar prompt. |

## Solução de problemas

- **Porta ocupada:** o `npm start` pergunta se pode encerrar o processo atual; responda `s` para liberar ou defina
  `PORT` para usar outra porta.
- **`opencode` não encontrado:** confira o `PATH` ou defina `OPENCODE_BIN` com o caminho do binário.
- **Conector sem credenciais:** abra o conector no painel e siga o passo de credenciais.
- **Histórico ausente:** o chat cria uma nova sessão automaticamente quando a anterior não existe mais.

---

Feito por **Salada de Flutrer**.
