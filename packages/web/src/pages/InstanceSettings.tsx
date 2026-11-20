import { useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type CatalogProvider, type Instance, type ProviderInfo } from "../api";
import AvatarUpload from "../components/AvatarUpload";
import InstanceNav from "../components/InstanceNav";
import TopBar from "../components/TopBar";

export default function InstanceSettings() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [personality, setPersonality] = useState("");
  const [instructions, setInstructions] = useState("");
  const [accent, setAccent] = useState("#f59e0b");
  const [avatar, setAvatar] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keepHistory, setKeepHistory] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [catalog, setCatalog] = useState<CatalogProvider[]>([]);
  const [providerID, setProviderID] = useState("");
  const [providerKey, setProviderKey] = useState("");
  const [providerBusy, setProviderBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.instance(id), api.instanceProviders(id), api.providerCatalog()])
      .then(([inst, prov, cat]) => {
        if (!alive) return;
        const instance = inst.instance;
        setInstance(instance);
        setName(instance.name);
        setTagline(instance.tagline ?? "");
        setPersonality(instance.personality ?? "");
        setInstructions(instance.instructions ?? "");
        setAccent(instance.accent);
        setAvatar(instance.avatar);
        setProviders(prov.providers);
        setCatalog(cat.providers);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  async function connectProvider() {
    const provider = catalog.find((p) => p.id === providerID.trim());
    if (!provider) {
      setError("Provedor não encontrado no catálogo.");
      return;
    }
    if (!providerKey.trim()) {
      setError("Cole a chave de acesso do provedor.");
      return;
    }
    setProviderBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api.connectInstanceProvider(id, provider.id, providerKey.trim());
      setProviders(res.providers);
      setInstance((current) => (current ? { ...current, ...res.instance } : current));
      setNotice(`${provider.name} conectado neste agente`);
      setProviderID("");
      setProviderKey("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProviderBusy(false);
    }
  }

  async function save() {
    if (!instance) return;
    if (!name.trim()) {
      setError("O nome não pode ficar vazio.");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await api.updateInstance(instance.id, {
        name: name.trim(),
        tagline,
        personality,
        instructions,
        accent,
        avatar: avatar ?? "",
      });
      setInstance(res.instance);
      setNotice("Alterações salvas");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!instance) return;
    const detail = keepHistory
      ? "O histórico da conversa será mantido."
      : "O histórico da conversa também será apagado.";
    if (!window.confirm(`Excluir "${instance.name}"? ${detail}`)) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteInstance(instance.id, { keepHistory });
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
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
          {error ? <div className="banner error">{error}</div> : <p className="muted">Carregando…</p>}
        </main>
      </div>
    );
  }

  return (
    <div className="page instance-shell" style={{ "--accent": instance.accent } as CSSProperties}>
      <TopBar right={<InstanceNav instanceId={instance.id} active="ajustes" />} />

      <main className="narrow">
        <h1>Ajustes</h1>
        <p className="muted">
          Ajuste como <strong>{instance.name}</strong> aparece e conversa. As mudanças valem para as próximas
          mensagens.
        </p>

        {error ? <div className="banner error">{error}</div> : null}
        {notice ? <div className="banner ok">{notice}</div> : null}

        <form
          className="form panel"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <AvatarUpload name={name || "?"} accent={accent} value={avatar} onChange={setAvatar} />

          <div className="field">
            <label htmlFor="name">Nome *</label>
            <input id="name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="tagline">Descrição curta</label>
            <input id="tagline" value={tagline} maxLength={200} onChange={(e) => setTagline(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="personality">Como ele fala</label>
            <textarea
              id="personality"
              value={personality}
              maxLength={2000}
              rows={3}
              onChange={(e) => setPersonality(e.target.value)}
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
            />
          </div>

          <div className="field">
            <label htmlFor="accent">Cor de destaque</label>
            <input id="accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
          </div>

          <div className="actions">
            <button type="submit" className="btn primary" disabled={saving || busy}>
              {saving ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </form>

        <section className="panel provider-list">
          <h2>Contas de IA</h2>
          <p className="muted">A chave fica salva apenas neste agente, nunca no Hefesto.</p>
          {providers.map((provider) => (
            <div key={provider.id} className="provider-row">
              <div className="provider-main">
                <div>
                  <strong>{provider.name}</strong>
                  <span className="muted small"> · {provider.models.length} modelos</span>
                </div>
                <span className={provider.credentialed || provider.public ? "badge ok" : "badge"}>
                  {provider.credentialed ? "Conectado" : provider.public ? "Incluído" : "Disponível"}
                </span>
              </div>
            </div>
          ))}
          <div className="provider-connect">
            <input
              list="instance-provider-catalog"
              placeholder="provedor (ex.: openai, anthropic, deepseek)"
              value={providerID}
              onChange={(e) => {
                setProviderID(e.target.value);
                setError("");
              }}
            />
            <datalist id="instance-provider-catalog">
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
                if (e.key === "Enter") void connectProvider();
              }}
            />
            <button type="button" className="btn small" onClick={() => void connectProvider()} disabled={providerBusy}>
              {providerBusy ? "Conectando…" : "Conectar"}
            </button>
          </div>
          <span className="hint">Depois de conectar, escolha o modelo no chat ou no painel do agente.</span>
        </section>

        <section className="danger-zone">
          <h2>Zona de perigo</h2>
          <p className="muted">
            Excluir apaga o agente. Por padrão, o histórico da conversa também é apagado.
          </p>
          <label className="keep-history">
            <input
              type="checkbox"
              checked={keepHistory}
              onChange={(e) => setKeepHistory(e.target.checked)}
            />
            <span>Manter o histórico da conversa</span>
          </label>
          <button type="button" className="btn danger" onClick={() => void remove()} disabled={busy}>
            Excluir agente
          </button>
        </section>
      </main>
    </div>
  );
}
