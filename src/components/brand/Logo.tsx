import { FileSearch, LoaderCircle } from "lucide-react";
import type { CSSProperties } from "react";

/** A generic document-search icon for empty states, without a custom brand mark. */
export function LogoMark({ size = 28, title, className, style }: { size?: number; compact?: boolean; animated?: boolean; title?: string; className?: string; style?: CSSProperties }) {
  return <FileSearch size={size} role={title ? "img" : "presentation"} aria-label={title} aria-hidden={title ? undefined : true} className={className} style={style} />;
}

/** Plain application name, retaining the existing navigation typography. */
export function Logo({ tone = "light", size = 28, className = "" }: { tone?: "light" | "dark"; size?: number; compact?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center ${tone === "dark" ? "text-white" : "text-ink"} ${className}`} style={{ fontSize: size * 0.82, lineHeight: 1, letterSpacing: "-0.04em", fontWeight: 500 }}>
      SEOAuditor
    </span>
  );
}

export function LogoLoader({ size = 56, label }: { size?: number; label?: string }) {
  return (
    <span role="status" className="inline-flex flex-col items-center gap-2 text-ink">
      <LoaderCircle size={size} className="animate-spin motion-reduce:animate-none" aria-hidden />
      {label ? <span className="eyebrow">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
