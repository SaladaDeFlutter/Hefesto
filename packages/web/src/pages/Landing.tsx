import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, modelLabel, type HefestoStatus, type Instance, type ProviderMeta } from "../api";
import AsciiArt from "../components/AsciiArt";
import Avatar from "../components/Avatar";
import TopBar from "../components/TopBar";

export default function Landing() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [status, setStatus] = useState<HefestoStatus | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    Promise.all([api.status(), api.instances(), api.providerMeta()])
      .then(([st, list, prov]) => {
        if (!alive) return;
        setStatus(st);
        setInstances(list.instances);
        setProviders(prov.providers);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

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

      <main className="landing">
        <section className="hero">
          <AsciiArt />
          <p className="hero-lead">
            A forja de agentes do <strong>opencode</strong>. Escolha um modelo, conecte seu provedor e crie
            instâncias com nome, foto e personalidade próprios — cada uma com seu agente e sua conversa.
          </p>
          <div className="hero-actions">
            <Link to="/comecar" className="btn primary">
              Começar agora
            </Link>
            <a href="#como-funciona" className="btn ghost">
              Como funciona
            </a>
          </div>
          {error ? <div className="banner error">Motor indisponível: {error}</div> : null}
        </section>

        <section id="como-funciona" className="features">
          <h2 className="section-title">Como funciona</h2>
          <div className="features-grid">
            <article className="feature">
              <span className="feature-num">01</span>
              <h3>Escolha o modelo</h3>
              <p>Use os modelos que o opencode já conhece ou conecte um provedor com sua API key.</p>
            </article>
            <article className="feature">
              <span className="feature-num">02</span>
              <h3>Forje uma instância</h3>
              <p>Defina foto, nome, tom de voz e instruções. O Hefesto monta o prompt do agente.</p>
            </article>
            <article className="feature">
              <span className="feature-num">03</span>
              <h3>Converse e delegue</h3>
              <p>Cada instância tem chat, seleção de modelo e ferramentas do opencode no mesmo lugar.</p>
            </article>
            <article className="feature muted">
              <span className="feature-num">04</span>
              <h3>Discord em breve</h3>
              <p>O conector MCP já está registrado; a integração com bots chega na próxima etapa.</p>
            </article>
          </div>
        </section>

        <section className="instances">
          <div className="section-head">
            <h2 className="section-title">Suas instâncias</h2>
            <Link to="/comecar" className="btn small">
              + Nova instância
            </Link>
          </div>

          {instances.length === 0 ? (
            <div className="empty">
              <p>Nenhuma instância ainda. A forja está vazia.</p>
              <Link to="/comecar" className="btn primary small">
                Forjar a primeira
              </Link>
            </div>
          ) : (
            <div className="instances-grid">
              {instances.map((instance) => (
                <Link key={instance.id} to={`/i/${instance.id}`} className="instance-card">
                  <Avatar source={instance} size={48} />
                  <div className="instance-card-body">
                    <strong>{instance.name}</strong>
                    <span className="muted">{instance.tagline || "sem descrição"}</span>
                    <span className="instance-model">{modelLabel(providers, instance.model)}</span>
                  </div>
                  <span className="instance-arrow">→</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
