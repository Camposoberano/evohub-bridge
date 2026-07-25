// catalog — Vitrine WhatsApp Campo Soberano (66 produtos Demetra), navegação por lista uazapi.
// Árvore: grupo (grp_<slug>) -> categoria (cat_<slug>) -> produto (prod_<sku>) -> ação (acao_<sku>_<acao>).
// Paginação (>9 linhas): pg_cat_<groupSlug>_more_<page> / pg_prod_<categorySlug>_more_<page>.
//
// Milestone 1: navegação completa (dados já existem via import-catalog.ts), ficha de produto
// (auto_reply pronto na planilha) e só a ação "consultor" implementada de ponta a ponta.
// Demais ações (ficha/mídias/comparar/orçamento) respondem placeholder até os próximos milestones.
//
// conv pode ser null (contato ainda sem linha em contacts/conversations — ex.: primeiro clique
// antes do ingestInbound rodar pra essa mensagem). Igual aos handlers antigos (handleMenuClick
// etc.), a resposta no WhatsApp SEMPRE sai; só o que depende de conversa (nota Chatwoot, nav_state,
// pausa de funil) é pulado nesse caso.
import { admin } from "../shared/supabase.ts";
import { getDirectUazapiRoute, hybridSendList, hybridSendText } from "../shared/hybrid.ts";
import {
  buildHybridListFallback,
  type HybridListRow,
  type HybridListSection,
  paginateRows,
} from "../shared/hybrid-list.ts";
import { createConversationMessage, type CwAcct } from "../shared/chatwoot.ts";
import { autoPauseFunil } from "./funil-control.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

const PRODUCT_ACTIONS: { code: string; title: string }[] = [
  { code: "descricao", title: "Descrição completa" },
  { code: "ficha", title: "Ficha técnica" },
  { code: "midias", title: "Fotos e vídeos" },
  { code: "comparar", title: "Comparar opções" },
  { code: "orcamento", title: "Solicitar orçamento" },
  { code: "consultor", title: "Falar com consultor" },
];

type ConvRef = { id: string; chatwoot_conversation_id: number | null };

async function resolveConversation(
  db: Db,
  channel: Json,
  from: string,
): Promise<ConvRef | null> {
  const { data: contact } = await db.from("contacts").select("id")
    .eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  if (!contact) return null;
  const { data: conv } = await db.from("conversations")
    .select("id,chatwoot_conversation_id")
    .eq("contact_id", contact.id).neq("status", "resolved")
    .order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (!conv?.id) return null;
  return {
    id: conv.id as string,
    chatwoot_conversation_id: (conv.chatwoot_conversation_id as number) ?? null,
  };
}

async function pauseFunil(conv: ConvRef | null, reason: string): Promise<void> {
  if (!conv) return;
  await autoPauseFunil(conv.id, reason);
}

async function resolveRoute(channel: Json) {
  const instanceName = (channel.external_id as string) || (channel.name as string);
  if (!instanceName) return null;
  return await getDirectUazapiRoute(channel.id as string, instanceName);
}

// Registra a mensagem já enviada no Chatwoot/messages, se houver conversa resolvida.
async function registerOutbound(
  db: Db,
  channel: Json,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  content: string,
  msgType: "text" | "interactive",
): Promise<void> {
  if (!conv) return; // sem conversa ainda: mensagem já foi pro WhatsApp, só não dá pra registrar.
  let cwMsgId: number | null = null;
  if (conv.chatwoot_conversation_id) {
    try {
      const cw = await createConversationMessage(
        conv.chatwoot_conversation_id,
        { content, messageType: "outgoing" },
        acct,
      );
      cwMsgId = (cw?.id as number) ?? null;
    } catch (e) {
      console.warn("catalog: registro Chatwoot falhou", String(e).slice(0, 150));
    }
  }
  await db.from("messages").insert({
    conversation_id: conv.id,
    channel_id: channel.id,
    direction: "out",
    msg_type: msgType,
    content,
    chatwoot_message_id: cwMsgId,
    status: "sent",
    sent_at: new Date().toISOString(),
  });
}

