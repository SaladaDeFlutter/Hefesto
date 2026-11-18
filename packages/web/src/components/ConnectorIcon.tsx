export default function ConnectorIcon({ icon, name }: { icon: string; name: string }) {
  if (icon.startsWith("/")) {
    return <img className="connector-icon-img" src={icon} alt="" aria-hidden="true" />;
  }
  return <span aria-label={name}>{icon}</span>;
}
