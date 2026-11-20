import { Link } from "react-router-dom";

export type InstanceSection = "painel" | "chat" | "ferramentas" | "ajustes";

const ITEMS: Array<{ id: InstanceSection; label: string; path: string }> = [
  { id: "painel", label: "Painel", path: "/painel" },
  { id: "chat", label: "Chat", path: "/chat" },
  { id: "ferramentas", label: "Ferramentas", path: "/conectores" },
  { id: "ajustes", label: "Ajustes", path: "/config" },
];

export default function InstanceNav({
  instanceId,
  active,
}: {
  instanceId: string;
  active: InstanceSection;
}) {
  return (
    <nav className="instance-nav" aria-label="Navegação do agente">
      {ITEMS.map((item) => (
        <Link
          key={item.id}
          className={`btn small ${active === item.id ? "primary" : "ghost"}`}
          to={`/i/${instanceId}${item.path}`}
          aria-current={active === item.id ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
