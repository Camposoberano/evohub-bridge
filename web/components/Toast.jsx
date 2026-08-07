export default function Toast({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type || "info"}`}>
          <span style={{ flex: 1 }}>{t.message}</span>
          {onDismiss && (
            <button
              onClick={() => onDismiss(t.id)}
              style={{ background: "transparent", color: "var(--text-faint)", padding: 4, cursor: "pointer" }}
              aria-label="Fechar notificação"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
