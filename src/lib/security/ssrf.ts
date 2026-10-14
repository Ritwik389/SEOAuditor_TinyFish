import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export class UrlRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UrlRejected";
  }
}

/** Test-only escape hatch so local mock servers can be audited. Never honoured in production. */
const allowPrivate = () => process.env.NODE_ENV !== "production" && process.env.SNIFFSITE_ALLOW_PRIVATE_TARGETS === "1";

// ---- IP classification ------------------------------------------------------------

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
const V4_BLOCKS: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKS.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Expand an IPv6 literal to 8 16-bit groups. Returns null if unparseable. */
function expandV6(ip: string): number[] | null {
  let s = ip.split("%")[0]!.toLowerCase();
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[1]!);
    s = s.slice(0, -dotted[1]!.length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateV4(ip);
  if (kind !== 6) return true; // not an IP => treat as unsafe
  const g = expandV6(ip);
  if (!g) return true;
  const [a, b, c, d, e, f, g6, h] = g as [number, number, number, number, number, number, number, number];
  const embeddedV4 = `${g6 >> 8}.${g6 & 255}.${h >> 8}.${h & 255}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && h === 1) return true; // ::1
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPrivateV4(embeddedV4); // ::ffff:v4
  if (a === 0x64 && b === 0xff9b) return isPrivateV4(embeddedV4); // NAT64
  if ((a & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((a & 0xffc0) === 0xfe80) return true; // link-local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x2002) return isPrivateV4(`${b >> 8}.${b & 255}.${c >> 8}.${c & 255}`); // 6to4
  return false;
}

// ---- URL validation ---------------------------------------------------------------

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".private"];

/** Synchronous structural validation. Throws UrlRejected with a user-safe message. */
export function parseTargetUrl(input: string): URL {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new UrlRejected("That does not look like a valid URL. Include https://");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UrlRejected("Only http and https URLs can be audited.");
  if (u.username || u.password) throw new UrlRejected("URLs containing credentials are not allowed.");
  if (allowPrivate()) return u;
  if (!ALLOWED_PORTS.has(u.port)) throw new UrlRejected("Only standard web ports (80, 443, 8080, 8443) are allowed.");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".") && !net.isIP(host)) {
    throw new UrlRejected("Local and internal hostnames cannot be audited.");
  }
  if (net.isIP(host) && isPrivateIp(host)) throw new UrlRejected("Private and reserved IP addresses cannot be audited.");
  return u;
}

/** Resolve DNS and ensure EVERY address is public. */
export async function assertPublicHost(hostname: string): Promise<string[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (allowPrivate()) return [];
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UrlRejected("Private and reserved IP addresses cannot be audited.");
    return [host];
  }
  let addrs: dns.LookupAddress[];
  try {
    addrs = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UrlRejected("The hostname could not be resolved.");
  }
  if (!addrs.length) throw new UrlRejected("The hostname could not be resolved.");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new UrlRejected("The hostname resolves to a private or reserved address.");
  return addrs.map((a) => a.address);
}

export async function validateTargetUrl(input: string): Promise<URL> {
  const u = parseTargetUrl(input);
  await assertPublicHost(u.hostname);
  return u;
}

// ---- SSRF-safe fetch (used for robots.txt / sitemap) -------------------------------

export interface SafeResponse {
  status: number;
  finalUrl: string;
  body: string;
  truncated: boolean;
  contentType: string;
}

/** Custom `lookup` so the *connection* uses an address we validated (defeats DNS rebinding). */
function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
) {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err, "", 0);
    const list = addrs as dns.LookupAddress[];
    if (!allowPrivate() && list.some((a) => isPrivateIp(a.address))) {
      return cb(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return cb(null, list);
    return cb(null, list[0]!.address, list[0]!.family);
  });
}

export async function safeFetch(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; signal?: AbortSignal } = {},
): Promise<SafeResponse> {
  const { timeoutMs = 8000, maxBytes = 512_000, maxRedirects = 4 } = opts;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const u = parseTargetUrl(current);
    await assertPublicHost(u.hostname);
    const res = await new Promise<SafeResponse & { location?: string }>((resolve, reject) => {
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(
        u,
        { method: "GET", lookup: safeLookup as never, timeout: timeoutMs, headers: { "user-agent": "SEOAuditorBot/0.1 (+robots-and-sitemap-check)", accept: "text/plain,text/xml,application/xml,*/*;q=0.5" } },
        (r) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          r.on("data", (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              truncated = true;
              r.destroy();
              return;
            }
            chunks.push(c);
          });
          const done = () =>
            resolve({
              status: r.statusCode ?? 0,
              finalUrl: u.toString(),
              body: Buffer.concat(chunks).toString("utf8"),
              truncated,
              contentType: String(r.headers["content-type"] ?? ""),
              location: r.headers.location,
            });
          r.on("end", done);
          r.on("close", done);
          r.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("Request timed out")));
      req.on("error", reject);
      opts.signal?.addEventListener("abort", () => req.destroy(new Error("Aborted")), { once: true });
      req.end();
    });
    if (res.status >= 300 && res.status < 400 && res.location) {
      current = new URL(res.location, u).toString(); // re-validated at top of loop
      continue;
    }
    return res;
  }
  throw new UrlRejected("Too many redirects.");
}
