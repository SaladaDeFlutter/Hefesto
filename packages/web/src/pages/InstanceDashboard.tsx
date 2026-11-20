import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { api, modelLabel, type ConnectorView, type Instance, type ModelRef, type ProviderInfo } from "../api";
import { connectorNeedsAttention } from "../components/ConnectorStatusBadge";
import Avatar from "../components/Avatar";
import InstanceNav from "../components/InstanceNav";
import ModelSelect from "../components/ModelSelect";
import TopBar from "../components/TopBar";

export default function InstanceDashboard() {
  const { id = "" } = useParams();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [error, setError] = useState("");
  const [savingModel, setSavingModel] = useState(false);
  const needsBot = connectors.some(
    (connector) => connector.definitionId === "discord" && !connector.secrets?.includes("token"),
  );

  useEffect(() => {
    let alive = true;
    Promise.all([api.instance(id), api.instanceProviders(id), api.instanceConnectors(id)])
      .then(([inst, prov, conn]) => {
        if (!alive) return;
        setInstance(inst.instance);
        setProviders(prov.providers);
        setConnectors(conn.connectors);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  async function changeModel(model: ModelRef | undefined) {
    if (!instance) return;
    const previous = instance.model;
    setInstance({ ...instance, model });
    setSavingModel(true);
    setError("");
    try {
      const res = await api.updateInstance(instance.id, { model: model ?? null });
      setInstance(res.instance);
    } catch (e) {
      setInstance({ ...instance, model: previous });
      setError((e as Error).message);
    } finally {
      setSavingModel(false);
    }
  }

  if (!instance) {
    return (
      <div className="page">
        <TopBar
          right={
            <Link to="/" className="btn ghost small">
              Todos os agentes
            </Link>
          }
        />
        <main className="narrow">
          {error ? (
            <div className="banner error">Instância não encontrada: {error}</div>
          ) : (
            <p className="muted">Abrindo a forja…</p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="page instance-shell" style={{ "--accent": instance.accent } as CSSProperties}>
      <TopBar right={<InstanceNav instanceId={instance.id} active="painel" />} />

      <main className="dashboard">
        <header className="instance-hero">
          <Avatar source={instance} size={84} />
          <div className="instance-hero-body">
            <h1>{instance.name}</h1>
            <p className="muted">{instance.tagline || "Sem descrição"}</p>
            <div className="hero-chips">
              <span className="chip accent">{modelLabel(providers, instance.model)}</span>
              <span className={instance.sessionId ? "chip" : "chip dim"}>
                {instance.sessionId ? "Conversa iniciada" : "Aguardando conversa"}
              </span>
            </div>
          </div>
        </header>

        {error ? <div className="banner error">{error}</div> : null}

        <div className="dash-grid">
          <Link to={`/i/${instance.id}/chat`} className="dash-card accent">
            <span className="dash-icon">›_</span>
            <div>
              <h2>Chat</h2>
              <p>Converse com {instance.name} e use as ferramentas conectadas.</p>
            </div>
            <span className="dash-arrow">→</span>
          </Link>

          <div className="dash-card">
            <span className="dash-icon">◆</span>
            <div className="dash-card-body">
              <h2>Modelo</h2>
              <p>Escolha o modelo que responde nas próximas mensagens{savingModel ? " · salvando…" : ""}.</p>
              <ModelSelect
                providers={providers}
                value={instance.model}
                onChange={(model) => void changeModel(model)}
                allowEmpty
                className="select"
              />
            </div>
          </div>

          <Link
            to={
              needsBot
                ? `/i/${instance.id}/conectores/discord?tab=config`
                : `/i/${instance.id}/conectores`
            }
            className="dash-card accent"
          >
            <span className="dash-icon">⌁</span>
            <div>
              <h2>
                Ferramentas
                <span className="badge">
                  {connectors.filter((c) => c.enabled && c.status === "connected" && !connectorNeedsAttention(c)).length}/{connectors.length}
                </span>
              </h2>
              <p>
                {needsBot
                  ? "Termine a configuração do Discord para ativar esta ferramenta."
                  : connectors.length === 0
                    ? "Conecte ferramentas MCP para este agente usar."
                    : `${connectors.length} ferramenta${connectors.length === 1 ? "" : "s"} MCP conectada${connectors.length === 1 ? "" : "s"}.`}
              </p>
            </div>
            <span className="dash-arrow">→</span>
          </Link>

          <Link to={`/i/${instance.id}/config`} className="dash-card">
            <span className="dash-icon">⚙</span>
            <div>
              <h2>Ajustes</h2>
              <p>Nome, foto, personalidade e conta de IA.</p>
            </div>
            <span className="dash-arrow">→</span>
          </Link>
        </div>

      </main>
    </div>
  );
}
