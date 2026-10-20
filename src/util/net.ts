import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SafeUrlOptions {
  allowedHosts?: string[];
  resolve?: (hostname: string) => Promise<string[]>;
}

function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip === "::" || ip === "::1" || ip === "0.0.0.0") return true;
  if (ip.startsWith("::ffff:")) return isPrivateIp(ip.slice("::ffff:".length));
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
  if (ip.startsWith("fe80")) return true;

  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === undefined || b === undefined) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  return false;
}

export async function assertSafeHttpUrl(
  input: string,
  options: SafeUrlOptions = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`invalid URL: ${input}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`unsupported protocol: ${url.protocol}`);
  }

  const host = url.hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error(`blocked host: ${host}`);
  }

  if (options.allowedHosts?.length) {
    const allowed = options.allowedHosts.some((candidate) => {
      const value = candidate.toLowerCase();
      return host === value || host.endsWith(`.${value}`);
    });
    if (!allowed) throw new Error(`host not allowed: ${host}`);
  }

  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error(`blocked private address: ${host}`);
    return url;
  }

  const resolve =
    options.resolve ??
    (async (hostname: string) =>
      (await lookup(hostname, { all: true })).map((entry) => entry.address));
  const addresses = await resolve(host);
  if (!addresses.length) throw new Error(`could not resolve: ${host}`);
  for (const address of addresses) {
    if (isPrivateIp(address)) {
      throw new Error(`blocked private address: ${host} -> ${address}`);
    }
  }
  return url;
}
