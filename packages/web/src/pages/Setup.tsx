import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  api,
  type CatalogProvider,
  type ConnectorDefinitionView,
  type HefestoStatus,
  type ModelRef,
  type ProviderInfo,
} from "../api";
import AvatarUpload from "../components/AvatarUpload";
import EngineNotice from "../components/EngineNotice";
import ModelSelect from "../components/ModelSelect";
import TopBar from "../components/TopBar";
import { setLastInstanceId } from "../storage";

interface PendingAuth {
  providerID: string;
  key: string;
  name: string;
}

function providerOptions(catalog: CatalogProvider[], pending?: PendingAuth): ProviderInfo[] {
  const byId = new Map<string, ProviderInfo>();
  for (const provider of catalog) {
    const available = provider.models.filter((m) => m.available);
    if (!available.length) continue;
    byId.set(provider.id, {
      id: provider.id,
      name: provider.name,
      env: [],
      configured: false,
      models: available.map((m) => ({ id: m.id, name: m.name, free: true })),
    });
  }
  if (pending) {
    const provider = catalog.find((p) => p.id === pending.providerID);
    if (provider) {
      const available = provider.models.filter((m) => m.available);
      const models = available.length > 0 ? available : provider.models;
      byId.set(provider.id, {
        id: provider.id,
        name: provider.name,
        env: [],
        configured: true,
        models: models.map((m) => ({ id: m.id, name: m.name, free: m.free || m.available })),
      });
    }
  }
  return [...byId.values()];
}

