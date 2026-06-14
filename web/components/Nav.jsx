"use client";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";

const I = {
  conexoes: "M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8",
  conversas: "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.9-.9L3 20l1.3-4.1A8.4 8.4 0 1 1 21 11.5Z",
  contatos: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  analytics: "M3 3v18h18M8 16V10M13 16V6M18 16v-4",
  disparos: "M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z",
  ferramentas: "M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.5 2.5-2.1-.4-.4-2.1 2.5-2.5Z",
  grupos: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  eventos: "M22 12h-4l-3 9L9 3l-3 9H2",
  tecnologias: "M12 2 4 5v6c0 5 3.4 7.8 8 10 4.6-2.2 8-5 8-10V5l-8-3Z",
};

const LINKS = [
  ["/central", "Conexões", "conexoes"],
  ["/conversas", "Conversas", "conversas"],
  ["/contatos", "Contatos", "contatos"],
  ["/analytics", "Analytics", "analytics"],
  ["/disparos", "Disparos", "disparos"],
  ["/ferramentas", "Ferramentas", "ferramentas"],
  ["/grupos", "Grupos", "grupos"],
  ["/eventos", "Eventos", "eventos"],
  ["/tecnologias", "Tecnologias", "tecnologias"],
];

function Ico({ d }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "0 0 auto" }}>
      <path d={d} />
    </svg>
  );
}

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  async function sair() { await supabase.auth.signOut(); router.replace("/login"); }

  return (
    <div className="nav">
      <div className="nav-inner">
        <Link href="/central" className="nav-brand"><Logo /></Link>
        <nav className="nav-links">
          {LINKS.map(([href, label, ico]) => (
            <Link key={href} href={href} className={"nav-link" + (pathname === href ? " nav-link-active" : "")}
              style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
              <Ico d={I[ico]} /> {label}
            </Link>
          ))}
        </nav>
        <button className="btn-ghost" onClick={sair}>Sair</button>
      </div>
    </div>
  );
}
