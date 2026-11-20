import { useEffect, useState, type ReactNode } from "react";
import {
  discordInviteUrl,
  type ConnectorConfigValue,
  type ConnectorField,
  type ConnectorInput,
  type ConnectorView,
} from "../api";
import { missingRequiredSecret } from "./ConnectorStatusBadge";

type StepState = "done" | "current" | "pending";

function SetupStep({
  number,
  title,
  summary,
  state,
  active,
  onOpen,
  children,
}: {
  number: number;
  title: string;
  summary: string;
  state: StepState;
  active: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <li className={`setup-step is-${state}${active ? " is-active" : ""}`}>
      <button
        className="setup-step-head"
        type="button"
        onClick={onOpen}
        aria-expanded={active}
      >
        <span className="setup-step-marker" aria-hidden="true">
          {state === "done" ? "✓" : number}
        </span>
        <span className="setup-step-copy">
          <strong>{title}</strong>
          <span>{summary}</span>
        </span>
        <span className="setup-step-toggle" aria-hidden="true">
          {active ? "−" : "+"}
        </span>
      </button>
      {active && <div className="setup-step-body">{children}</div>}
    </li>
  );
}

export default function ConnectorDetailPanel({
  connector,
  busy,
  focusConfig = false,
  onConnect,
  onDisconnect,
  onToggleEnabled,
  onRemove,
  onSaveConfig,
}: {
  connector: ConnectorView;
  busy: boolean;
  focusConfig?: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onSaveConfig: (input: ConnectorInput) => void;
}) {
  const fields = connector.fields ?? [];
  const tools = connector.tools ?? [];
  const isDiscord = connector.definitionId === "discord";
  const botConfigured = !missingRequiredSecret(connector);
  const inviteUrl = isDiscord ? discordInviteUrl(connector.config?.appId) : undefined;
  const connected = connector.enabled && connector.status === "connected";
  const readyConnected = connected && botConfigured;
  const credentialsStep = isDiscord ? 2 : 1;
  const connectStep = isDiscord ? 4 : 2;
  const preferredStep = isDiscord
    ? !botConfigured
      ? 1
      : !inviteUrl
        ? 2
        : !readyConnected
          ? 3
          : 4
    : botConfigured
      ? 2
      : 1;

  const [activeStep, setActiveStep] = useState(focusConfig ? credentialsStep : preferredStep);
  const [editingCredentials, setEditingCredentials] = useState(!botConfigured);
  const [config, setConfig] = useState<Record<string, ConnectorConfigValue>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field.key,
        field.secret ? "" : (connector.config?.[field.key] ?? field.default ?? ""),
      ]),
    ),
  );
  const [url, setUrl] = useState(connector.transport?.type === "remote" ? connector.transport.url : "");
  const [command, setCommand] = useState(
    connector.transport?.type === "local" ? connector.transport.command.join("\n") : "",
  );
  const [toolQuery, setToolQuery] = useState("");
  const [inviteOpened, setInviteOpened] = useState(false);

  useEffect(() => {
    if (botConfigured) setEditingCredentials(false);
  }, [connector.secrets?.join(","), connector.alias]);

  const primaryFields = fields.filter(
    (field) =>
      field.key === "token" ||
      field.key === "appId" ||
      field.key === "bridgeEnabled" ||
      field.required ||
      field.secret,
  );
  const advancedFields = fields.filter((field) => !primaryFields.includes(field));
  const filteredTools = tools.filter((tool) => {
    const query = toolQuery.trim().toLowerCase();
    if (!query) return true;
    return `${tool.name} ${tool.description ?? ""}`.toLowerCase().includes(query);
  });

  function toggleStep(step: number) {
    setActiveStep((current) => (current === step ? 0 : step));
  }

  function stepState(number: number, done: boolean): StepState {
    if (done) return "done";
    return number === activeStep ? "current" : "pending";
  }

  function fieldValue(field: ConnectorField): string | boolean {
    const value = config[field.key];
    if (field.type === "checkbox") return Boolean(value ?? field.default ?? false);
    if (field.secret) return String(value ?? "");
    return String(value ?? field.default ?? "");
  }

  function setFieldValue(field: ConnectorField, value: string | boolean | null) {
    setConfig((previous) => ({ ...previous, [field.key]: value }));
  }

  function saveConfig() {
    const nextConfig: Record<string, ConnectorConfigValue> = {};
    for (const field of fields) {
      const value = config[field.key];
      if (value === null) {
        nextConfig[field.key] = null;
        continue;
      }
      if (field.type === "checkbox") {
        nextConfig[field.key] = Boolean(value ?? field.default ?? false);
      } else if (field.type === "number") {
        if (value === "" || value === undefined) continue;
        const numeric = Number(value);
        if (Number.isFinite(numeric)) nextConfig[field.key] = numeric;
      } else {
        const text = String(value ?? "").trim();
        if (text) nextConfig[field.key] = text;
      }
    }

    const input: ConnectorInput = {
      alias: connector.alias,
      definitionId: connector.definitionId,
      config: nextConfig,
    };
    if (connector.transport?.type === "remote") {
      input.transport = { ...connector.transport, url: url.trim() };
    } else if (connector.transport?.type === "local") {
      input.transport = {
        ...connector.transport,
        command: command.split("\n").map((part) => part.trim()).filter(Boolean),
      };
    }
    onSaveConfig(input);
    setEditingCredentials(false);
  }

  function renderField(field: ConnectorField) {
    const configured = field.secret && connector.secrets?.includes(field.key);
    return (
      <div className="field" key={field.key}>
        <div className="field-head">
          <label htmlFor={`field-${field.key}`}>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          {configured && (
            <span className="field-meta">
              <span className="connector-status-dot" aria-hidden="true" />
              configurado
              <button
                className="link-button"
                type="button"
                onClick={() => setFieldValue(field, null)}
              >
                limpar
              </button>
            </span>
          )}
        </div>
        <input
          id={`field-${field.key}`}
          type={field.type === "checkbox" ? "checkbox" : field.secret ? "password" : field.type}
          checked={field.type === "checkbox" ? Boolean(fieldValue(field)) : undefined}
          value={field.type === "checkbox" ? undefined : String(fieldValue(field))}
          placeholder={field.secret && configured ? "••••••••" : field.placeholder}
          autoComplete={field.secret ? "off" : undefined}
          onChange={(event) =>
            setFieldValue(
              field,
              field.type === "checkbox" ? event.target.checked : event.target.value,
            )
          }
        />
        {field.help && <span className="muted">{field.help}</span>}
      </div>
    );
  }

  return (
    <div className="connector-detail-layout">
      <section className="connector-flow" aria-labelledby="connector-flow-title">
        <div className="connector-flow-head">
          <h2 id="connector-flow-title">Configuração guiada</h2>
          <p className="muted">
            Siga os passos na ordem. Você pode voltar a qualquer etapa para revisar.
          </p>
        </div>

        <ol className="setup-flow">
          {isDiscord && (
            <SetupStep
              number={1}
              title="Crie o bot no Discord"
              summary={
                botConfigured || activeStep > 1
                  ? "Instruções concluídas"
                  : "Abra o portal e crie a aplicação"
              }
              state={stepState(1, botConfigured || activeStep > 1)}
              active={activeStep === 1}
              onOpen={() => toggleStep(1)}
            >
              <p className="flow-copy">
                Crie uma aplicação no Portal do Desenvolvedor, adicione um bot e copie o token e o
                Application ID.
              </p>
              <ol className="flow-mini-steps">
                <li>Abra o portal e clique em New Application.</li>
                <li>No menu Bot, clique em Add Bot.</li>
                <li>Em Token, clique em Reset Token e copie o valor.</li>
                <li>Em General Information, copie o Application ID.</li>
                <li>
                  Em Bot, ative o Message Content Intent em Privileged Gateway Intents. O Hefesto já
                  tenta usá-lo por padrão.
                </li>
              </ol>
              <div className="flow-links">
                <a
                  className="btn primary small"
                  href="https://discord.com/developers/applications?new_application=true"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Abrir portal
                </a>
                <a
                  className="btn ghost small"
                  href="https://discord.com/developers/docs/getting-started"
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  Tutorial oficial
                </a>
              </div>
              <div className="flow-actions">
                <button className="btn" type="button" onClick={() => setActiveStep(credentialsStep)}>
                  Já criei o bot
                </button>
              </div>
            </SetupStep>
          )}

          <SetupStep
            number={credentialsStep}
            title="Salve as credenciais"
            summary={botConfigured ? "Credenciais salvas" : "Token do bot e Application ID"}
            state={stepState(credentialsStep, botConfigured)}
            active={activeStep === credentialsStep}
            onOpen={() => toggleStep(credentialsStep)}
          >
            {botConfigured && !editingCredentials ? (
              <>
                <div className="flow-summary">
                  <span className="flow-summary-icon" aria-hidden="true">
                    ✓
                  </span>
                  <div>
                    <strong>Credenciais salvas</strong>
                    <p>
                      {connector.config?.appId
                        ? `Application ID ${String(connector.config.appId)} configurado.`
                        : "Token salvo. Informe o Application ID para liberar o convite."}
                    </p>
                  </div>
                  <button
                    className="btn ghost small"
                    type="button"
                    onClick={() => setEditingCredentials(true)}
                  >
                    Editar
                  </button>
                </div>
                <div className="flow-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => setActiveStep(isDiscord ? 3 : 2)}
                  >
                    {isDiscord ? "Continuar para convite" : "Continuar para conexão"}
                  </button>
                </div>
              </>
            ) : (
              <div className="form flow-form">
                {primaryFields.length > 0 && primaryFields.map(renderField)}
                {advancedFields.length > 0 && (
                  <details className="credential-advanced">
                    <summary>Opções avançadas</summary>
                    <div className="credential-advanced-body">
                      {advancedFields.map(renderField)}
                    </div>
                  </details>
                )}
                {!connector.definitionId && connector.transport?.type === "remote" && (
                  <div className="field">
                    <label htmlFor="detail-url">URL</label>
                    <input
                      id="detail-url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                    />
                  </div>
                )}
                {!connector.definitionId && connector.transport?.type === "local" && (
                  <div className="field">
                    <label htmlFor="detail-command">Comando</label>
                    <textarea
                      id="detail-command"
                      value={command}
                      onChange={(event) => setCommand(event.target.value)}
                    />
                  </div>
                )}
                {fields.length === 0 && !connector.definitionId && (
                  <p className="muted small">Nenhuma credencial adicional necessária.</p>
                )}
                <div className="flow-actions">
                  <button className="btn primary" type="button" disabled={busy} onClick={saveConfig}>
                    Salvar credenciais
                  </button>
                  {botConfigured && (
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setEditingCredentials(false)}
                    >
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            )}
          </SetupStep>

          {isDiscord && (
            <SetupStep
              number={3}
              title="Convide o bot para o servidor"
              summary={inviteOpened ? "Convite aberto" : inviteUrl ? "Convite disponível" : "Precisa do Application ID"}
              state={stepState(3, inviteOpened)}
              active={activeStep === 3}
              onOpen={() => toggleStep(3)}
            >
              <p className="flow-copy">
                Clique no botão, escolha o servidor e autorize as permissões. O bot só aparece nos
                servidores em que for convidado.
              </p>
              {inviteUrl ? (
                <div className="flow-invite">
                  <a
                    className="btn primary"
                    href={inviteUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={() => setInviteOpened(true)}
                  >
                    Convidar bot para o servidor
                  </a>
                  <span className="muted small">Permissão solicitada: Administrador.</span>
                </div>
              ) : (
                <p className="flow-hint">
                  Salve o Application ID no passo 2 para liberar o botão de convite.
                </p>
              )}
              <div className="flow-actions">
                {inviteUrl && (
                  <button className="btn" type="button" onClick={() => setActiveStep(4)}>
                    Já convidei
                  </button>
                )}
                <button className="btn ghost" type="button" onClick={() => setActiveStep(2)}>
                  Voltar às credenciais
                </button>
              </div>
            </SetupStep>
          )}

          <SetupStep
            number={connectStep}
            title="Conecte a ferramenta"
            summary={
              readyConnected
                ? "Ferramenta conectada"
                : connected
                  ? "MCP ativo, credenciais pendentes"
                  : "Último passo"
            }
            state={stepState(connectStep, readyConnected)}
            active={activeStep === connectStep}
            onOpen={() => toggleStep(connectStep)}
          >
            {readyConnected ? (
              <div className="flow-success">
                <span className="flow-summary-icon" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <strong>Ferramenta conectada</strong>
                  <p>
                    As ferramentas já estão disponíveis nas conversas deste agente. O bot também
                    pode responder menções e DMs no Discord.
                  </p>
                </div>
              </div>
            ) : connected ? (
              <p className="flow-hint">
                O servidor MCP já está ativo, mas faltam credenciais para o bot funcionar.
              </p>
            ) : (
              <p className="flow-copy">
                Com as credenciais salvas, conecte a ferramenta ao opencode deste agente.
              </p>
            )}
            {!botConfigured && !connected && (
              <p className="flow-hint">
                Salve as credenciais obrigatórias no passo {credentialsStep} antes de conectar.
              </p>
            )}
            <div className="flow-actions">
              {connected ? (
                <button className="btn" type="button" disabled={busy} onClick={onDisconnect}>
                  Desconectar
                </button>
              ) : (
                <button
                  className="btn primary"
                  type="button"
                  disabled={busy || !botConfigured}
                  onClick={onConnect}
                >
                  Conectar
                </button>
              )}
              <button className="btn ghost" type="button" disabled={busy} onClick={onToggleEnabled}>
                {connector.enabled ? "Desativar" : "Ativar"}
              </button>
            </div>
          </SetupStep>
        </ol>
      </section>

      <aside className="connector-aside">
        <div className="aside-card">
          <h3>Resumo</h3>
          <dl className="aside-facts">
            <div>
              <dt>Transporte</dt>
              <dd>
                {connector.transport?.type === "local"
                  ? "stdio"
                  : connector.transport?.type === "remote"
                    ? "remoto"
                    : "gerenciado"}
              </dd>
            </div>
            <div>
              <dt>Ferramentas</dt>
              <dd>{tools.length}</dd>
            </div>
            <div>
              <dt>Credenciais</dt>
              <dd>{connector.secrets?.length ? "salvas" : "pendentes"}</dd>
            </div>
            <div>
              <dt>Categoria</dt>
              <dd>{connector.category ?? "personalizado"}</dd>
            </div>
          </dl>
        </div>

        <div className="aside-card">
          <div className="aside-card-head">
            <h3>Ferramentas</h3>
            <span>{tools.length}</span>
          </div>
          {tools.length > 0 && (
            <input
              className="connector-search"
              value={toolQuery}
              onChange={(event) => setToolQuery(event.target.value)}
              placeholder="filtrar ferramentas..."
              aria-label="Filtrar ferramentas"
            />
          )}
          <div className="connector-tools">
            {filteredTools.length === 0 && (
              <p className="muted small">Nenhuma ferramenta encontrada.</p>
            )}
            {filteredTools.map((tool) => (
              <div className="connector-tool" key={tool.name}>
                <code>{tool.name}</code>
                {tool.description && <span className="muted">{tool.description}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="connector-danger-zone aside-danger">
          <div>
            <strong>Remover ferramenta</strong>
            <span className="muted small">Remove apenas deste agente.</span>
          </div>
          <button className="btn danger small" type="button" disabled={busy} onClick={onRemove}>
            Remover
          </button>
        </div>
      </aside>
    </div>
  );
}
