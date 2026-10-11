/**
 * Hero-scale brand gradient (orange → magenta → periwinkle) from design.md, drawn as layered translucent
 * ribbons that read as a scent trail drifting toward a lens. Used only at hero size, never miniaturised.
 */
export function HeroRibbon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 560 420" className={className} role="presentation" aria-hidden="true" fill="none">
      <defs>
        <linearGradient id="rb" x1="0" y1="0" x2="560" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fc4c02" />
          <stop offset="0.5" stopColor="#ef2cc1" />
          <stop offset="1" stopColor="#bdbbff" />
        </linearGradient>
      </defs>
      <g stroke="url(#rb)" strokeLinecap="round">
        <path d="M-10 330C90 330 120 250 210 250S330 330 400 300 470 190 570 150" strokeWidth="46" opacity="0.28" />
        <path d="M-10 300C90 300 130 215 215 218S335 300 405 270 480 160 570 122" strokeWidth="30" opacity="0.5" />
        <path d="M-10 270C90 270 140 182 220 186S340 270 410 240 490 130 570 94" strokeWidth="18" opacity="0.8" />
        <path d="M-10 244C90 244 150 152 225 156S345 244 415 214 495 104 570 70" strokeWidth="8" />
      </g>
      <g fill="url(#rb)">
        <circle cx="448" cy="86" r="11" />
        <circle cx="496" cy="62" r="7" opacity="0.8" />
        <circle cx="534" cy="44" r="4" opacity="0.6" />
      </g>
    </svg>
  );
}
