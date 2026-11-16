"use client";
// SeletorPublico — dropdown dos Públicos salvos (listas /audiences), reusável nas telas de
// disparo. Lê via bridge (RLS em audiences bloqueia leitura direta). Ao escolher, devolve os
// números (telefones) por onNums; "— nenhum —" devolve []. Portado do hub CECAPE.
import { useState, useEffect } from "react";
import { supabase, BRIDGE_URL } from "@/lib/supabase";

export default function SeletorPublico({ onNums, onSelect, label = "Ou escolher um Público salvo" }) {
  const [publicos, setPublicos] = useState([]);
  const [id, setId] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const r = await fetch(`${BRIDGE_URL}/audiences`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).then((x) => x.json()).catch(() => ({}));
      setPublicos(r.audiences ?? []);
    })();
  }, []);

  async function escolher(v) {
    setId(v);
    if (!v) { onNums([]); onSelect?.(null); return; }
    const { data: { session } } = await supabase.auth.getSession();
    const b = await fetch(`${BRIDGE_URL}/audiences?id=${encodeURIComponent(v)}`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    }).then((x) => x.json()).catch(() => ({}));
    const nums = [...new Set(
      (b.contacts ?? []).map((c) => String(c.phone ?? "").replace(/\D/g, "")).filter((n) => n.length >= 12),
    )];
    onNums(nums);
    onSelect?.({ id: v, audience: b.audience, contacts: b.contacts ?? [] });
  }

  if (!publicos.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 6 }}>{label}</label>
      <select value={id} onChange={(e) => escolher(e.target.value)} style={{ width: "100%", padding: "9px 12px", borderRadius: 10, fontSize: 13 }}>
        <option value="">— nenhum —</option>
        {publicos.map((p) => (
          <option key={p.id} value={p.id}>{p.name}{p.contact_count != null ? ` (${p.contact_count})` : ""}</option>
        ))}
      </select>
    </div>
  );
}
