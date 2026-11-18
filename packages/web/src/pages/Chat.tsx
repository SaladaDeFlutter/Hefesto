import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import {
  api,
  type Instance,
  type ModelRef,
  type OpencodeMessage,
  type OpencodePart,
  type ProviderInfo,
} from "../api";
import Avatar from "../components/Avatar";
import ModelSelect from "../components/ModelSelect";

type Block =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "tool"; tool: string; title?: string; status?: string };

interface Msg {
  id: string;
  role: "user" | "assistant";
  blocks: Block[];
}

function partToBlock(part: OpencodePart): Block | null {
  if (part.type === "text" && typeof part.text === "string") {
    return { id: part.id ?? `text-${part.messageID ?? "x"}`, kind: "text", text: part.text };
  }
  if (part.type === "tool") {
    return {
      id: part.id ?? `tool-${part.callID ?? part.messageID ?? "x"}`,
      kind: "tool",
      tool: part.tool ?? "tool",
      title: part.state?.title,
      status: part.state?.status,
    };
  }
  return null;
}

function hydrate(list: OpencodeMessage[]): Msg[] {
  const messages: Msg[] = [];
  for (const item of list) {
    const id = item.info?.id;
    if (!id) continue;
    const blocks = (item.parts ?? [])
      .map(partToBlock)
      .filter((b): b is Block => b !== null);
    messages.push({ id, role: item.info.role === "user" ? "user" : "assistant", blocks });
  }
  return messages;
}

