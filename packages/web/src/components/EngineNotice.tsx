import type { HefestoStatus } from "../api";

export default function EngineNotice({ status }: { status: HefestoStatus | null }) {
  if (!status?.opencode || status.opencode.ok !== false) return null;

  return (
    <div className="banner error engine-notice" role="alert">
      <span>
        O opencode está indisponível
        {status.opencode.error ? `: ${status.opencode.error}.` : "."} Verifique o log ou rode{" "}
        <code>hefesto doctor</code>.
      </span>
      <button className="btn small ghost" type="button" onClick={() => window.location.reload()}>
        tentar novamente
      </button>
    </div>
  );
}
