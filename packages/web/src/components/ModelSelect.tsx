import { modelKey, parseModelKey, type ModelRef, type ProviderInfo } from "../api";

interface Props {
  providers: ProviderInfo[];
  value?: ModelRef;
  onChange: (model: ModelRef | undefined) => void;
  allowEmpty?: boolean;
  className?: string;
}

export default function ModelSelect({ providers, value, onChange, allowEmpty = false, className }: Props) {
  const current = modelKey(value);
  const usable = providers
    .map((p) => ({ ...p, models: p.configured ? p.models : p.models.filter((m) => m.free) }))
    .filter((p) => p.models.length > 0);
  const known = usable.some((p) => p.models.some((m) => `${p.id}/${m.id}` === current));

  return (
    <select
      aria-label="Modelo"
      className={className ?? "select"}
      value={current}
      onChange={(e) => onChange(parseModelKey(e.target.value))}
    >
      {allowEmpty ? <option value="">Decidir depois</option> : null}
      {!known && current ? <option value={current}>{current}</option> : null}
      {usable.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.models.map((m) => {
            const fast = /flash|lightning|tidepool|mini|small/i.test(`${m.id} ${m.name}`);
            return (
              <option key={m.id} value={`${p.id}/${m.id}`}>
                {m.name}
                {fast ? " · rápido" : ""}
              </option>
            );
          })}
        </optgroup>
      ))}
    </select>
  );
}
