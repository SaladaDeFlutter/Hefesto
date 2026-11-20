import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  api,
  type ConnectorDefinitionView,
  type ConnectorInput,
  type ConnectorView,
  type Instance,
} from "../api";
import ConnectorCard from "../components/ConnectorCard";
import ConnectorCatalogDialog from "../components/ConnectorCatalogDialog";
import InstanceNav from "../components/InstanceNav";
import { connectorNeedsAttention } from "../components/ConnectorStatusBadge";
import TopBar from "../components/TopBar";

export default function Connectors() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [connectors, setConnectors] = useState<ConnectorView[]>([]);
  const [catalog, setCatalog] = useState<ConnectorDefinitionView[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [catalogTab, setCatalogTab] = useState<"catalog" | "advanced">("catalog");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await api.instanceConnectors(id);
    setConnectors(res.connectors);
  }, [id]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.instance(id), api.instanceConnectors(id), api.connectorCatalog()])
      .then(([inst, conns, cat]) => {
        if (!alive) return;
        setInstance(inst.instance);
        setConnectors(conns.connectors);
        setCatalog(cat.connectors);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [id, refresh]);

  const connectedCount = connectors.filter(
    (item) => item.enabled && item.status === "connected" && !connectorNeedsAttention(item),
  ).length;
  const attentionCount = connectors.filter(
    (item) => item.enabled && connectorNeedsAttention(item),
  ).length;
  const installedIds = new Set(
    connectors.map((item) => (item.definitionId ?? item.alias).toLowerCase()),
  );
  const available = catalog.filter((item) => !installedIds.has(item.id.toLowerCase()));
  const legacyConfig = searchParams.get("config");

  async function run(action: () => Promise<unknown>, message: string): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openCatalog(tab: "catalog" | "advanced" = "catalog") {
    setCatalogTab(tab);
    setShowCatalog(true);
  }

  function addDefinition(definition: ConnectorDefinitionView) {
    void run(
      () =>
        api.addInstanceConnector(id, {
          alias: definition.id,
          definitionId: definition.id,
          enabled: true,
        }),
      `${definition.name} adicionado a este agente`,
    ).then((ok) => {
      if (!ok) return;
      setShowCatalog(false);
      navigate(`/i/${id}/conectores/${definition.id}`);
    });
  }

  function addCustom(input: ConnectorInput) {
    void run(
      () => api.addInstanceConnector(id, input),
      `${input.alias} adicionado a este agente`,
    ).then((ok) => {
      if (!ok || !input.alias) return;
      setShowCatalog(false);
      navigate(`/i/${id}/conectores/${input.alias}`);
    });
  }

  if (legacyConfig) {
    return (
      <Navigate
        to={`/i/${id}/conectores/${legacyConfig === "1" ? "discord" : legacyConfig}?tab=config`}
        replace
      />
    );
  }

  return (
    <div
      className="page"
      style={instance ? ({ "--accent": instance.accent } as CSSProperties) : undefined}
    >
      <TopBar right={<InstanceNav instanceId={id} active="ferramentas" />} />

      <main className="connectors-page connectors-home">
        <div className="connectors-crumb">
          <Link to={`/i/${id}/painel`}>← painel</Link>
          <span aria-hidden="true">/</span>
          <strong>Ferramentas</strong>
        </div>

        <header className="connectors-hero">
          <div>
            <span className="connectors-kicker">Agente · {instance?.name ?? "Carregando"}</span>
            <h1>Ferramentas</h1>
            <p>
              Ferramentas MCP deste agente. Abra uma ferramenta para configurar credenciais,
              convidar o bot e conectar.
            </p>
          </div>
          <button className="btn primary" type="button" onClick={() => openCatalog()}>
            Adicionar ferramenta
          </button>
        </header>

        {error && <p className="error-text connectors-message">{error}</p>}
        {notice && <p className="notice-text connectors-message">{notice}</p>}

        {connectors.length > 0 && (
          <div className="connectors-home-summary">
            <span>
              <strong>{connectors.length}</strong>{" "}
              {connectors.length === 1 ? "instalada" : "instaladas"}
            </span>
            <span className={connectedCount > 0 ? "is-ok" : undefined}>
              <strong>{connectedCount}</strong>{" "}
              {connectedCount === 1 ? "ativa" : "ativas"}
            </span>
            {attentionCount > 0 && (
              <span className="is-warn">
                <strong>{attentionCount}</strong>{" "}
                {attentionCount === 1 ? "precisa de atenção" : "precisam de atenção"}
              </span>
            )}
          </div>
        )}

        {connectors.length === 0 ? (
          <div className="connector-empty-state connector-home-empty">
            <span className="connector-empty-mark" aria-hidden="true">
              ⛓
            </span>
            <strong>Nenhuma ferramenta instalada</strong>
            <p>
              Instale uma ferramenta do catálogo para dar novos recursos a este agente.
            </p>
            <div className="row">
              <button className="btn primary" type="button" onClick={() => openCatalog()}>
                Explorar catálogo
              </button>
              <button className="btn ghost" type="button" onClick={() => openCatalog("advanced")}>
                MCP próprio
              </button>
            </div>
          </div>
        ) : (
          <section className="connectors-home-section" aria-labelledby="installed-connectors-title">
            <div className="connectors-home-section-head">
              <div>
                <h2 id="installed-connectors-title">Instaladas</h2>
                <p className="muted small">Clique em uma ferramenta para abrir a configuração.</p>
              </div>
            </div>
            <div className="connectors-home-grid">
              {connectors.map((connector) => (
                <ConnectorCard
                  key={connector.alias}
                  connector={connector}
                  to={`/i/${id}/conectores/${connector.alias}`}
                />
              ))}
            </div>
          </section>
        )}

        {available.length > 0 && (
          <button className="connector-catalog-cta" type="button" onClick={() => openCatalog()}>
            <span className="connector-catalog-cta-mark" aria-hidden="true">
              ＋
            </span>
            <span>
              <strong>Catálogo de ferramentas</strong>
              <span className="muted small">
                {available.length} {available.length === 1 ? "disponível" : "disponíveis"} para
                instalar
              </span>
            </span>
            <span className="connector-alert-action">Explorar</span>
          </button>
        )}
      </main>

      {showCatalog && (
        <ConnectorCatalogDialog
          catalog={catalog}
          installed={connectors.map((item) => item.alias)}
          busy={busy}
          initialTab={catalogTab}
          onAddDefinition={addDefinition}
          onAddCustom={addCustom}
          onClose={() => setShowCatalog(false)}
        />
      )}
    </div>
  );
}
