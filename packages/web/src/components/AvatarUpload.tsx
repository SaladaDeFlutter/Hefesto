import { useRef, useState } from "react";
import Avatar from "./Avatar";

interface Props {
  name: string;
  accent: string;
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("imagem inválida"));
    img.src = dataUrl;
  });
}

async function resize(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("escolha um arquivo de imagem");
  if (file.size > 8_000_000) throw new Error("imagem muito grande (máx. 8 MB)");

  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("não foi possível ler a imagem"));
    reader.readAsDataURL(file);
  });

  const img = await loadImage(raw);
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return raw;

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, size, size);
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/jpeg", 0.86);
}

export default function AvatarUpload({ name, accent, value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="avatar-upload">
      <Avatar source={{ name, avatar: value, accent }} size={72} />
      <div className="avatar-upload-actions">
        <div className="row">
          <button type="button" className="btn small" onClick={() => inputRef.current?.click()}>
            {value ? "Trocar foto" : "Enviar foto"}
          </button>
          {value ? (
            <button type="button" className="btn small ghost" onClick={() => onChange(undefined)}>
              Remover
            </button>
          ) : null}
        </div>
        <span className="hint">Quadrada, recortada em 256px</span>
        {error ? <span className="error-text">{error}</span> : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setError("");
          try {
            onChange(await resize(file));
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
    </div>
  );
}
