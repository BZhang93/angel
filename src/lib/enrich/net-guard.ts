import { isIP } from "node:net";

// Address safety for fetching links that came from email. Pure, so the rules
// that keep the server from being pointed at its own network are unit tested.

/// Rejects loopback, private, link-local and unique-local addresses. Without
/// this, a link in an email can make the server fetch a cloud metadata endpoint
/// or something inside the network it runs in.
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number, number, number];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, including cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }

  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80")) return true; // link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique local
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateAddress(mapped[1]!) : false;
}

export function isInternalHostname(host: string): boolean {
  return /^localhost$/i.test(host) || host.endsWith(".local") || host.endsWith(".internal");
}
