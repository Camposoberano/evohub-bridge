// Marca Soberano — coroa + wordmark. size controla a altura do ícone.
export default function Logo({ size = 22, showText = true }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <defs>
          <linearGradient id="sob-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
            <stop stopColor="#00e2a0" />
            <stop offset="1" stopColor="#00b07c" />
          </linearGradient>
        </defs>
        <path d="M3 8.5l3.4 2.6L12 4l5.6 7.1L21 8.5l-1.6 9.2a1 1 0 0 1-1 .8H5.6a1 1 0 0 1-1-.8L3 8.5Z"
          fill="url(#sob-grad)" />
        <circle cx="3" cy="8.5" r="1.6" fill="#00e2a0" />
        <circle cx="21" cy="8.5" r="1.6" fill="#00e2a0" />
        <circle cx="12" cy="4" r="1.8" fill="#00e2a0" />
      </svg>
      {showText && (
        <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-.01em", color: "var(--text)" }}>
          Soberano
        </span>
      )}
    </span>
  );
}
