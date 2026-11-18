import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  api,
  modelKey,
  type CatalogProvider,
  type ConnectorDefinitionView,
  type HefestoStatus,
  type ModelRef,
  type ProviderInfo,
} from "../api";
import AvatarUpload from "../components/AvatarUpload";
import ModelSelect from "../components/ModelSelect";
import TopBar from "../components/TopBar";

interface PendingAuth {
  providerID: string;
  key: string;
  name: string;
}

function providerOptions(catalog: CatalogProvider[], pending?: PendingAuth): ProviderInfo[] {
  const byId = new Map<string, ProviderInfo>();
  for (const provider of catalog) {
    const free = provider.models.filter((m) => m.free);
    if (!free.length) continue;
    byId.set(provider.id, {
      id: provider.id,
      name: provider.name,
      env: [],
      configured: false,
      models: free,
    });
  }
  if (pending) {
    const provider = catalog.find((p) => p.id === pending.providerID);
    if (provider) {
      byId.set(provider.id, {
        id: provider.id,
        name: provider.name,
        env: [],
        configured: true,
        models: provider.models,
      });
    }
  }
  return [...byId.values()];
}

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [modelTab, setModelTab] = useState<"model" | "provider">("model");
  const [status, setStatus] = useState<HefestoStatus | null>(null);
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [connectorCatalog, setConnectorCatalog] = useState<ConnectorDefinitionView[]>([]);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [model, setModel] = useState<ModelRef | undefined>();
  const [providerID, setProviderID] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [pendingAuth, setPendingAuth] = useState<PendingAuth | undefined>();
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [personality, setPersonality] = useState("");
  const [instructions, setInstructions] = useState("");
  const [accent, setAccent] = useState("#f59e0b");
  const [avatar, setAvatar] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.status(), api.providerCatalog(), api.connectorCatalog(), api.defaultConnectors()])
      .then(([st, cat, connectors, defaults]) => {
        if (!alive) return;
        setStatus(st);
        setCatalog(cat.providers);
        setConnectorCatalog(connectors.connectors);
        setSelectedConnectors(defaults.defaultConnectors);
        if (st.defaultModel) {
          setModel(st.defaultModel);
        } else {
          const provider = cat.providers.find((p) => p.id === "opencode") ?? cat.providers.find((p) => p.models.some((m) => m.free));
          const free = provider?.models.find((m) => m.free);
          if (provider && free) setModel({ providerID: provider.id, modelID: free.id });
        }
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  function addProvider() {
    const provider = catalog.find((p) => p.id === providerID.trim());
    if (!provider) {
      setError("provedor não encontrado no catálogo");
      return;
    }
    if (!providerKey.trim()) {
      setError("cole a API key do provedor");
      return;
    }
    setPendingAuth({ providerID: provider.id, key: providerKey.trim(), name: provider.name });
    const preferred = provider.models.find((m) => m.free) ?? provider.models[0];
    if (preferred) setModel({ providerID: provider.id, modelID: preferred.id });
    setProviderID("");
    setProviderKey("");
    setError("");
    setModelTab("model");
  }

  async function create() {
    if (!name.trim()) {
      setError("dê um nome à sua instância");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.setDefaultConnectors(selectedConnectors);
      const { instance } = await api.createInstance({
        name: name.trim(),
        tagline: tagline.trim() || undefined,
        personality: personality.trim() || undefined,
        instructions: instructions.trim() || undefined,
        accent,
        avatar,
        model,
        connectors: selectedConnectors.map((id) => ({ alias: id, definitionId: id, enabled: true })),
        auth: pendingAuth ? { providerID: pendingAuth.providerID, key: pendingAuth.key } : undefined,
      });
      navigate(`/i/${instance.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const providers = providerOptions(catalog, pendingAuth);
  const freeProviders = catalog.filter((p) => p.models.some((m) => m.free));
  const selected = catalog.find((p) => p.id === providerID.trim());

  return (
    <div className="page">
      <TopBar
        right={
          <span className="engine-chip">
            <span className={status?.running ? "dot online" : "dot"} />
            {status ? `opencode ${status.version ?? "?"}` : "conectando ao motor…"}
          </span>
        }
      />

      <main className="wizard">
        <div className="steps">
          <div className={`step ${step === 1 ? "active" : "done"}`}>
            <span className="step-num">1</span> Modelo e provedor
          </div>
          <div className="step-line" />
          <div className={`step ${step === 2 ? "active" : ""}`}>
            <span className="step-num">2</span> Sua instância
          </div>
        </div>

        {error ? <div className="banner error">{error}</div> : null}

        {step === 1 ? (
          <section className="panel">
            <h1>Escolha o modelo</h1>
            <p className="muted">
              Cada instância terá um opencode isolado, com modelos, credenciais e conversa próprios. Escolha entre os
              modelos incluídos no opencode ou adicione um provedor com sua chave — ela fica só nesta instância.
            </p>

            <div className="tabs setup-tabs">
              <button
                type="button"
                className={`tab${modelTab === "model" ? " active" : ""}`}
                onClick={() => setModelTab("model")}
              >
                Modelo padrão
              </button>
              <button
                type="button"
                className={`tab${modelTab === "provider" ? " active" : ""}`}
                onClick={() => setModelTab("provider")}
              >
                Adicionar provedor
              </button>
            </div>

            {modelTab === "model" ? (
              <div className="model-choice">
                <div className="provider-list">
                  <h3 className="section-title">Incluídos no opencode</h3>
                  {freeProviders.length === 0 ? <p className="muted">nenhum modelo incluído encontrado</p> : null}
                  {freeProviders.map((provider) => {
                    const first = provider.models.find((m) => m.free);
                    const count = provider.models.filter((m) => m.free).length;
                    return (
                      <div key={provider.id} className="provider-row">
                        <div className="provider-main">
                          <div>
                            <strong>{provider.name}</strong>
                            <span className="muted small"> · {count} modelo{count === 1 ? "" : "s"}</span>
                          </div>
                          <button
                            type="button"
                            className="btn small ghost"
                            disabled={!first}
                            onClick={() => first && setModel({ providerID: provider.id, modelID: first.id })}
                          >
                            usar
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {pendingAuth && (
                  <div className="provider-list">
                    <h3 className="section-title">Seu provedor</h3>
                    <div className="provider-row">
                      <div className="provider-main">
                        <div>
                          <strong>{pendingAuth.name}</strong>
                          <span className="muted small"> · chave será aplicada na criação</span>
                        </div>
                        <div className="provider-actions">
                          <span className="badge ok">pronto</span>
                          <button
                            type="button"
                            className="btn small ghost"
                            onClick={() => setModelTab("provider")}
                          >
                            trocar
                          </button>
                          <button
                            type="button"
                            className="btn small ghost"
                            onClick={() => {
                              const provider =
                                catalog.find((p) => p.id === "opencode") ??
                                catalog.find((p) => p.models.some((m) => m.free));
                              const free = provider?.models.find((m) => m.free);
                              setPendingAuth(undefined);
                              setModel(
                                status?.defaultModel ??
                                  (provider && free ? { providerID: provider.id, modelID: free.id } : undefined),
                              );
                            }}
                          >
                            remover
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="field">
                  <label htmlFor="model">Modelo padrão</label>
                  <ModelSelect providers={providers} value={model} onChange={setModel} allowEmpty />
                  {providers.length === 0 ? (
                    <span className="hint">
                      Sem provedor configurado você pode criar a instância e escolher o modelo depois.
                    </span>
                  ) : (
                    <span className="hint">atual: {modelKey(model) || "decidir depois"}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="provider-list">
                <h3 className="section-title">Adicionar provedor</h3>
                <p className="muted small">
                  A chave não é salva no Hefesto: ela é gravada no opencode isolado desta instância. Depois de
                  adicionar, escolha um dos modelos dele na aba Modelo padrão.
                </p>
                <div className="provider-connect">
                  <input
                    list="provider-catalog"
                    placeholder="provedor (ex.: openai, anthropic, deepseek)"
                    value={providerID}
                    onChange={(e) => {
                      setProviderID(e.target.value);
                      setError("");
                    }}
                  />
                  <datalist id="provider-catalog">
                    {catalog.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </datalist>
                  <input
                    type="password"
                    placeholder="API key"
                    value={providerKey}
                    onChange={(e) => setProviderKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProvider();
                    }}
                  />
                  <button type="button" className="btn small" onClick={addProvider}>
                    Adicionar
                  </button>
                </div>
                {selected ? (
                  <span className="hint">
                    {selected.name} · {selected.models.length} modelos
                  </span>
                ) : null}
              </div>
            )}

            <div className="actions">
              <button type="button" className="btn primary" onClick={() => setStep(2)}>
                Continuar
              </button>
            </div>
          </section>
        ) : (
          <section className="panel">
            <h1>Forje sua instância</h1>
            <p className="muted">
              Esses dados viram a identidade e o prompt do agente. Escolha também os conectores
              iniciais; tudo pode ser editado depois.
            </p>

            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <AvatarUpload name={name || "?"} accent={accent} value={avatar} onChange={setAvatar} />

              <div className="field">
                <label htmlFor="name">Nome *</label>
                <input
                  id="name"
                  autoFocus
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex.: Forja"
                />
              </div>

              <div className="field">
                <label htmlFor="tagline">Descrição curta</label>
                <input
                  id="tagline"
                  value={tagline}
                  maxLength={200}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="o que essa instância faz?"
                />
              </div>

              <div className="field">
                <label htmlFor="personality">Personalidade e tom</label>
                <textarea
                  id="personality"
                  value={personality}
                  maxLength={2000}
                  rows={3}
                  onChange={(e) => setPersonality(e.target.value)}
                  placeholder="ex.: direto, técnico e bem-humorado"
                />
              </div>

              <div className="field">
                <label htmlFor="instructions">Instruções permanentes</label>
                <textarea
                  id="instructions"
                  value={instructions}
                  maxLength={4000}
                  rows={4}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="ex.: responda em português e explique as decisões"
                />
              </div>

              <div className="field">
                <label htmlFor="accent">Cor de destaque</label>
                <input
                  id="accent"
                  type="color"
                  value={accent}
                  onChange={(e) => setAccent(e.target.value)}
                />
              </div>

            <div className="provider-list">
              <h3 className="section-title">Conectores iniciais</h3>
              <p className="muted small">
                Cada conector vira um servidor MCP registrado somente na engine desta instância. Você pode
                adicionar outros depois em Conectores.
              </p>
              {connectorCatalog.map((connector) => (
                <label className="provider-row" key={connector.id}>
                  <div className="provider-main">
                    <div>
                      <strong>{connector.name}</strong>
                      <span className="muted small"> · {connector.description}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={selectedConnectors.includes(connector.id)}
                      onChange={(e) =>
                        setSelectedConnectors((current) =>
                          e.target.checked
                            ? [...current, connector.id]
                            : current.filter((id) => id !== connector.id),
                        )
                      }
                    />
                  </div>
                </label>
              ))}
              {selectedConnectors.includes("discord") && (
                <div className="banner info small">
                  <strong>Próximo passo:</strong> depois de criar a instância, abra o conector Discord no painel
                  e siga o passo a passo para configurar o bot e convidá-lo.
                </div>
              )}
            </div>

              <div className="actions">
                <button type="button" className="btn ghost" onClick={() => setStep(1)} disabled={saving}>
                  Voltar
                </button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "forjando…" : "Forjar instância"}
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