export default function Setup() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);
  const [modelTab, setModelTab] = useState<"available" | "provider">("available");
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
    api
      .status()
      .then((st) => {
        if (alive) setStatus(st);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    Promise.all([api.providerCatalog(), api.connectorCatalog()])
      .then(([cat, connectors]) => {
        if (!alive) return;
        setCatalog(cat.providers);
        setConnectorCatalog(connectors.connectors);
        const availableProviders = cat.providers.filter((p) => p.models.some((m) => m.available));
        const preferred =
          availableProviders.find((p) => p.id === "opencode") ?? availableProviders[0];
        const first = preferred?.models.find((m) => m.available);
        if (preferred && first) {
          setModel({ providerID: preferred.id, modelID: first.id });
        } else {
          setModelTab("provider");
        }
        if (availableProviders.length === 0) setModelTab("provider");
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
      setError("Provedor não encontrado no catálogo.");
      return;
    }
    if (!providerKey.trim()) {
      setError("Cole a chave de acesso do provedor.");
      return;
    }
    setPendingAuth({ providerID: provider.id, key: providerKey.trim(), name: provider.name });
    const available = provider.models.filter((m) => m.available);
    const preferred = available[0] ?? provider.models[0];
    if (preferred) setModel({ providerID: provider.id, modelID: preferred.id });
    setProviderID("");
    setProviderKey("");
    setError("");
    setModelTab("available");
  }

  function removeProvider() {
    setPendingAuth(undefined);
    const provider =
      catalog.find((p) => p.id === "opencode" && p.models.some((m) => m.available)) ??
      catalog.find((p) => p.models.some((m) => m.available));
    const first = provider?.models.find((m) => m.available);
    setModel(provider && first ? { providerID: provider.id, modelID: first.id } : undefined);
  }

  async function create() {
    if (!name.trim()) {
      setError("Dê um nome ao agente.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { instance } = await api.createInstance({
        name: name.trim(),
        tagline: tagline.trim() || undefined,
        personality: personality.trim() || undefined,
        instructions: instructions.trim() || undefined,
        accent,
        avatar,
        model,
        connectors:
          selectedConnectors.length > 0
            ? selectedConnectors.map((id) => ({ alias: id, definitionId: id, enabled: true }))
            : undefined,
        auth: pendingAuth ? { providerID: pendingAuth.providerID, key: pendingAuth.key } : undefined,
      });
      setLastInstanceId(instance.id);
      navigate(`/i/${instance.id}/chat`);
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const providers = providerOptions(catalog, pendingAuth);
  const availableProviders = catalog.filter((p) => p.models.some((m) => m.available));
  const selected = catalog.find((p) => p.id === providerID.trim());

  return (
    <div className="page">
      <TopBar
        right={
          <Link to="/" className="btn ghost small">
            início
          </Link>
        }
      />

      <main className="wizard">
        <EngineNotice status={status} />

        <div className="steps">
          <div className={`step ${step === 1 ? "active" : "done"}`}>
            <span className="step-num">1</span> Modelo e provedor
          </div>
          <div className="step-line" />
          <div className={`step ${step === 2 ? "active" : ""}`}>
            <span className="step-num">2</span> Seu agente
          </div>
        </div>

        {error ? (
          <div className="banner error" role="alert">
            {error}
          </div>
        ) : null}

        {step === 1 ? (
          <section className="panel">
            <h1>Escolha o modelo</h1>
            <p className="muted">
              Comece com os modelos disponíveis do opencode ou adicione um provedor. Cada agente tem a sua própria
              configuração.
            </p>

            <div className="tabs setup-tabs">
              <button
                type="button"
                className={`tab${modelTab === "available" ? " active" : ""}`}
                onClick={() => setModelTab("available")}
              >
                Modelos disponíveis
              </button>
              <button
                type="button"
                className={`tab${modelTab === "provider" ? " active" : ""}`}
                onClick={() => setModelTab("provider")}
              >
                Adicionar provedor
              </button>
            </div>

            {modelTab === "available" ? (
              <div className="model-choice">
                <div className="provider-list">
                  <h3 className="section-title">Disponíveis agora</h3>
                  {availableProviders.length === 0 ? (
                    <p className="muted">Nenhum modelo disponível agora. Adicione um provedor.</p>
                  ) : null}
                  {availableProviders.map((provider) => {
                    const first = provider.models.find((m) => m.available);
                    const count = provider.models.filter((m) => m.available).length;
                    const isSelected = model?.providerID === provider.id;
                    return (
                      <div
                        key={provider.id}
                        className={`provider-row${isSelected ? " selected" : ""}`}
                      >
                        <div className="provider-main">
                          <div>
                            <strong>{provider.name}</strong>
                            <span className="muted small">
                              {" "}
                              · {count} modelo{count === 1 ? "" : "s"}
                            </span>
                          </div>
                          <button
                            type="button"
                            className={`btn small ${isSelected ? "primary" : "ghost"}`}
                            disabled={!first}
                            onClick={() => first && setModel({ providerID: provider.id, modelID: first.id })}
                          >
                            {isSelected ? "Selecionado" : "Usar"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {pendingAuth ? (
                  <div className="provider-list">
                    <h3 className="section-title">Seu provedor</h3>
                    <div className="provider-row selected">
                      <div className="provider-main">
                        <div>
                          <strong>{pendingAuth.name}</strong>
                          <span className="muted small"> · chave será aplicada ao criar</span>
                        </div>
                        <div className="provider-actions">
                          <span className="badge ok">Pronto</span>
                          <button type="button" className="btn small ghost" onClick={removeProvider}>
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="field">
                  <label htmlFor="model">Modelo padrão</label>
                  <ModelSelect providers={providers} value={model} onChange={setModel} />
                  {providers.length === 0 ? (
                    <span className="hint">Adicione um provedor para escolher um modelo.</span>
                  ) : (
                    <span className="hint">Você pode trocar o modelo depois em Ajustes.</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="provider-list">
                <h3 className="section-title">Adicionar provedor</h3>
                <p className="muted small">
                  A chave não fica salva no Hefesto: ela fica no opencode deste agente. Depois de adicionar,
                  escolha um dos modelos dele.
                </p>
                {pendingAuth ? (
                  <div className="provider-row selected">
                    <div className="provider-main">
                      <div>
                        <strong>{pendingAuth.name}</strong>
                        <span className="muted small"> · Pronto para usar</span>
                      </div>
                      <div className="provider-actions">
                        <span className="badge ok">Pronto</span>
                        <button type="button" className="btn small ghost" onClick={removeProvider}>
                          Remover
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="provider-connect">
                    <input
                      list="setup-provider-catalog"
                      placeholder="provedor (ex.: openai, anthropic, deepseek)"
                      value={providerID}
                      onChange={(e) => {
                        setProviderID(e.target.value);
                        setError("");
                      }}
                    />
                    <datalist id="setup-provider-catalog">
                      {catalog.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </datalist>
                    <input
                      type="password"
                      placeholder="chave de acesso (API key)"
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
                )}
                {selected ? (
                  <span className="hint">
                    {selected.name} · {selected.models.length} modelos
                  </span>
                ) : null}
                <div className="field">
                  <label htmlFor="model-provider">Modelo padrão</label>
                  <ModelSelect providers={providers} value={model} onChange={setModel} />
                </div>
              </div>
            )}

            <div className="actions">
              <Link to="/" className="btn ghost">
                Cancelar
              </Link>
              <button type="button" className="btn primary" onClick={() => setStep(2)} disabled={!model}>
                Continuar
              </button>
            </div>
          </section>
        ) : (
          <section className="panel">
            <h1>Forje seu agente</h1>
            <p className="muted">
              Esses dados viram a identidade e o jeito de falar do agente. Você pode ajustar tudo depois.
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
                <label htmlFor="name">Nome</label>
                <input
                  id="name"
                  autoFocus
                  value={name}
                  maxLength={80}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex.: Meu Hefesto"
                />
              </div>

              <div className="field">
                <label htmlFor="tagline">Descrição curta</label>
                <input
                  id="tagline"
                  value={tagline}
                  maxLength={200}
                  onChange={(e) => setTagline(e.target.value)}
                  placeholder="o que esse agente faz?"
                />
              </div>

              <div className="field">
                <label htmlFor="personality">Como ele fala</label>
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
                <label htmlFor="instructions">O que ele deve saber</label>
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
                <input id="accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
              </div>

              <div className="provider-list">
                <h3 className="section-title">Ferramentas</h3>
                <p className="muted small">
                  Opcional. Escolha ferramentas MCP para este agente; você pode adicionar outras depois.
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
                {selectedConnectors.includes("discord") ? (
                  <div className="banner info small">
                    <strong>Próximo passo:</strong> depois de criar o agente, abra Ferramentas e siga o passo a
                    passo para configurar o Discord.
                  </div>
                ) : null}
              </div>

              <div className="actions">
                <button type="button" className="btn ghost" onClick={() => setStep(1)} disabled={saving}>
                  Voltar
                </button>
                <button type="submit" className="btn primary" disabled={saving}>
                  {saving ? "Criando…" : "Criar agente"}
                </button>
              </div>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
