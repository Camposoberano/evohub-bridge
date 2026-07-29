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
import {
  getDirectUazapiRoute,
  hybridSendList,
  hybridSendText,
} from "../shared/hybrid.ts";
import {
  buildHybridListFallback,
  type HybridListRow,
  type HybridListSection,
  paginateRows,
} from "../shared/hybrid-list.ts";
import { createConversationMessage, type CwAcct } from "../shared/chatwoot.ts";
import { autoPauseFunil } from "../shared/funnel-state.ts";
import { isPrecoIntent } from "../shared/intent.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

const PRODUCT_ACTIONS: { code: string; title: string }[] = [
  { code: "preco", title: "Ver preço" },
  { code: "descricao", title: "Descrição completa" },
  { code: "ficha", title: "Ficha técnica" },
  { code: "midias", title: "Fotos e vídeos" },
  { code: "comparar", title: "Comparar opções" },
  { code: "orcamento", title: "Solicitar orçamento" },
  { code: "consultor", title: "Falar com consultor" },
];

const QUALIFICATION_OBJECTIVES: { code: string; label: string }[] = [
  { code: "silagem", label: "Silagem" },
  { code: "graos", label: "Grãos" },
  { code: "pastejo", label: "Pastejo" },
  { code: "formacao_pastagem", label: "Formação de pastagem" },
  { code: "cobertura_solo", label: "Cobertura de solo" },
  { code: "adubacao_verde", label: "Adubação verde" },
  { code: "cultura_inverno", label: "Cultura de inverno" },
];

type ConvRef = { id: string; chatwoot_conversation_id: number | null };
type CatalogContext = {
  active: boolean;
  conv: ConvRef | null;
  selectedProductId: string | null;
  level: string | null;
};

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

async function catalogContext(
  db: Db,
  channel: Json,
  from: string,
): Promise<CatalogContext> {
  const conv = await resolveConversation(db, channel, from);
  if (!conv) {
    return {
      active: false,
      conv: null,
      selectedProductId: null,
      level: null,
    };
  }
  const { data: state, error } = await db.from("catalog_nav_state")
    .select("journey,level,selected_product_id")
    .eq("conversation_id", conv.id)
    .maybeSingle();
  if (error) {
    throw new Error(`falha ao ler jornada do catalogo: ${error.message}`);
  }
  return {
    active: state?.journey === "catalogo",
    conv,
    selectedProductId: (state?.selected_product_id as string) ?? null,
    level: (state?.level as string) ?? null,
  };
}

export async function isCatalogJourneyActive(
  db: Db,
  channel: Json,
  from: string,
): Promise<boolean> {
  return (await catalogContext(db, channel, from)).active;
}

async function resolveRoute(channel: Json) {
  const instanceName = (channel.external_id as string) ||
    (channel.name as string);
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
      console.warn(
        "catalog: registro Chatwoot falhou",
        String(e).slice(0, 150),
      );
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
    journey?: "mega_sorgo" | "catalogo";
    level: string;
    selected_group_slug?: string | null;
    selected_category_id?: string | null;
    selected_product_id?: string | null;
  },
): Promise<void> {
  if (!conv) return; // sem conversa ainda: nada pra persistir (nav_state é FK de conversations).
  const { error } = await db.from("catalog_nav_state").upsert({
    conversation_id: conv.id,
    ...patch,
  }, { onConflict: "conversation_id" });
  if (error) {
    throw new Error(`falha ao salvar jornada do catalogo: ${error.message}`);
  }
}

