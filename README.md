# Hefestos

```text
██╗  ██╗███████╗███████╗███████╗███████╗████████╗ ██████╗
██║  ██║██╔════╝██╔════╝██╔════╝██╔════╝╚══██╔══╝██╔═══██╗
███████║█████╗  █████╗  █████╗  ███████╗   ██║   ██║   ██║
██╔══██║██╔══╝  ██╔══╝  ██╔══╝  ╚════██║   ██║   ██║   ██║
██║  ██║███████╗██║     ███████╗███████║   ██║   ╚██████╔╝
╚═╝  ╚═╝╚══════╝╚═╝     ╚══════╝╚══════╝   ╚═╝    ╚═════╝
```

A forja de agentes do [opencode](https://opencode.ai). O Hefestos é uma aplicação web local para criar
**instâncias**: agentes com foto, nome, descrição, personalidade, instruções, modelo e um `opencode serve`
isolado por instância.

O mesmo ASCII acima aparece colorido no terminal ao iniciar o servidor e na tela inicial da interface.

## Como rodar

Requer Node 26+ (type stripping nativo de TypeScript) e o binário `opencode` no `PATH`.

```bash
npm install
npm start
```

Abra <http://127.0.0.1:4100>. O comando builda a web e inicia o servidor.

Para rodar só o servidor com a web já buildada:

```bash
npm run build
npm run start:server
```

## Fluxo

1. **Landing** (`/`) — mostra o status do catálogo, o desenho ASCII e as instâncias existentes.
2. **Começar** (`/comecar`) — escolha um modelo grátis ou conecte um provedor com API key; depois crie a
   instância (foto, nome, descrição, personalidade, instruções e cor).
3. **Instância** (`/i/:id`) — painel com chat, troca de modelo, configurações e o card do Discord (em breve).
4. **Chat** (`/i/:id/chat`) — conversa com o prompt da instância, histórico, status de execução, botão de
   parar (`Esc`) e ferramentas do opencode.
5. **Configurações** (`/i/:id/config`) — edita identidade/prompt, conecta provedores e reseta a conversa.

## Isolamento

Cada instância tem seu próprio processo `opencode serve`, com diretórios XDG e portas próprias:

- `data/engines/<id>/data`
- `data/engines/<id>/config`
- `data/engines/<id>/state`
- `data/engines/<id>/cache`

O ambiente de cada engine remove variáveis como `OPENCODE_CONFIG`, `OPENCODE_DB`, `*_API_KEY`, `*_TOKEN`,
`AWS_*`, `AZURE_*` e `GOOGLE_APPLICATION_CREDENTIALS`. Assim, nenhuma credencial global vaza para a instância.

O catálogo de provedores/modelos vem do próprio opencode (models.dev) e roda isolado em `data/catalog`.
Chaves conectadas pela interface são gravadas apenas no opencode da instância; o Hefesto nunca as salva.

Conversas criadas no opencode global não são migradas automaticamente. Ao abrir uma instância antiga, o chat
detecta a sessão ausente e cria uma nova.

## Configuração

O servidor carrega `.env` da raiz automaticamente.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `4100` | porta da interface web |
| `OPENCODE_BIN` | `opencode` no PATH | binário do motor |
| `HEFESTO_MODEL` | automático | modelo padrão no formato `provedor/modelo` |
| `HEFESTO_DATA_DIR` | `./data` | diretório de persistência |

## Persistência

As instâncias ficam em `data/instances.json`. A cada gravação, o Hefesto mantém a versão anterior em
`data/instances.json.bak`. Todo esse diretório é ignorado pelo git.

## API principal

| Rota | Descrição |
| --- | --- |
| `GET /api/status` | status do catálogo opencode |
| `GET /api/provider-catalog` | catálogo completo de provedores/modelos |
| `GET /api/provider-catalog?meta=1` | nomes de provedores para rótulos |
| `GET/POST /api/instances` | lista/cria instâncias |
| `GET/PATCH/DELETE /api/instances/:id` | consulta/edita/exclui instância |
| `GET /api/instances/:id/providers` | provedores da engine isolada |
| `PUT /api/instances/:id/providers/:provider/auth` | conecta chave na engine isolada |
| `POST /api/instances/:id/session` | garante sessão da instância |
| `POST /api/instances/:id/reset` | zera a sessão atual |
| `POST /api/instances/:id/abort` | interrompe a tarefa em andamento |
| `/oc/i/:id/...` | proxy SSE/HTTP para a engine da instância |

## Estrutura

```text
packages/engine      cliente HTTP tipado do opencode (sessões, prompts, SSE, MCP)
packages/core        orquestrador: sobe o opencode, ambientes isolados, health check, conector discord
packages/server      HTTP: API de instâncias/catálogo, proxy /oc/i/:id, estáticos e banner ASCII
packages/web         React + Vite: landing, onboarding, painel e chat
packages/connectors  conectores MCP (discord é um stub por enquanto)
scripts/smoke-web.ts smoke ponta a ponta do servidor
data/                instâncias, catálogo e motores isolados (ignorado pelo git)
```

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm start` | builda a web e inicia tudo |
| `npm run build` | builda a web |
| `npm run typecheck` | checa tipos do servidor e da web |
| `npm run smoke` | smoke ponta a ponta, incluindo chamada de tool |
| `SMOKE_SKIP_PROMPT=1 npm run smoke` | smoke rápido, sem enviar prompt |

## Discord

O conector MCP `discord` já é registrado nas engines, mas as ferramentas ainda são stubs. A integração com bots
fica para a próxima etapa.
