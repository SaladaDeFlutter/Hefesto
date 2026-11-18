import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type ConnectorView, type Instance } from "../api";
import ConnectorDetailPanel from "../components/ConnectorDetailPanel";
import ConnectorIcon from "../components/ConnectorIcon";
import ConnectorStatusBadge from "../components/ConnectorStatusBadge";
import InstanceNav from "../components/InstanceNav";
import TopBar from "../components/TopBar";

export default function ConnectorDetail() {
  const { id = "", alias = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [connector, setConnector] = useState<ConnectorView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const focusConfig = searchParams.get("tab") === "config";

  const refresh = useCallback(async () => {
    const res = await api.instanceConnectors(id);
    setConnector(res.connectors.find((item) => item.alias === alias) ?? null);
  }, [id, alias]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.instance(id), api.instanceConnectors(id)])
      .then(([inst, conns]) => {
        if (!alive) return;
        setInstance(inst.instance);
        setConnector(conns.connectors.find((item) => item.alias === alias) ?? null);
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setLoaded(true);
      });
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [id, alias, refresh]);

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

  if (!loaded) {
    return (
      <div className="page">
        <TopBar />
        <main className="connector-detail-page">
          <p className="muted">carregando conector...</p>
        </main>
      </div>
    );
  }

  if (!connector) {
    if (error) {
      return (
        <div className="page">
          <TopBar
            right={
              <Link className="btn ghost small" to={`/i/${id}/conectores`}>
                conectores
              </Link>
            }
          />
          <main className="connector-detail-page">
            <p className="error-text">{error}</p>
          </main>
        </div>
      );
    }
    return <Navigate to={`/i/${id}/conectores`} replace />;
  }

  return (
    <div
      className="page"
      style={instance ? ({ "--accent": instance.accent } as CSSProperties) : undefined}
    >
      <TopBar right={<InstanceNav instanceId={id} active="conectores" />} />

      <main className="connector-detail-page">
        <div className="connectors-crumb">
          <Link to={`/i/${id}/conectores`}>← conectores</Link>
          <span aria-hidden="true">/</span>
          <strong>{connector.alias}</strong>
        </div>

        <header className="connector-detail-hero">
          <span className="connector-detail-icon">
            <ConnectorIcon icon={connector.icon} name={connector.name ?? connector.alias} />
          </span>
          <div className="connector-detail-hero-copy">
            <span className="connectors-kicker">conector · {instance?.name ?? "instância"}</span>
            <h1>{connector.name}</h1>
            <p>{connector.description ?? "Conector MCP personalizado desta instância."}</p>
          </div>
          <div className="connector-detail-hero-status">
            <ConnectorStatusBadge connector={connector} />
            <span className="muted small">{connector.alias}</span>
          </div>
        </header>

        {error && <p className="error-text connectors-message">{error}</p>}
        {notice && <p className="notice-text connectors-message">{notice}</p>}
        {connector.error && <p className="error-text connectors-message">{connector.error}</p>}

        <ConnectorDetailPanel
          key={`${connector.alias}:${focusConfig ? "config" : "flow"}`}
          connector={connector}
          busy={busy}
          focusConfig={focusConfig}
          onConnect={() =>
            void run(
              () => api.toggleInstanceConnector(id, connector.alias, "connect"),
              "conector conectado",
            )
          }
          onDisconnect={() =>
            void run(
              () => api.toggleInstanceConnector(id, connector.alias, "disconnect"),
              "conector desconectado",
            )
          }
          onToggleEnabled={() =>
            void run(
              () =>
                api.updateInstanceConnector(id, connector.alias, {
                  definitionId: connector.definitionId,
                  transport: connector.transport,
                  enabled: !connector.enabled,
                }),
              connector.enabled ? "conector desativado" : "conector ativado",
            )
          }
          onRemove={() => {
            if (!window.confirm(`Remover o conector ${connector.alias}?`)) return;
            void run(
              () => api.removeInstanceConnector(id, connector.alias),
              "conector removido",
            ).then((ok) => {
              if (ok) navigate(`/i/${id}/conectores`);
            });
          }}
          onSaveConfig={(input) =>
            void run(
              () => api.updateInstanceConnector(id, connector.alias, input),
              "credenciais salvas",
            )
          }
        />
      </main>
    </div>
  );
}
