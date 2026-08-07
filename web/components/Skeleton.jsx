export function SkeletonCard() {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="skeleton" style={{ height: 14, width: "40%" }} />
      <div className="skeleton" style={{ height: 32, width: "70%" }} />
      <div className="skeleton" style={{ height: 12, width: "30%" }} />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <tr>
      <td><div className="skeleton" style={{ height: 18, width: "80%" }} /></td>
      <td><div className="skeleton" style={{ height: 18, width: "60%" }} /></td>
      <td><div className="skeleton" style={{ height: 18, width: "40%" }} /></td>
      <td><div className="skeleton" style={{ height: 18, width: "50%" }} /></td>
      <td><div className="skeleton" style={{ height: 24, width: "70%", borderRadius: 99 }} /></td>
      <td><div className="skeleton" style={{ height: 28, width: 80, borderRadius: 10 }} /></td>
    </tr>
  );
}
