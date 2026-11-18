export interface AvatarSource {
  name: string;
  avatar?: string;
  accent?: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function Avatar({ source, size = 40 }: { source: AvatarSource; size?: number }) {
  const accent = source.accent ?? "#f59e0b";
  if (source.avatar) {
    return (
      <img
        className="avatar"
        src={source.avatar}
        alt={source.name}
        width={size}
        height={size}
        style={{ width: size, height: size, borderColor: accent }}
      />
    );
  }
  return (
    <div
      className="avatar avatar-fallback"
      style={{
        width: size,
        height: size,
        borderColor: accent,
        background: `linear-gradient(135deg, ${accent}, #111c30)`,
        fontSize: Math.max(11, Math.round(size * 0.36)),
      }}
      aria-label={source.name}
    >
      {initials(source.name)}
    </div>
  );
}