export default function Chat() {
  const { id = "" } = useParams();
  const [instance, setInstance] = useState<Instance | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [model, setModel] = useState<ModelRef | undefined>();
  const [defaultModel, setDefaultModel] = useState<ModelRef | undefined>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const sessionRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    let alive = true;
    let close: (() => void) | undefined;

    function upsertMessage(messageID: string, role: "user" | "assistant") {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageID);
        if (idx === -1) return [...prev, { id: messageID, role, blocks: [] }];
        if (prev[idx]!.role === role) return prev;
        const next = [...prev];
        next[idx] = { ...prev[idx]!, role };
        return next;
      });
    }

    function upsertBlock(messageID: string, block: Block) {
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageID);
        if (idx === -1) return [...prev, { id: messageID, role: "assistant", blocks: [block] }];
        const msg = prev[idx]!;
        const blockIdx = msg.blocks.findIndex((b) => b.id === block.id);
        const blocks =
          blockIdx === -1
            ? [...msg.blocks, block]
            : msg.blocks.map((b, i) => (i === blockIdx ? block : b));
        const next = [...prev];
        next[idx] = { ...msg, blocks };
        return next;
      });
    }

    (async () => {
      const [{ instance }, prov, st] = await Promise.all([
        api.instance(id),
        api.instanceProviders(id),
        api.status(),
      ]);
      if (!alive) return;
      setInstance(instance);
      setProviders(prov.providers);
      setModel(instance.model);
      setDefaultModel(st.defaultModel);

      let sessionId = (await api.ensureSession(instance.id)).sessionId;
      if (!alive) return;
      sessionRef.current = sessionId;

      let history: OpencodeMessage[] = [];
      try {
        history = await api.listMessages(id, sessionId);
      } catch {
        await api.resetSession(instance.id);
        sessionId = (await api.ensureSession(instance.id)).sessionId;
        sessionRef.current = sessionId;
        history = [];
      }
      if (!alive) return;
      setMessages(hydrate(history));
      setLoading(false);

      let sawStatus = false;
      close = api.subscribe(id, (e) => {
        const p = e.properties ?? {};
        if (p.sessionID && p.sessionID !== sessionRef.current) return;
        if (e.type === "session.status") {
          sawStatus = true;
          setBusy(p.status?.type !== "idle");
        } else if (e.type === "message.updated") {
          if (p.info?.id) upsertMessage(p.info.id, p.info.role === "user" ? "user" : "assistant");
        } else if (e.type === "message.part.updated") {
          const part = p.part as OpencodePart | undefined;
          if (!part?.messageID) return;
          const block = partToBlock(part);
          if (block) upsertBlock(part.messageID, block);
        } else if (e.type === "session.error") {
          const message = String(p.error?.data?.message ?? p.error?.message ?? "erro desconhecido");
          setError(message.slice(0, 240));
          setBusy(false);
        }
      });

      try {
        const statuses = await api.sessionStatuses(id);
        const current = statuses[sessionId];
        if (alive && !sawStatus) setBusy(Boolean(current && current.type !== "idle"));
      } catch {
        /* status é apenas um reforço: os eventos seguem valendo */
      }
    })().catch((e: Error) => {
      if (alive) {
        setError(e.message);
        setLoading(false);
      }
    });

    return () => {
      alive = false;
      close?.();
    };
  }, [id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send() {
    const sessionId = sessionRef.current;
    const text = draft.trim();
    if (!sessionId || !text || busyRef.current) return;
    setDraft("");
    setError("");
    setBusy(true);
    busyRef.current = true;
    try {
      await api.sendPrompt(id, sessionId, [{ type: "text", text }], {
        model: model ?? defaultModel,
        system: instance?.systemPrompt,
      });
    } catch (e) {
      const message = (e as Error).message;
      if (instance && /404|not found/i.test(message)) {
        try {
          await api.resetSession(instance.id);
          const { sessionId: fresh } = await api.ensureSession(instance.id);
          sessionRef.current = fresh;
          setMessages([]);
          setDraft(text);
          setError("a conversa anterior não existe mais; uma nova foi criada, envie de novo");
        } catch (err) {
          setError((err as Error).message);
        }
      } else {
        setError(message);
      }
      setBusy(false);
      busyRef.current = false;
    }
  }

  async function stop() {
    if (!instance || stopping) return;
    const sessionId = sessionRef.current;
    setStopping(true);
    setError("");
    try {
      const result = await api.abortInstance(instance.id);
      setBusy(false);
      busyRef.current = false;
      if (result.stale) {
        const { sessionId: fresh } = await api.ensureSession(instance.id);
        sessionRef.current = fresh;
        setMessages([]);
        setError("a conversa anterior não existe mais; uma nova foi criada");
        return;
      }
      if (!sessionId) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (sessionRef.current !== sessionId) return;
      setMessages(hydrate(await api.listMessages(id, sessionId)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopping(false);
    }
  }

  async function resetConversation() {
    if (!instance) return;
    if (!window.confirm("Começar uma nova conversa? O histórico atual será deixado de lado.")) return;
    setError("");
    setMessages([]);
    setBusy(false);
    try {
      if (busyRef.current) await api.abortInstance(instance.id);
      await api.resetSession(instance.id);
      const { sessionId } = await api.ensureSession(instance.id);
      sessionRef.current = sessionId;
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function changeModel(next: ModelRef | undefined) {
    if (!instance) return;
    setModel(next);
    setError("");
    try {
      const res = await api.updateInstance(instance.id, { model: next ?? null });
      setInstance(res.instance);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!instance) {
    return (
      <div className="page">
        <div className="narrow">
          {error ? <div className="banner error">{error}</div> : <p className="muted">abrindo a conversa…</p>}
          <Link to="/" className="btn ghost">
            Voltar ao início
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page chat-page" style={{ "--accent": instance.accent } as CSSProperties}>
      <header className="topbar chat-topbar">
        <Link to={`/i/${instance.id}`} className="brand chat-brand">
          <span className="brand-mark">←</span>
          <Avatar source={instance} size={30} />
          <span>{instance.name}</span>
        </Link>
        <div className="chat-tools">
          <ModelSelect providers={providers} value={model} onChange={(m) => void changeModel(m)} allowEmpty />
          <button type="button" className="btn small ghost" onClick={() => void resetConversation()}>
            nova conversa
          </button>
        </div>
      </header>

      <div className="messages">
        {loading ? <p className="muted center">carregando histórico…</p> : null}
        {!loading && messages.length === 0 ? (
          <div className="empty chat-empty">
            <p>
              Converse com <strong>{instance.name}</strong>. O prompt da instância já está ativo.
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <div key={message.id} className={`msg ${message.role}`}>
            <div className="who">{message.role === "user" ? "você" : instance.name}</div>
            {message.blocks.map((block) =>
              block.kind === "text" ? (
                <div key={block.id} className="body">
                  {block.text}
                </div>
              ) : (
                <div key={block.id} className="tool-line">
                  ▸ {block.tool}
                  {block.title ? ` — ${block.title}` : ""}
                  {block.status ? ` · ${block.status}` : ""}
                </div>
              ),
            )}
            {message.role === "assistant" && message.blocks.length === 0 && busy ? (
              <div className="body typing">…</div>
            ) : null}
          </div>
        ))}
        {busy ? <div className="working">● trabalhando…</div> : null}
        <div ref={endRef} />
      </div>

      {error ? <div className="banner error chat-error">{error}</div> : null}

      <div className="composer">
        <textarea
          value={draft}
          rows={2}
          placeholder={`mensagem para ${instance.name}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && busy) {
              e.preventDefault();
              void stop();
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="btn danger"
            onClick={() => void stop()}
            disabled={stopping}
            title="interromper a tarefa atual (Esc)"
          >
            {stopping ? "parando…" : "■ parar"}
          </button>
        ) : null}
        <button className="btn primary" onClick={() => void send()} disabled={busy || !draft.trim()}>
          Enviar
        </button>
      </div>
    </div>
  );
}
