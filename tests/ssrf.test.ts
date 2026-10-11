import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPrivateIp, parseTargetUrl, assertPublicHost, safeFetch, UrlRejected } from "@/lib/security/ssrf";

describe("isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:c0a8:101::1", "2001:db8::1"])(
    "blocks %s",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );
  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
  it("treats non-IP strings as unsafe", () => expect(isPrivateIp("not-an-ip")).toBe(true));
});

describe("parseTargetUrl", () => {
  it.each([
    ["javascript:alert(1)", /http/],
    ["file:///etc/passwd", /http/],
    ["ftp://example.com", /http/],
    ["http://user:pw@example.com", /credentials/],
    ["http://localhost/", /Local/],
    ["http://foo.localhost/", /Local/],
    ["http://intranet/", /Local/],
    ["http://printer.local/", /Local/],
    ["http://127.0.0.1/", /Private/],
    ["http://[::1]/", /Private/],
    ["http://2130706433/", /Private/], // decimal-encoded 127.0.0.1 is normalised by URL
    ["http://0x7f.1/", /Private/],
    ["https://example.com:22/", /port/],
    ["not a url", /valid URL/],
  ])("rejects %s", (u, msg) => {
    expect(() => parseTargetUrl(u)).toThrow(UrlRejected);
    expect(() => parseTargetUrl(u)).toThrow(msg);
  });
  it("accepts ordinary public URLs", () => {
    expect(parseTargetUrl("https://example.com/a?b=1").hostname).toBe("example.com");
    expect(parseTargetUrl("http://example.com:8080/").port).toBe("8080");
  });
});

describe("assertPublicHost", () => {
  it("rejects private IP literals without DNS", async () => {
    await expect(assertPublicHost("10.0.0.5")).rejects.toThrow(UrlRejected);
    await expect(assertPublicHost("[::1]")).rejects.toThrow(UrlRejected);
  });
  it("rejects hostnames that resolve to loopback", async () => {
    // 'localhost' resolves to 127.0.0.1 / ::1 on every platform
    await expect(assertPublicHost("localhost")).rejects.toThrow(UrlRejected);
  });
});

describe("safeFetch redirect and address revalidation", () => {
  let server: http.Server;
  let port: number;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/to-metadata") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        return res.end();
      }
      res.end("ok");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => server.close());

  it("refuses to connect to loopback even when the URL looks fine", async () => {
    await expect(safeFetch(`http://localhost:${port}/`)).rejects.toThrow(UrlRejected);
  });
  it("refuses an IP-literal loopback target", async () => {
    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  });
});
