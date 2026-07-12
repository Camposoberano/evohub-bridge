import { redirect } from "next/navigation";

// Keep the root redirect server-side and dynamic so the adapter emits a real
// Location header instead of serving a cached RSC redirect as a 404 document.
export const dynamic = "force-dynamic";

export default function Home() {
  redirect("/conexoes");
}
