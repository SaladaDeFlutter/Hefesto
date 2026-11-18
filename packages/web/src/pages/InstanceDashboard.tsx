import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { api, modelLabel, type Instance, type ModelRef, type ProviderInfo } from "../api";
import Avatar from "../components/Avatar";
import ModelSelect from "../components/ModelSelect";
import TopBar from "../components/TopBar";

export default function InstanceDashboard() {
  const { id = "" } = useParams();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [error, setError] = useState("");
  const [savingModel, setSavingModel] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.instance(id), api.instanceProviders(id)])
      .then(([inst, prov]) => {
        if (!alive) return;
        setInstance(inst.instance);
        setProviders(prov.providers);
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
        <TopBar />
        <main className="narrow">
          {error ? (
            <div className="banner error">Instância não encontrada: {error}</div>
          ) : (
            <p className="muted">abrindo a forja…</p>
          )}
          <Link to="/" className="btn ghost">
            Voltar ao início
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="page instance-shell" style={{ "--accent": instance.accent } as CSSProperties}>
      <TopBar right={<Link to="/" className="link">todas as instâncias</Link>} />

      <main className="dashboard">
        <header className="instance-hero">
          <Avatar source={instance} size={84} />
          <div className="instance-hero-body">
            <h1>{instance.name}</h1>
            <p className="muted">{instance.tagline || "sem descrição"}</p>
            <div className="hero-chips">
              <span className="chip accent">{modelLabel(providers, instance.model)}</span>
              <span className={instance.sessionId ? "chip" : "chip dim"}>
                {instance.sessionId ? "conversa iniciada" : "aguardando conversa"}
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
              <p>Converse com {instance.name} usando as ferramentas do opencode.</p>
            </div>
            <span className="dash-arrow">→</span>
          </Link>

          <div className="dash-card">
            <span className="dash-icon">◆</span>
            <div className="dash-card-body">
              <h2>Modelo</h2>
              <p>Troque o modelo usado nas próximas mensagens{savingModel ? " · salvando…" : ""}.</p>
              <ModelSelect
                providers={providers}
                value={instance.model}
                onChange={(model) => void changeModel(model)}
                allowEmpty
                className="select"
              />
            </div>
          </div>

          <div className="dash-card disabled" aria-disabled="true">
            <span className="dash-icon">#</span>
            <div>
              <h2>
                Discord <span className="badge soon">em breve</span>
              </h2>
              <p>Conector MCP já registrado. A integração com bots vem na próxima etapa.</p>
            </div>
          </div>

          <Link to={`/i/${instance.id}/config`} className="dash-card">
            <span className="dash-icon">⚙</span>
            <div>
              <h2>Configurações</h2>
              <p>Editar identidade, prompt, foto, cor e resetar a conversa.</p>
            </div>
            <span className="dash-arrow">→</span>
          </Link>
        </div>

        <section className="prompt-preview">
          <h2 className="section-title">Prompt do agente</h2>
          <pre>{instance.systemPrompt}</pre>
        </section>
      </main>
    </div>
  );
}
