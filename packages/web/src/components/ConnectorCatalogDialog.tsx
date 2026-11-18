import { useEffect, useState } from "react";
import type { ConnectorDefinitionView, ConnectorInput } from "../api";
import ConnectorIcon from "./ConnectorIcon";

export default function ConnectorCatalogDialog({
  catalog,
  installed,
  busy,
  initialTab = "catalog",
  onAddDefinition,
  onAddCustom,
  onClose,
}: {
  catalog: ConnectorDefinitionView[];
  installed: string[];
  busy: boolean;
  initialTab?: "catalog" | "advanced";
  onAddDefinition: (definition: ConnectorDefinitionView) => void;
  onAddCustom: (input: ConnectorInput) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"catalog" | "advanced">(initialTab);
  const [query, setQuery] = useState("");
  const [alias, setAlias] = useState("");
  const [name, setName] = useState("");
  const [transportType, setTransportType] = useState<"remote" | "local">("remote");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const visible = catalog.filter((item) =>
    `${item.name} ${item.id} ${item.category} ${item.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );

  function addCustom() {
    const cleanAlias = alias.trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(cleanAlias)) {
      setError("alias inválido");
      return;
    }
    const transport: ConnectorInput["transport"] =
      transportType === "remote"
        ? { type: "remote", url: url.trim() }
        : {
            type: "local",
            command: command
              .split("\n")
              .map((part) => part.trim())
              .filter(Boolean),
          };
    if (transport.type === "remote" && !/^https?:\/\//.test(transport.url)) {
      setError("informe uma URL http(s)");
      return;
    }
    if (transport.type === "local" && transport.command.length === 0) {
      setError("informe ao menos um comando");
      return;
    }
    setError("");
    onAddCustom({ alias: cleanAlias, name: name.trim() || undefined, transport });
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="modal connector-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connector-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head connector-modal-head">
          <div className="connector-modal-title">
            <span className="connector-modal-mark" aria-hidden="true">
              ＋
            </span>
            <div>
              <span className="connectors-kicker">MCP</span>
              <h2 id="connector-modal-title">Adicionar conector</h2>
              <p className="muted small">
                Escolha um conector do catálogo ou conecte um servidor MCP próprio.
              </p>
            </div>
          </div>
          <button className="btn ghost small" type="button" onClick={onClose}>
            fechar
          </button>
        </div>

        <div className="tabs connector-modal-tabs">
          <button
            type="button"
            className={`tab${tab === "catalog" ? " active" : ""}`}
            onClick={() => setTab("catalog")}
          >
            Catálogo <span className="tab-count">{catalog.length}</span>
          </button>
          <button
            type="button"
            className={`tab${tab === "advanced" ? " active" : ""}`}
            onClick={() => setTab("advanced")}
          >
            Avançado
          </button>
        </div>

        {tab === "catalog" ? (
          <div className="connector-catalog-panel">
            <div className="connector-catalog-toolbar">
              <label className="connector-search-box">
                <span aria-hidden="true">⌕</span>
                <input
                  className="connector-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="buscar no catálogo..."
                  aria-label="Buscar no catálogo"
                  autoFocus
                />
              </label>
              <span className="muted small">
                {visible.length} {visible.length === 1 ? "conector" : "conectores"}
              </span>
            </div>

            <div className="connector-catalog-list">
              {visible.length === 0 && (
                <div className="connector-empty-state compact">
                  <span className="connector-empty-mark" aria-hidden="true">
                    ⌕
                  </span>
                  <strong>Nenhum conector encontrado</strong>
                  <p>Tente outro nome, categoria ou ferramenta.</p>
                </div>
              )}
              {visible.map((definition) => {
                const exists = installed.some(
                  (item) => item.toLowerCase() === definition.id.toLowerCase(),
                );
                return (
                  <div
                    className={`connector-catalog-item${exists ? " installed" : ""}`}
                    key={definition.id}
                  >
                    <span className="connector-card-icon">
                      <ConnectorIcon icon={definition.icon} name={definition.name} />
                    </span>
                    <div className="connector-catalog-copy">
                      <div className="connector-catalog-title">
                        <strong>{definition.name}</strong>
                        <span className="connector-catalog-category">{definition.category}</span>
                      </div>
                      <span className="muted small">{definition.description}</span>
                      <span className="connector-catalog-meta">
                        {definition.tools.length}{" "}
                        {definition.tools.length === 1 ? "ferramenta" : "ferramentas"}
                      </span>
                    </div>
                    <button
                      className={`btn small${exists ? " ghost" : " primary"}`}
                      type="button"
                      disabled={exists || busy}
                      onClick={() => onAddDefinition(definition)}
                    >
                      {exists ? "instalado" : "instalar"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="connector-advanced form">
            <div className="connector-advanced-note">
              <strong>Servidor MCP próprio</strong>
              <p className="muted small">
                Use um endpoint remoto HTTP/SSE ou um processo local via stdio. O conector fica
                registrado apenas nesta instância.
              </p>
            </div>
            <div className="connector-form-grid">
              <div className="field">
                <label htmlFor="connector-alias">alias</label>
                <input
                  id="connector-alias"
                  value={alias}
                  onChange={(event) => setAlias(event.target.value)}
                  placeholder="meu-mcp"
                />
              </div>
              <div className="field">
                <label htmlFor="connector-name">nome (opcional)</label>
                <input
                  id="connector-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Meu MCP"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="connector-transport">transporte</label>
              <select
                id="connector-transport"
                value={transportType}
                onChange={(event) => setTransportType(event.target.value as "remote" | "local")}
              >
                <option value="remote">remoto (SSE/HTTP)</option>
                <option value="local">local (stdio)</option>
              </select>
            </div>
            {transportType === "remote" ? (
              <div className="field">
                <label htmlFor="connector-url">url</label>
                <input
                  id="connector-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="http://127.0.0.1:3000/mcp"
                />
              </div>
            ) : (
              <div className="field">
                <label htmlFor="connector-command">comando (um argumento por linha)</label>
                <textarea
                  id="connector-command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder={"node\n/caminho/servidor.js"}
                />
              </div>
            )}
            {error && <p className="error-text">{error}</p>}
            <div className="config-actions">
              <button className="btn primary" type="button" disabled={busy} onClick={addCustom}>
                adicionar conector
              </button>
              <span className="muted small">Você pode editar isso depois.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
