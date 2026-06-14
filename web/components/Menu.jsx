"use client";
import { useState, useRef, useEffect } from "react";

// Menu "⋯" — recolhe ações pra não poluir a tela. items: [{label, onClick, danger}]
export default function Menu({ items, label = "⋯" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div className="menu" ref={ref}>
      <button className="btn-ghost mini" onClick={() => setOpen(!open)}>{label}</button>
      {open && (
        <div className="menu-pop">
          {items.map((it, i) => (
            <button key={i} className={"menu-item" + (it.danger ? " menu-item-danger" : "")}
              onClick={() => { setOpen(false); it.onClick(); }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
