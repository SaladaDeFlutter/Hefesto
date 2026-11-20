const LAST_INSTANCE = "hefesto.lastInstance";

function read(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* armazenamento indisponível */
  }
}

export function getLastInstanceId(): string | undefined {
  return read(LAST_INSTANCE);
}

export function setLastInstanceId(id: string): void {
  write(LAST_INSTANCE, id);
}
