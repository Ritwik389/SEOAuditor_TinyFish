// Shared, client-safe domain types. No secrets ever live in these shapes.

export type StageStatus = "queued" | "running" | "completed" | "failed" | "skipped" | "waiting_config";
export type AuditStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled" | "waiting_config";
export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "high" | "medium" | "low";
export type CheckStatus = "pass" | "warning" | "fail" | "not_checked" | "unknown";
export type VerificationMode = "off" | "auto" | "always";
export type VerificationStatus = "confirmed" | "observed" | "potential" | "needs_browser" | "unverified";

export const STAGES = [
  { id: "validate_url", label: "Validating the target URL", provider: "internal" },
  { id: "prepare_query", label: "Preparing the search query", provider: "internal" },
  { id: "search", label: "Searching for the target page", provider: "tinyfish-search" },
  { id: "inspect_results", label: "Inspecting relevant search results", provider: "internal" },
  { id: "fetch", label: "Fetching the live page", provider: "tinyfish-fetch" },
  { id: "extract", label: "Extracting the page's main content", provider: "internal" },
  { id: "compare", label: "Comparing discovered information with extracted content", provider: "internal" },
  { id: "seo_checks", label: "Checking SEO and technical signals", provider: "internal" },
  { id: "browser_verify", label: "Verifying disputed findings in the browser", provider: "tinyfish-browser" },
  { id: "agent_verify", label: "Checking content behind page interactions", provider: "tinyfish-agent" },
  { id: "recommendations", label: "Generating prioritized recommendations", provider: "gemini" },
  { id: "save", label: "Saving the final report", provider: "mongodb" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export interface StageRecord {
  stageId: StageId;
  label: string;
  provider: string;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  attempt: number;
  message?: string;
  error?: string;
  evidenceIds: string[];
}

export interface LogEvent {
  t: string;
  stageId: StageId | "audit";
  level: "info" | "warn" | "error";
  message: string;
  detail?: string;
}

export interface QueryEntry {
  text: string;
  source: "user" | "inferred";
  rationale?: string;
}

export interface AuditSettings {
  location?: string;
  language?: string;
  verification: VerificationMode;
  /** Opt-in: an Agent run uses wallet credits and only opens read-only page controls. */
  agentVerification?: boolean;
}

// ---- Normalized evidence payloads -------------------------------------------------

export interface SearchResultItem {
  position: number;
  title: string;
  url: string;
  snippet: string;
  siteName: string;
}
export type MatchMethod = "exact" | "normalized" | "canonical" | "final-url" | "same-path-different-query";
export interface SearchPayload {
  query: string;
  location?: string;
  language?: string;
  page: number;
  totalResults?: number;
  results: SearchResultItem[];
  match: { position: number; method: MatchMethod; url: string } | null;
}

export interface PageMetadata {
  canonical?: string;
  robots?: string;
  favicon?: string;
  og?: Record<string, unknown>;
  twitter?: Record<string, unknown>;
  [k: string]: unknown;
}
export interface FetchPayload {
  requestedUrl: string;
  finalUrl: string | null;
  title: string | null;
  description: string | null;
  language: string | null;
  author: string | null;
  publishedDate: string | null;
  text: string;
  textLength: number;
  textTruncated: boolean;
  pageMetadata: PageMetadata | null;
  links: string[] | null;
  latencyMs: number | null;
  error?: { code: string; status?: number; message: string };
}

export interface BrowserPayload {
  requestedUrl: string;
  finalUrl: string | null;
  title: string;
  headings: { level: number; text: string }[];
  visibleTextLength: number;
  visibleTextSample: string;
  jsonLd: { valid: boolean; types: string[]; sample: string }[];
  canonical: string | null;
  robotsMeta: string | null;
  linkCount: number;
  objective: string;
  missingFromFetch: string[];
}

/** Agent observations are model-produced, not independently captured browser DOM. */
export interface AgentPayload {
  requestedUrl: string;
  finalUrl: string | null;
  title: string;
  visibleTextSample: string;
  interactions: { control: string; action: string; result: string }[];
  answers: { question: string; answer: string; quote: string }[];
  blockers: string[];
  missingFromFetch: string[];
  objective: string;
  observationsOnly: true;
  /** Omission counts are meaningful only against a successful, complete Fetch sample. */
  fetchComparison?: "complete" | "unmeasured";
}

export type AgentRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface AgentRunPayload {
  runId: string;
  /** SUBMITTED records the create acknowledgment when it has no provider status. */
  status: AgentRunStatus | "SUBMITTED";
  steps: number | null;
  error: string | null;
}

export interface RobotsPayload {
  url: string;
  status: number | null;
  bodySample: string;
  error?: string;
  genericDisallowsPath: boolean | null;
  matchedRule?: string;
  aiBotDisallows: string[];
  sitemaps: string[];
}
export interface SitemapPayload {
  url: string;
  status: number | null;
  isIndex: boolean;
  listsTarget: boolean | null;
  urlCount: number | null;
  error?: string;
}

export type EvidenceKind = "search" | "fetch" | "browser" | "agent" | "agent_run" | "robots" | "sitemap";
export interface EvidenceRecord<P = unknown> {
  evidenceId: string;
  auditId: string;
  sourceType: EvidenceKind;
  label: string;
  endpoint: string;
  sourceUrl?: string;
  query?: string;
  capturedAt: string;
  retrieval: "live" | "live-or-cache";
  request: Record<string, unknown>;
  normalizedPayload: P;
  contentHash: string;
  metadata: Record<string, unknown>;
  limitations: string[];
  schemaVersion: number;
}

// ---- Analysis outputs -------------------------------------------------------------

export interface TechnicalCheck {
  checkId: string;
  label: string;
  status: CheckStatus;
  kind: "observed" | "inferred";
  observed: string;
  note?: string;
  evidenceRefs: string[];
}

export interface ExtractionSummary {
  headings: { level: number; text: string }[];
  wordCount: number;
  mainContentExcerpt: string;
  facts: { type: string; value: string }[];
  internalLinks: number | null;
  externalLinks: number | null;
  sampleInternalLinks: string[];
  absentFromExtraction: string[];
  entities: { name: string; type: string; excerpt: string }[];
}

export interface QueryCoverageRow {
  term: string;
  inTitle: boolean;
  inH1: boolean;
  inDescription: boolean;
  inBody: boolean;
  inSnippet: boolean | null;
}
export interface GapAnalysis {
  query: string;
  coverage: QueryCoverageRow[];
  snippetPhrasesNotOnPage: string[];
  competitorTerms: { term: string; competitors: number }[];
  searchCommunicates?: string;
  pageExplains?: string;
  purposeMatch?: "yes" | "partial" | "no" | "unclear";
  purposeRationale?: string;
  snippetOmissions?: string[];
  notes: string[];
  evidenceRefs: string[];
  source: "deterministic" | "deterministic+semantic";
}

export interface Finding {
  findingId: string;
  auditId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  category: string;
  origin: "deterministic" | "semantic";
  explanation: string;
  whyItMatters: string;
  evidenceRefs: string[];
  excerpts: { evidenceId: string; text: string; verified: boolean }[];
  recommendedAction: string;
  suggestedImplementation?: string;
  expectedOutcome: string;
  verificationMethod: string;
  verificationStatus: VerificationStatus;
  reportSection: "search" | "fetch" | "gap" | "technical";
  createdAt: string;
  schemaVersion: number;
}

export interface AuditSummary {
  search: "found" | "not_found" | "not_run" | "failed";
  searchPosition?: number;
  fetch: "ok" | "failed" | "not_run";
  browser: "verified" | "skipped" | "failed" | "unavailable";
  agent?: "verified" | "skipped" | "failed" | "unavailable";
  findingsCount: number;
  topIssue?: string;
  firstAction?: string;
  apiCalls: { search: number; fetch: number; browser: number; gemini: number; agent?: number; agentStatus?: number; agentCancel?: number };
  semanticAnalysis: "used" | "unavailable" | "failed";
  extraction?: ExtractionSummary;
  gaps: GapAnalysis[];
  checks: TechnicalCheck[];
}

export interface AuditDoc {
  auditId: string;
  /** Owner (user) id. Every read/write from the UI/API is scoped by it. */
  ownerId: string;
  schemaVersion: number;
  label?: string;
  targetUrl: string;
  normalizedTargetUrl: string;
  queries: QueryEntry[];
  settings: AuditSettings;
  status: AuditStatus;
  currentStage?: StageId;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  stages: StageRecord[];
  log: LogEvent[];
  summary?: AuditSummary;
  errorSummary?: string;
  retryOf?: string;
}

export interface ReportData {
  audit: AuditDoc;
  evidence: EvidenceRecord[];
  findings: Finding[];
  demo?: boolean;
}

export const SCHEMA_VERSION = 2;
export const TERMINAL: AuditStatus[] = ["completed", "partial", "failed", "cancelled", "waiting_config"];