// Entrada da vitrine — disparada por intenção de texto livre ("produtos", "catálogo"...).
export async function sendCatalogRootMenu(
  db: Db,
  channel: Json,
  from: string,
  acct?: CwAcct,
  pauseReason = "catalogo_manual",
): Promise<void> {
  const conv = await resolveConversation(db, channel, from);
  if (!await resolveRoute(channel)) {
    throw new Error(
      "catalogo disponivel somente em canal hibrido com rota uazapi ativa",
    );
  }
  await setNavState(db, conv, {
    journey: "catalogo",
    level: "root",
    selected_group_slug: null,
    selected_category_id: null,
    selected_product_id: null,
  });
  await pauseFunil(conv, pauseReason);

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
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Catálogo em atualização, já volto com as opções.",
    );
    return;
  }

  const rows: HybridListRow[] = groups.map((g) => ({
    id: `grp_${g.slug}`,
    title: g.name,
  }));
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
    .eq("group_slug", groupSlug).eq("active", true).order("sort_order", {
      ascending: true,
    });
  if (!categories?.length) {
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Não encontrei categorias nessa linha, tenta de novo em instantes.",
    );
    return;
  }
  const groupName = (categories[0] as Json).name as string ?? groupSlug;
  await setNavState(db, conv, {
    level: "group",
    selected_group_slug: groupSlug,
  });

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
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      `Sem produtos ativos em ${category.name} no momento.`,
    );
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
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Produto não encontrado ou indisponível.",
    );
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

  if (actionCode === "preco") {
    await sendProductPrice(db, channel, from, conv, acct, sku);
    return;
  }
  if (actionCode === "descricao") {
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      (product?.description as string) ||
        `Sem descrição adicional pra ${name}.`,
    );
    return;
  }
  if (actionCode === "orcamento") {
    await startQualification(db, channel, from, conv, acct, sku, name);
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
          {
            content:
              `🔔 Cliente pediu consultor no catálogo — produto: ${name} (${sku})`,
            messageType: "outgoing",
            private: true,
          },
          acct,
        );
      } catch (e) {
        console.warn(
          "catalog: nota privada consultor falhou",
          String(e).slice(0, 150),
        );
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

async function sendProductPrice(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  sku: string,
): Promise<void> {
  const { data: product } = await db.from("products")
    .select("id,name,sku").eq("sku", sku).eq("status", "active").maybeSingle();
  if (!product) {
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Produto não encontrado ou indisponível.",
    );
    return;
  }

  const now = Date.now();
  const { data: prices, error: priceError } = await db.from("product_prices")
    .select(
      "variant,unit,price_cents,currency,region,valid_from,valid_until,approved_at",
    )
    .eq("product_id", product.id).eq("active", true)
    .not("approved_at", "is", null)
    .order("price_cents", { ascending: true });
  if (priceError) {
    throw new Error(
      `falha ao consultar preco do produto: ${priceError.message}`,
    );
  }
  const validPrices = (prices ?? []).filter((price: Json) => {
    const starts = price.valid_from
      ? new Date(String(price.valid_from)).getTime()
      : 0;
    const ends = price.valid_until
      ? new Date(String(price.valid_until)).getTime()
      : Number.POSITIVE_INFINITY;
    return starts <= now && ends >= now;
  });

  if (!validPrices.length) {
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      `O preço de *${product.name}* ainda não está publicado no catálogo. ` +
        "Para não te passar um valor incorreto, vou levantar área, região e plantio para o consultor confirmar.",
    );
    await startQualification(
      db,
      channel,
      from,
      conv,
      acct,
      String(product.sku),
      String(product.name),
    );
    return;
  }

  const lines = validPrices.map((price: Json) => {
    const currency = String(price.currency ?? "BRL");
    const value = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
    }).format(Number(price.price_cents) / 100);
    const details = [
      price.variant ? String(price.variant) : null,
      price.unit ? `por ${price.unit}` : null,
      price.region && price.region !== "BR" ? String(price.region) : null,
    ].filter(Boolean).join(" · ");
    return `• ${value}${details ? ` — ${details}` : ""}`;
  });
  await sendText(
    db,
    channel,
    from,
    conv,
    acct,
    `Preço vigente de *${product.name}*:\n\n${lines.join("\n")}`,
  );
}

async function sendSelectedProductPrice(
  db: Db,
  channel: Json,
  from: string,
  context: CatalogContext,
  acct?: CwAcct,
): Promise<void> {
  if (!context.selectedProductId) {
    await sendText(
      db,
      channel,
      from,
      context.conv,
      acct,
      "Você está no catálogo. Escolha primeiro o produto para eu consultar o preço correto.",
    );
    return;
  }
  const { data: product } = await db.from("products").select("sku")
    .eq("id", context.selectedProductId).eq("status", "active").maybeSingle();
  if (!product?.sku) {
    await sendText(
      db,
      channel,
      from,
      context.conv,
      acct,
      "O produto selecionado não está mais disponível. Abra o catálogo e escolha outro.",
    );
    return;
  }
  await sendProductPrice(
    db,
    channel,
    from,
    context.conv,
    acct,
    String(product.sku),
  );
}

// Retorna true sempre que a conversa pertence ao catálogo. Isso impede que o
// mesmo texto continue para os detectores do Mega Sorgo.
export async function routeCatalogText(
  db: Db,
  channel: Json,
  from: string,
  content: string,
  acct?: CwAcct,
): Promise<boolean> {
  const context = await catalogContext(db, channel, from);
  if (!context.active) return false;
  if (isPrecoIntent(content)) {
    await sendSelectedProductPrice(db, channel, from, context, acct);
  }
  return true;
}

