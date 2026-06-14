// Marca Soberano — coroa em ouro + wordmark Fraunces. size controla a altura do ícone.
export default function Logo({ size = 24, showText = true }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <defs>
          <linearGradient id="sob-gold" x1="2" y1="3" x2="22" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#f3dd9a" />
            <stop offset=".5" stopColor="#d8b766" />
            <stop offset="1" stopColor="#b8923f" />
          </linearGradient>
        </defs>
        <path d="M3 8.6l3.5 2.7L12 4l5.5 7.3L21 8.6l-1.7 9.1a1 1 0 0 1-1 .8H5.7a1 1 0 0 1-1-.8L3 8.6Z"
          fill="url(#sob-gold)" />
        <rect x="5.4" y="19" width="13.2" height="1.7" rx=".85" fill="url(#sob-gold)" />
        <circle cx="3" cy="8.6" r="1.5" fill="#f3dd9a" />
        <circle cx="21" cy="8.6" r="1.5" fill="#f3dd9a" />
        <circle cx="12" cy="4" r="1.7" fill="#f3dd9a" />
      </svg>
      {showText && (
        <span style={{ fontFamily: '"Fraunces", serif', fontWeight: 600, fontSize: 19, letterSpacing: "-.01em", color: "var(--text)" }}>
          Soberano
        </span>
      )}
    </span>
  );
}
