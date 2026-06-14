// Cria bucket no Supabase Storage pro Chatwoot guardar anexos.
// Rodar: deno run --allow-net --allow-env --env-file=.env bridge/scripts/create-bucket.ts
import { admin } from "../shared/supabase.ts";
const db = admin();
const NAME = "chatwoot-media";

// deno-lint-ignore no-explicit-any
const storage = (db as any).storage;
const { data: list } = await storage.listBuckets();
console.log("buckets atuais:", (list ?? []).map((b: { name: string }) => b.name));

if ((list ?? []).some((b: { name: string }) => b.name === NAME)) {
  console.log("bucket já existe:", NAME);
} else {
  const { data, error } = await storage.createBucket(NAME, { public: false });
  if (error) { console.error("erro:", error.message ?? error); Deno.exit(1); }
  console.log("bucket criado:", data?.name ?? NAME);
}
