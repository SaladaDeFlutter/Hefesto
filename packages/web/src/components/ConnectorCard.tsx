import { Link } from "react-router-dom";
import type { ConnectorView } from "../api";
import ConnectorIcon from "./ConnectorIcon";
import ConnectorStatusBadge, { connectorNeedsAttention } from "./ConnectorStatusBadge";

export default function ConnectorCard({
  connector,
  to,
}: {
  connector: ConnectorView;
  to: string;
}) {
  const toolCount = connector.tools?.length ?? 0;
  const needsAttention = connector.enabled && connectorNeedsAttention(connector);

  return (
    <Link
      className={`connector-card${needsAttention ? " attention" : ""}`}
      to={to}
      aria-label={`Abrir conector ${connector.name}`}
    >
      <span className="connector-card-icon">
        <ConnectorIcon icon={connector.icon} name={connector.name ?? connector.alias} />
      </span>
      <span className="connector-card-main">
        <span className="connector-card-heading">
          <span className="connector-card-title">{connector.name}</span>
          <ConnectorStatusBadge connector={connector} />
        </span>
        <span className="connector-card-alias">{connector.alias}</span>
        <span className="connector-card-desc">
          {connector.description ?? "Conector MCP personalizado"}
        </span>
        <span className="connector-card-meta">
          <span>{connector.category ?? "personalizado"}</span>
          <span>
            {toolCount} {toolCount === 1 ? "ferramenta" : "ferramentas"}
          </span>
        </span>
      </span>
      <span className="connector-card-chevron" aria-hidden="true">
        ›
      </span>
    </Link>
  );
}
