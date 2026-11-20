import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import AgentSwitcher from "./AgentSwitcher";

export default function TopBar({ right }: { right?: ReactNode }) {
  const { id } = useParams();

  return (
    <header className="topbar">
      <Link to="/" className="brand" title="Todos os agentes" aria-label="Hefesto — início">
        <span className="brand-mark">⚒</span> Hefesto
      </Link>
      {id ? <AgentSwitcher currentId={id} /> : null}
      <div className="topbar-right">{right}</div>
    </header>
  );
}
