import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export default function TopBar({ right }: { right?: ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <span className="brand-mark">⚒</span> Hefesto
      </Link>
      <div className="topbar-right">{right}</div>
    </header>
  );
}
