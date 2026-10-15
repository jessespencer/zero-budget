// Client-safe id generator. `crypto.randomUUID()` is unavailable in
// older Safari over plain HTTP (the Pi serves over LAN HTTP, so this
// matters in practice). Falls back to a timestamp + random tail.
export function clientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
