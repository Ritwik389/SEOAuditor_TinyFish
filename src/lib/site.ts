/** Canonical origin for absolute URLs (sitemap, Open Graph, JSON-LD). Set APP_URL in production. */
export const SITE_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
export const SITE_NAME = "Sniffsite";
export const SITE_TITLE = "Sniffsite: AI Search Visibility & SEO Audit Tool";
export const SITE_DESC =
  "Audit how your page appears in search results and what AI retrieval tools can actually extract from it. Evidence-backed SEO and AI-visibility findings from real search, fetch and browser checks.";
