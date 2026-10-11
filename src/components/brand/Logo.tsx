import type { CSSProperties } from "react";

/**
 * Sniffsite mark: a search lens whose ring is open where the "handle" would be; the opening releases
 * a scent trail (three shrinking dots). The solid wedge inside is a radar sweep. Drawn only with circles and
 * one arc, on a 32-unit grid, in a single colour (currentColor) so it holds up from favicon to hero size.
 * The brand gradient from design.md is reserved for hero-scale graphics, so the mark never uses it.
 */
export function LogoMark({ size = 28, compact = false, animated = false, title, className, style }: { size?: number; compact?: boolean; animated?: boolean; title?: string; className?: string; style?: CSSProperties }) {
  const sw = compact ? 3.6 : 3;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" role={title ? "img" : "presentation"} aria-label={title} aria-hidden={title ? undefined : true} className={className} style={style}>
      <path d="M10.26 16.71A9.5 9.5 0 1 1 15.29 21.75" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      <path className={animated ? "sweep" : undefined} d="M19 13V7.4A5.6 5.6 0 0 1 24.6 13Z" fill="currentColor" />
      {compact ? (
        <>
          <circle cx="8.4" cy="24.2" r="2.6" fill="currentColor" />
          <circle cx="4.2" cy="28.2" r="1.7" fill="currentColor" />
        </>
      ) : (
        <>
          <circle className={animated ? "trail-dot" : undefined} cx="8.6" cy="23.9" r="2.2" fill="currentColor" />
          <circle className={animated ? "trail-dot" : undefined} cx="5.4" cy="27" r="1.6" fill="currentColor" />
          <circle className={animated ? "trail-dot" : undefined} cx="2.9" cy="29.5" r="1.1" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** Mark + custom wordmark. `tone="dark"` is for dark surfaces (white mark and text). */
export function Logo({ tone = "light", size = 28, compact = false, className = "" }: { tone?: "light" | "dark"; size?: number; compact?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${tone === "dark" ? "text-white" : "text-ink"} ${className}`} aria-label="Sniffsite">
      <LogoMark size={size} compact={compact} />
      <span aria-hidden="true" style={{ fontSize: size * 0.82, lineHeight: 1, letterSpacing: "-0.04em", fontWeight: 500 }}>
        sniff<span style={{ opacity: 0.62 }}>site</span>
      </span>
    </span>
  );
}

/** Loading / empty-state mark with the scent trail animating. */
export function LogoLoader({ size = 56, label }: { size?: number; label?: string }) {
  return (
    <span role="status" className="inline-flex flex-col items-center gap-2 text-ink">
      <LogoMark size={size} animated />
      {label ? <span className="eyebrow">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}
