import { useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type CatalogProvider, type Instance, type ProviderInfo } from "../api";
import AvatarUpload from "../components/AvatarUpload";
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
      setError("provedor não encontrado no catálogo");
      return;
    }
    if (!providerKey.trim()) {
      setError("cole a API key do provedor");
      return;
    }
    setProviderBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api.connectInstanceProvider(id, provider.id, providerKey.trim());
      setProviders(res.providers);
      setInstance((current) => (current ? { ...current, ...res.instance } : current));
      setNotice(`${provider.name} conectado nesta instância`);
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
      setError("o nome não pode ficar vazio");
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
      setNotice("alterações salvas");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function resetConversation() {
    if (!instance) return;
    if (!window.confirm("Resetar a conversa desta instância?")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.resetSession(instance.id);
      setInstance({ ...instance, sessionId: undefined });
      setNotice("conversa resetada");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!instance) return;
    if (!window.confirm(`Excluir "${instance.name}"? Essa ação não pode ser desfeita.`)) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteInstance(instance.id);
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!instance) {
    return (
      <div className="page">
        <TopBar />
        <main className="narrow">
          {error ? <div className="banner error">{error}</div> : <p className="muted">carregando…</p>}
          <Link to="/" className="btn ghost">
            Voltar ao início
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="page instance-shell" style={{ "--accent": instance.accent } as CSSProperties}>
      <TopBar right={<Link to={`/i/${instance.id}`} className="link">voltar ao painel</Link>} />

      <main className="narrow">
        <h1>Configurações</h1>
        <p className="muted">
          Ajuste a identidade de <strong>{instance.name}</strong>. O prompt do agente é regerado ao salvar.
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
            <label htmlFor="personality">Personalidade e tom</label>
            <textarea
              id="personality"
              value={personality}
              maxLength={2000}
              rows={3}
              onChange={(e) => setPersonality(e.target.value)}
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
            />
          </div>

          <div className="field">
            <label htmlFor="accent">Cor de destaque</label>
            <input id="accent" type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
          </div>

          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => void resetConversation()} disabled={busy}>
              Resetar conversa
            </button>
            <button type="submit" className="btn primary" disabled={saving || busy}>
              {saving ? "salvando…" : "Salvar alterações"}
            </button>
          </div>
        </form>

        <section className="panel provider-list">
          <h2>Provedores</h2>
          <p className="muted">
            Cada instância roda um opencode isolado: a chave fica apenas aqui, nunca no Hefesto.
          </p>
          {providers.map((provider) => (
            <div key={provider.id} className="provider-row">
              <div className="provider-main">
                <div>
                  <strong>{provider.name}</strong>
                  <span className="muted small"> · {provider.models.length} modelos</span>
                </div>
                <span className={provider.credentialed || provider.public ? "badge ok" : "badge"}>
                  {provider.credentialed ? "conectado" : provider.public ? "grátis" : "disponível"}
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
              {providerBusy ? "conectando…" : "Conectar"}
            </button>
          </div>
          <span className="hint">Depois de conectar, escolha o modelo no painel da instância.</span>
        </section>

        <section className="danger-zone">
          <h2>Zona de perigo</h2>
          <p className="muted">Excluir apaga a instância e o prompt salvo. A conversa no opencode não é apagada.</p>
          <button type="button" className="btn danger" onClick={() => void remove()} disabled={busy}>
            Excluir instância
          </button>
        </section>
      </main>
    </div>
  );
}