// Envia lista + registra no Chatwoot/messages. Se a uazapi falhar, cai pro texto plano
// (sem carrossel/lista nativa — cliente ainda consegue navegar respondendo o nome da opção).
async function sendList(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  text: string,
  sections: HybridListSection[],
  buttonLabel: string,
): Promise<void> {
  const route = await resolveRoute(channel);
  let sentVia: "uazapi" | "fallback" = "fallback";
  let registro = text;
  if (route) {
    const r = await hybridSendList(route, from, text, sections, buttonLabel);
    if (r?.ok) sentVia = "uazapi";
  }
  if (sentVia === "fallback") {
    const fallbackText = buildHybridListFallback(text, sections);
    if (route) {
      await hybridSendText(route, from, fallbackText);
    } else {
      console.warn("catalog: sem rota uazapi pro canal", channel.id);
    }
    registro = fallbackText;
  }
  await registerOutbound(db, channel, conv, acct, registro, "interactive");
}

async function sendText(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  text: string,
): Promise<void> {
  const route = await resolveRoute(channel);
  if (route) await hybridSendText(route, from, text);
  else console.warn("catalog: sem rota uazapi pro canal", channel.id);
  await registerOutbound(db, channel, conv, acct, text, "text");
}

async function setNavState(
  db: Db,
  conv: ConvRef | null,
  patch: {
    level: string;
    selected_group_slug?: string | null;
    selected_category_id?: string | null;
    selected_product_id?: string | null;
  },
): Promise<void> {
  if (!conv) return; // sem conversa ainda: nada pra persistir (nav_state é FK de conversations).
  await db.from("catalog_nav_state").upsert({
    conversation_id: conv.id,
    ...patch,
  }, { onConflict: "conversation_id" });
}

// Entrada da vitrine — disparada por intenção de texto livre ("produtos", "catálogo"...).
export async function sendCatalogRootMenu(
  db: Db,
  channel: Json,
  from: string,
  acct?: CwAcct,
): Promise<void> {
  const conv = await resolveConversation(db, channel, from);
  await pauseFunil(conv, "catalog");

  const { data: categories } = await db.from("product_categories")
    .select("group_name,group_slug,sort_order")
    .eq("active", true).order("sort_order", { ascending: true });
  const groups: { slug: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const c of categories ?? []) {
    const slug = c.group_slug as string;
    if (seen.has(slug)) continue;
    seen.add(slug);
    groups.push({ slug, name: c.group_name as string });
  }
  if (groups.length === 0) {
    await sendText(db, channel, from, conv, acct, "Catálogo em atualização, já volto com as opções.");
    return;
  }

  await setNavState(db, conv, { level: "root" });
  const rows: HybridListRow[] = groups.map((g) => ({ id: `grp_${g.slug}`, title: g.name }));
  await sendList(
    db,
    channel,
    from,
    conv,
    acct,
    "🌱 *Campo Soberano* — sementes e soluções pra sua propriedade.\n\nO que você procura?",
    [{ title: "Linhas de produto", rows }],
    "Ver opções",
  );
}

async function sendCategoryList(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  groupSlug: string,
  page: number,
): Promise<void> {
  const { data: categories } = await db.from("product_categories")
    .select("slug,name,sort_order")
    .eq("group_slug", groupSlug).eq("active", true).order("sort_order", { ascending: true });
  if (!categories?.length) {
    await sendText(db, channel, from, conv, acct, "Não encontrei categorias nessa linha, tenta de novo em instantes.");
    return;
  }
  const groupName = (categories[0] as Json).name as string ?? groupSlug;
  await setNavState(db, conv, { level: "group", selected_group_slug: groupSlug });

  const allRows: HybridListRow[] = categories.map((c: Json) => ({
    id: `cat_${c.slug}`,
    title: c.name as string,
  }));
  const { rows } = paginateRows(allRows, page, `pg_cat_${groupSlug}`);
  await sendList(
    db,
    channel,
    from,
    conv,
    acct,
    `Categorias disponíveis. Escolha uma:`,
    [{ title: groupName, rows }],
    "Ver categorias",
  );
}

async function sendProductList(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  categorySlug: string,
  page: number,
): Promise<void> {
  const { data: category } = await db.from("product_categories")
    .select("id,name").eq("slug", categorySlug).maybeSingle();
  if (!category) {
    await sendText(db, channel, from, conv, acct, "Categoria não encontrada.");
    return;
  }
  const { data: products } = await db.from("products")
    .select("sku,name,short_name,sort_order")
    .eq("category_id", category.id).eq("status", "active")
    .order("sort_order", { ascending: true });
  if (!products?.length) {
    await sendText(db, channel, from, conv, acct, `Sem produtos ativos em ${category.name} no momento.`);
    return;
  }
  await setNavState(db, conv, {
    level: "category",
    selected_category_id: category.id as string,
  });

  const allRows: HybridListRow[] = products.map((p: Json) => ({
    id: `prod_${p.sku}`,
    title: ((p.short_name as string) || (p.name as string)).slice(0, 24),
  }));
  const { rows } = paginateRows(allRows, page, `pg_prod_${categorySlug}`);
  await sendList(
    db,
    channel,
    from,
    conv,
    acct,
    `Produtos em *${category.name}*. Escolha um:`,
    [{ title: category.name as string, rows }],
    "Ver produtos",
  );
}

