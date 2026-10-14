/** Canonical origin for absolute URLs (sitemap, Open Graph, JSON-LD). Set APP_URL in production. */
const hostingOrigin = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
export const SITE_URL = (process.env.APP_URL || (hostingOrigin ? `https://${hostingOrigin}` : "http://localhost:3000")).replace(/\/$/, "");
export const SITE_NAME = "SEOAuditor";
export const SITE_TITLE = "SEOAuditor: AI Search Visibility & SEO Audit Tool";
export const SITE_DESC =
  "Audit how your page appears in search results and what AI retrieval tools can actually extract from it. Evidence-backed SEO and AI-visibility findings from real search, fetch and browser checks.";