export async function sendCatalogJourneyReminder(
  db: Db,
  channel: Json,
  from: string,
  acct?: CwAcct,
): Promise<void> {
  const context = await catalogContext(db, channel, from);
  await sendText(
    db,
    channel,
    from,
    context.conv,
    acct,
    "Esta conversa está no catálogo. Use as opções do produto ou encerre o catálogo antes de abrir o funil Mega Sorgo.",
  );
}

export async function leaveCatalogJourney(
  db: Db,
  channel: Json,
  from: string,
  acct?: CwAcct,
): Promise<void> {
  const context = await catalogContext(db, channel, from);
  if (!context.conv) return;
  await setNavState(db, context.conv, {
    journey: "mega_sorgo",
    level: "root",
    selected_group_slug: null,
    selected_category_id: null,
    selected_product_id: null,
  });
  await db.from("leads_qualification").update({
    qualification_stage: "cancelled",
  })
    .eq("conversation_id", context.conv.id)
    .neq("qualification_stage", "complete");
  await sendText(
    db,
    channel,
    from,
    context.conv,
    acct,
    "Catálogo encerrado. A conversa voltou ao atendimento do Mega Sorgo.",
  );
}

// Qualificação progressiva (dispara na ação "Solicitar orçamento"): objetivo (lista) ->
// região (texto livre) -> hectares (texto livre) -> plantio (texto livre) -> cria quotes +
// avisa o cliente + registra nota pro consultor. Uma qualificação ativa por conversa —
// pedir orçamento de outro produto no meio do fluxo reinicia com o produto novo.
async function startQualification(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  sku: string,
  productName: string,
): Promise<void> {
  if (!conv) {
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Pra montar seu orçamento preciso retomar a conversa — manda um oi que eu te ajudo.",
    );
    return;
  }
  const { data: product } = await db.from("products").select("id").eq(
    "sku",
    sku,
  ).maybeSingle();
  if (!product) {
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Produto não encontrado pra orçamento.",
    );
    return;
  }
  await db.from("leads_qualification").upsert({
    conversation_id: conv.id,
    product_id: product.id as string,
    objective: null,
    objective_code: null,
    region: null,
    hectares: null,
    planting_date_label: null,
    qualification_stage: "awaiting_objective",
  }, { onConflict: "conversation_id" });

  const rows: HybridListRow[] = QUALIFICATION_OBJECTIVES.map((o) => ({
    id: `quali_obj_${o.code}`,
    title: o.label,
  }));
  await sendList(
    db,
    channel,
    from,
    conv,
    acct,
    `Combinado! Pra te passar o orçamento certo de *${productName}*, qual é o seu objetivo?`,
    [{ title: "Objetivo", rows }],
    "Escolher objetivo",
  );
}

async function handleQualificationObjective(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef | null,
  acct: CwAcct | undefined,
  code: string,
): Promise<void> {
  if (!conv) return;
  const objective = QUALIFICATION_OBJECTIVES.find((o) => o.code === code);
  if (!objective) return;
  const { data: updated } = await db.from("leads_qualification")
    .update({
      objective_code: code,
      objective: objective.label,
      qualification_stage: "awaiting_region",
    })
    .eq("conversation_id", conv.id).eq(
      "qualification_stage",
      "awaiting_objective",
    )
    .select("id").maybeSingle();
  if (!updated) return; // fluxo já avançou ou expirou — evita pergunta fora de ordem
  await sendText(
    db,
    channel,
    from,
    conv,
    acct,
    "Show. Qual sua cidade e estado? (ex: Cascavel-PR)",
  );
}