async function sendProductDetail(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  sku: string,
): Promise<void> {
  const { data: product } = await db.from("products")
    .select("id,sku,name,description,auto_reply")
    .eq("sku", sku).eq("status", "active").maybeSingle();
  if (!product) {
    await sendText(db, channel, from, conv, acct, "Produto não encontrado ou indisponível.");
    return;
  }
  await setNavState(db, conv, {
    level: "product",
    selected_product_id: product.id as string,
  });

  const presentation = (product.auto_reply as string) ||
    (product.description as string) || (product.name as string);
  await sendText(db, channel, from, conv, acct, presentation);

  const rows: HybridListRow[] = PRODUCT_ACTIONS.map((a) => ({
    id: `acao_${sku}_${a.code}`,
    title: a.title,
  }));
  await sendList(
    db,
    channel,
    from,
    conv,
    acct,
    "O que você quer ver?",
    [{ title: "Ações", rows }],
    "Ver ações",
  );
}

async function handleProductAction(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  sku: string,
  actionCode: string,
): Promise<void> {
  const { data: product } = await db.from("products")
    .select("name,description,source_url").eq("sku", sku).maybeSingle();
  const name = (product?.name as string) ?? sku;

  if (actionCode === "descricao") {
    await sendText(db, channel, from, conv, acct, (product?.description as string) || `Sem descrição adicional pra ${name}.`);
    return;
  }
  if (actionCode === "consultor") {
    await pauseFunil(conv, "catalog_humano");
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      `Combinado! Já chamei um consultor Campo Soberano pra te atender sobre *${name}*. Só um instante 🙂`,
    );
    if (conv?.chatwoot_conversation_id) {
      try {
        await createConversationMessage(
          conv.chatwoot_conversation_id,
          { content: `🔔 Cliente pediu consultor no catálogo — produto: ${name} (${sku})`, messageType: "outgoing", private: true },
          acct,
        );
      } catch (e) {
        console.warn("catalog: nota privada consultor falhou", String(e).slice(0, 150));
      }
    }
    return;
  }
  // ficha / midias / comparar / orcamento: fluxo completo chega nos próximos milestones
  // (ficha técnica por produto, biblioteca de mídia, comparador e qualificação de orçamento).
  await sendText(
    db,
    channel,
    from,
    conv,
    acct,
    `Essa opção pra *${name}* ainda está sendo preparada. Quer falar direto com um consultor?`,
  );
}

export async function handleCatalogClick(
  db: Db,
  channel: Json,
  from: string,
  id: string,
  acct?: CwAcct,
): Promise<void> {
  const conv = await resolveConversation(db, channel, from);
  await pauseFunil(conv, "catalog");

  if (id.startsWith("pg_cat_")) {
    const m = /^pg_cat_(.+)_more_(\d+)$/.exec(id);
    if (m) await sendCategoryList(db, channel, from, conv, acct, m[1], Number(m[2]));
    return;
  }
  if (id.startsWith("pg_prod_")) {
    const m = /^pg_prod_(.+)_more_(\d+)$/.exec(id);
    if (m) await sendProductList(db, channel, from, conv, acct, m[1], Number(m[2]));
    return;
  }
  if (id.startsWith("grp_")) {
    await sendCategoryList(db, channel, from, conv, acct, id.slice(4), 0);
    return;
  }
  if (id.startsWith("cat_")) {
    await sendProductList(db, channel, from, conv, acct, id.slice(4), 0);
    return;
  }
  if (id.startsWith("prod_")) {
    await sendProductDetail(db, channel, from, conv, acct, id.slice(5));
    return;
  }
  if (id.startsWith("acao_")) {
    const rest = id.slice(5);
    const sepIndex = rest.lastIndexOf("_");
    if (sepIndex === -1) return;
    const sku = rest.slice(0, sepIndex);
    const actionCode = rest.slice(sepIndex + 1);
    await handleProductAction(db, channel, from, conv, acct, sku, actionCode);
    return;
  }
  console.warn("catalog: clique sem handler", id);
}
