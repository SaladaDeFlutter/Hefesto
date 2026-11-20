import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api,
  modelLabel,
  type HefestoStatus,
  type Instance,
  type ProviderMeta,
  type UpdateInfo,
} from "../api";
import AsciiArt from "../components/AsciiArt";
import Avatar from "../components/Avatar";
import EngineNotice from "../components/EngineNotice";
import TopBar from "../components/TopBar";
import { getLastInstanceId } from "../storage";

export default function Landing() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [providers, setProviders] = useState<ProviderMeta[]>([]);
  const [connectorCount, setConnectorCount] = useState(0);
  const [status, setStatus] = useState<HefestoStatus | null>(null);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState("");

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
    api
      .instances()
      .then((res) => {
        if (alive) setInstances(res.instances);
      })
      .catch(() => undefined);
    api
      .providerMeta()
      .then((res) => {
        if (alive) setProviders(res.providers);
      })
      .catch(() => undefined);
    api
      .connectorCatalog()
      .then((res) => {
        if (alive) setConnectorCount(res.connectors.length);
      })
      .catch(() => undefined);
    api
      .update()
      .then((info) => {
        if (alive) setUpdate(info);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const lastId = getLastInstanceId();
  const last =
    instances.find((item) => item.id === lastId) ??
    [...instances].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  return (
    <div className="page">
      <TopBar />

      <main className="landing">
        <EngineNotice status={status} />

        <section className="hero">
          <AsciiArt />
          <p className="hero-lead">
            Sua IA, forjada do seu jeito. Dê nome, voz e ferramentas a um agente e converse como quiser.
          </p>
          <div className="hero-actions">
            {last ? (
              <>
                <Link to={`/i/${last.id}/chat`} className="btn primary">
                  Continuar conversa
                </Link>
                <Link to="/comecar" className="btn ghost">
                  Novo agente
                </Link>
              </>
            ) : (
              <Link to="/comecar" className="btn primary">
                Começar agora
              </Link>
            )}
          </div>
          {error ? <div className="banner error">Não consegui conectar ao assistente: {error}</div> : null}
        </section>

        <section id="como-funciona" className="features">
          <h2 className="section-title">Como funciona</h2>
          <div className="features-grid">
            <article className="feature">
              <span className="feature-num">01</span>
              <h3>Converse de verdade</h3>
              <p>Chat com histórico, respostas em tempo real e botão para parar quando quiser.</p>
            </article>
            <article className="feature">
              <span className="feature-num">02</span>
              <h3>Escolha como ele pensa</h3>
              <p>
                Comece com os modelos disponíveis do opencode ou adicione OpenAI, Anthropic, DeepSeek e outros
                provedores.
              </p>
            </article>
            <article className="feature">
              <span className="feature-num">03</span>
              <h3>Dê personalidade</h3>
              <p>Nome, foto, tom de voz e instruções próprias. Cada agente tem a sua conversa.</p>
            </article>
            <article className="feature">
              <span className="feature-num">04</span>
              <h3>Conecte ferramentas</h3>
              <p>
                {connectorCount > 0
                  ? `${connectorCount} ferramenta${connectorCount === 1 ? "" : "s"} MCP no catálogo, prontas para cada agente.`
                  : "Conecte ferramentas MCP como Discord e servidores próprios quando precisar."}
              </p>
            </article>
          </div>
        </section>

        <section className="instances">
          <div className="section-head">
            <h2 className="section-title">Seus agentes</h2>
            <Link to="/comecar" className="btn small">
              + Novo agente
            </Link>
          </div>

          {instances.length === 0 ? (
            <div className="empty">
              <p>A forja está vazia. Crie seu primeiro agente para começar.</p>
              <Link to="/comecar" className="btn primary small">
                Criar o primeiro agente
              </Link>
            </div>
          ) : (
            <>
              {last ? (
                <Link to={`/i/${last.id}/chat`} className="continue-card">
                  <Avatar source={last} size={56} />
                  <div className="continue-card-body">
                    <span className="muted small">Continuar conversa</span>
                    <strong>{last.name}</strong>
                    <span className="muted">{last.tagline || "Sem descrição"}</span>
                    <span className="instance-model">{modelLabel(providers, last.model)}</span>
                  </div>
                  <span className="btn primary small">Abrir conversa →</span>
                </Link>
              ) : null}
              <div className="instances-grid">
                {instances
                  .filter((instance) => instance.id !== last?.id)
                  .map((instance) => (
                    <Link
                      key={instance.id}
                      to={`/i/${instance.id}/chat`}
                      className="instance-card"
                    >
                      <Avatar source={instance} size={48} />
                      <div className="instance-card-body">
                        <strong>{instance.name}</strong>
                        <span className="muted">{instance.tagline || "Sem descrição"}</span>
                        <span className="instance-model">
                          {modelLabel(providers, instance.model)}
                        </span>
                      </div>
                      <span className="instance-arrow">→</span>
                    </Link>
                  ))}
              </div>
            </>
          )}
        </section>

        <footer className="landing-footer">
          <span>Hefesto {status?.appVersion ? `v${status.appVersion}` : ""}</span>
          {update?.available ? (
            <a
              className="link"
              href={update.url ?? "https://github.com/SaladaDeFlutter/Hefesto/releases/latest"}
              target="_blank"
              rel="noreferrer"
            >
              v{update.latest} disponível — veja como atualizar
            </a>
          ) : (
            <span className="muted small">Feito por Flutter</span>
          )}
        </footer>
      </main>
    </div>
  );
}