// Intercepta texto livre quando a conversa está no meio da qualificação. Retorna true se
// consumiu a mensagem (o webhook não deve rodar detecção de intenção por cima dela).
export async function handleQualificationReply(
  db: Db,
  channel: Json,
  from: string,
  content: string,
  acct?: CwAcct,
): Promise<boolean> {
  const conv = await resolveConversation(db, channel, from);
  if (!conv) return false;
  const { data: state, error: stateError } = await db.from("catalog_nav_state")
    .select("journey")
    .eq("conversation_id", conv.id).maybeSingle();
  if (stateError) {
    throw new Error(`falha ao ler jornada do catalogo: ${stateError.message}`);
  }
  if (state?.journey !== "catalogo") return false;
  const { data: lead } = await db.from("leads_qualification")
    .select("id,product_id,objective,qualification_stage")
    .eq("conversation_id", conv.id)
    .in("qualification_stage", [
      "awaiting_region",
      "awaiting_hectares",
      "awaiting_date",
    ])
    .maybeSingle();
  if (!lead) return false;
  const text = (content ?? "").trim();
  if (!text) return false;

  if (lead.qualification_stage === "awaiting_region") {
    await db.from("leads_qualification").update({
      region: text,
      qualification_stage: "awaiting_hectares",
    })
      .eq("id", lead.id);
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Quantos hectares você pretende plantar? (só o número, ex: 40)",
    );
    return true;
  }
  if (lead.qualification_stage === "awaiting_hectares") {
    const parsed = Number(text.replace(",", ".").replace(/[^\d.]/g, ""));
    if (!parsed || Number.isNaN(parsed)) {
      await sendText(
        db,
        channel,
        from,
        conv,
        acct,
        "Não entendi — manda só o número de hectares (ex: 40).",
      );
      return true;
    }
    await db.from("leads_qualification").update({
      hectares: parsed,
      qualification_stage: "awaiting_date",
    })
      .eq("id", lead.id);
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Última: pra quando está previsto o plantio? (ex: setembro, próxima safra, já plantei)",
    );
    return true;
  }
  if (lead.qualification_stage === "awaiting_date") {
    await db.from("leads_qualification").update({
      planting_date_label: text,
      qualification_stage: "complete",
    })
      .eq("id", lead.id);
    await finalizeQualification(
      db,
      channel,
      from,
      conv,
      acct,
      lead.id as string,
    );
    return true;
  }
  return false;
}

async function finalizeQualification(
  db: Db,
  channel: Json,
  from: string,
  conv: ConvRef,
  acct: CwAcct | undefined,
  leadId: string,
): Promise<void> {
  const { data: lead } = await db.from("leads_qualification")
    .select("product_id,objective,region,hectares,planting_date_label")
    .eq("id", leadId).maybeSingle();
  if (!lead) return;
  const { data: product } = await db.from("products").select("name")
    .eq("id", lead.product_id).maybeSingle();
  const productName = (product?.name as string) ?? "produto";

  const { data: quote } = await db.from("quotes").insert({
    conversation_id: conv.id,
    product_id: lead.product_id,
    lead_qualification_id: leadId,
    stage: "orcamento_solicitado",
  }).select("id").maybeSingle();

  await sendText(
    db,
    channel,
    from,
    conv,
    acct,
    `Perfeito! Já registrei seu pedido de orçamento de *${productName}*:\n\n` +
      `📍 Objetivo: ${lead.objective}\n📍 Local: ${lead.region}\n📍 Área: ${lead.hectares} hectares\n📍 Plantio: ${lead.planting_date_label}\n\n` +
      `Um consultor Campo Soberano confirma preço, frete e disponibilidade e volta aqui com a proposta. 🙂`,
  );

  if (conv.chatwoot_conversation_id) {
    try {
      await createConversationMessage(
        conv.chatwoot_conversation_id,
        {
          content:
            `💰 Novo orçamento pelo catálogo (${quote?.id ?? "sem id"})\n` +
            `Produto: ${productName}\nObjetivo: ${lead.objective}\nLocal: ${lead.region}\n` +
            `Área: ${lead.hectares} hectares\nPlantio: ${lead.planting_date_label}\n\n` +
            `Confirmar preço/frete/disponibilidade e enviar proposta.`,
          messageType: "outgoing",
          private: true,
        },
        acct,
      );
    } catch (e) {
      console.warn(
        "catalog: nota privada orçamento falhou",
        String(e).slice(0, 150),
      );
    }
  }
}

export async function handleCatalogClick(
  db: Db,
  channel: Json,
  from: string,
  id: string,
  acct?: CwAcct,
): Promise<void> {
  const context = await catalogContext(db, channel, from);
  const conv = context.conv;
  if (!context.active) {
    await sendText(
      db,
      channel,
      from,
      conv,
      acct,
      "Este catálogo foi encerrado. Peça ao atendente para usar “Abrir Catálogo” novamente.",
    );
    return;
  }
  await pauseFunil(conv, "catalog");

  if (id.startsWith("pg_cat_")) {
    const m = /^pg_cat_(.+)_more_(\d+)$/.exec(id);
    if (m) {
      await sendCategoryList(db, channel, from, conv, acct, m[1], Number(m[2]));
    }
    return;
  }
  if (id.startsWith("pg_prod_")) {
    const m = /^pg_prod_(.+)_more_(\d+)$/.exec(id);
    if (m) {
      await sendProductList(db, channel, from, conv, acct, m[1], Number(m[2]));
    }
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
  if (id.startsWith("quali_obj_")) {
    await handleQualificationObjective(
      db,
      channel,
      from,
      conv,
      acct,
      id.slice("quali_obj_".length),
    );
    return;
  }
  console.warn("catalog: clique sem handler", id);
}
