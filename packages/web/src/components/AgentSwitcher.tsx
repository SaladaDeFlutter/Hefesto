import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Instance } from "../api";

export default function AgentSwitcher({ currentId }: { currentId?: string }) {
  const navigate = useNavigate();
  const [instances, setInstances] = useState<Instance[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .instances()
      .then((res) => {
        if (alive) setInstances(res.instances);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [currentId]);

  const known = instances.some((instance) => instance.id === currentId);

  return (
    <div className="agent-switcher">
      <select
        className="select"
        aria-label="Trocar de agente"
        value={currentId ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "__new") navigate("/comecar");
          else if (value) navigate(`/i/${value}/chat`);
        }}
      >
        {!known && currentId ? <option value={currentId}>Agente atual</option> : null}
        {instances.map((instance) => (
          <option key={instance.id} value={instance.id}>
            {instance.name}
          </option>
        ))}
        <option value="__new">+ novo agente</option>
      </select>
    </div>
  );
}
