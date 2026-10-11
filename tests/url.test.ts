import { describe, expect, it } from "vitest";
import { hostOf, matchTarget, normalizeUrl } from "@/lib/url";

describe("normalizeUrl", () => {
  it("ignores scheme, www, hash, trailing slash and tracking params", () => {
    const base = normalizeUrl("https://example.com/pricing");
    expect(normalizeUrl("http://www.example.com/pricing/")).toBe(base);
    expect(normalizeUrl("https://EXAMPLE.com/pricing#plans")).toBe(base);
    expect(normalizeUrl("https://example.com/pricing?utm_source=x&gclid=1")).toBe(base);
  });
  it("keeps meaningful query params, sorted", () => {
    expect(normalizeUrl("https://a.com/p?b=2&a=1")).toBe("a.com/p?a=1&b=2");
  });
  it("keeps non-default ports and the root path", () => {
    expect(normalizeUrl("https://a.com:8443/")).toBe("a.com:8443/");
  });
});

describe("matchTarget", () => {
  const t = "https://example.com/pricing";
  it("exact and normalized", () => {
    expect(matchTarget(t, t)?.method).toBe("exact");
    expect(matchTarget(t, "https://www.example.com/pricing/")?.method).toBe("normalized");
  });
  it("final URL and canonical", () => {
    expect(matchTarget(t, "https://example.com/plans", { finalUrl: "https://example.com/plans" })?.method).toBe("final-url");
    expect(matchTarget(t, "https://example.com/p2", { canonical: "https://example.com/p2" })?.method).toBe("canonical");
  });
  it("flags same path with different query as a weaker match", () => {
    expect(matchTarget(t, "https://example.com/pricing?plan=pro")?.method).toBe("same-path-different-query");
  });
  it("never matches other subdomains or unrelated pages", () => {
    expect(matchTarget(t, "https://blog.example.com/pricing")).toBeNull();
    expect(matchTarget(t, "https://example.com/pricing-guide")).toBeNull();
    expect(matchTarget(t, "https://example.org/pricing")).toBeNull();
  });
  it("hostOf strips www", () => expect(hostOf("https://www.a.com/x")).toBe("a.com"));
});
