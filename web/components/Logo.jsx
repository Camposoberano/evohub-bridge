// Marca Soberano — coroa em degradê violeta→magenta (modelo Make) + wordmark Sora.
export default function Logo({ size = 24, showText = true }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
        <defs>
          <linearGradient id="sob-grad" x1="2" y1="3" x2="22" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor="#a855f7" />
            <stop offset=".5" stopColor="#d946ef" />
            <stop offset="1" stopColor="#ff4d8d" />
          </linearGradient>
        </defs>
        <path d="M3 8.6l3.5 2.7L12 4l5.5 7.3L21 8.6l-1.7 9.1a1 1 0 0 1-1 .8H5.7a1 1 0 0 1-1-.8L3 8.6Z"
          fill="url(#sob-grad)" />
        <rect x="5.4" y="19" width="13.2" height="1.7" rx=".85" fill="url(#sob-grad)" />
        <circle cx="3" cy="8.6" r="1.5" fill="#c77dff" />
        <circle cx="21" cy="8.6" r="1.5" fill="#ff7daa" />
        <circle cx="12" cy="4" r="1.7" fill="#d98cff" />
      </svg>
      {showText && (
        <span style={{ fontFamily: '"Sora", sans-serif', fontWeight: 700, fontSize: 18, letterSpacing: "-.02em", color: "var(--text)" }}>
          Soberano
        </span>
      )}
    </span>
  );
}
