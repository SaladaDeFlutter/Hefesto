import type { ConnectorView } from "../api";

const LABELS: Record<string, { label: string; tone: string }> = {
  connected: { label: "Conectado", tone: "ok" },
  disabled: { label: "Desativado", tone: "dim" },
  failed: { label: "Falhou", tone: "bad" },
  needs_auth: { label: "Precisa de autenticação", tone: "warn" },
  needs_client_registration: { label: "Precisa de cadastro", tone: "warn" },
  unknown: { label: "Desconhecido", tone: "dim" },
};

export function missingRequiredSecret(connector: ConnectorView) {
  return (connector.fields ?? []).find(
    (field) => field.required && field.secret && !connector.secrets?.includes(field.key),
  );
}

export function connectorNeedsAttention(connector: ConnectorView): boolean {
  if (missingRequiredSecret(connector)) return true;
  return ["failed", "needs_auth", "needs_client_registration"].includes(connector.status);
}

export default function ConnectorStatusBadge({ connector }: { connector: ConnectorView }) {
  const status = connector.enabled ? connector.status : "disabled";
  const missing = connector.enabled ? missingRequiredSecret(connector) : undefined;
  const info = missing
    ? { label: "Configurar", tone: "warn" }
    : (LABELS[status] ?? LABELS.unknown);
  return (
    <span className={`connector-status connector-status-${info.tone}`}>
      <span className="connector-status-dot" aria-hidden="true" />
      {info.label}
    </span>
  );
}
