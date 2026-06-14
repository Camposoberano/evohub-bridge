"use client";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";

const LINKS = [
  ["/conexoes", "Conexões"],
  ["/conversas", "Conversas"],
  ["/contatos", "Contatos"],
  ["/analytics", "Analytics"],
  ["/instancias", "Instâncias"],
  ["/disparos", "Disparos"],
  ["/tecnologias", "Tecnologias"],
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function sair() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="nav">
      <div className="nav-inner">
        <Link href="/conexoes" className="nav-brand"><Logo /></Link>
        <nav className="nav-links">
          {LINKS.map(([href, label]) => (
            <Link key={href} href={href}
              className={"nav-link" + (pathname === href ? " nav-link-active" : "")}>
              {label}
            </Link>
          ))}
        </nav>
        <button className="btn-ghost" onClick={sair}>Sair</button>
      </div>
    </div>
  );
}
