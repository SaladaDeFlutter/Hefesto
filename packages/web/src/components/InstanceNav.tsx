import { Link } from "react-router-dom";

export type InstanceSection = "painel" | "chat" | "conectores" | "ajustes";

const ITEMS: Array<{ id: InstanceSection; label: string; path: string }> = [
  { id: "painel", label: "painel", path: "" },
  { id: "chat", label: "chat", path: "/chat" },
  { id: "conectores", label: "conectores", path: "/conectores" },
  { id: "ajustes", label: "ajustes", path: "/config" },
];

export default function InstanceNav({
  instanceId,
  active,
}: {
  instanceId: string;
  active: InstanceSection;
}) {
  return (
    <nav className="instance-nav" aria-label="Navegação da instância">
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
