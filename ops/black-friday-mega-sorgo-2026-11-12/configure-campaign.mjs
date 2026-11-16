import { readFile } from "node:fs/promises";
import { loadEnv } from "file:///E:/Projetos_Novos/evohub/ops/prepare-isca-campaign.mjs";

const campaignId = "black-friday-mega-sorgo-5895-2026-11-12";
const env = await loadEnv("E:/Projetos_Novos/evohub");
const base = String(env.SUPABASE_URL).replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Accept-Profile": "public" };
const urlFor = (path) => `${base}${path}`;
async function request(path, options = {}) {
  const response = await fetch(urlFor(path), { ...options, headers: { ...headers, ...(options.headers ?? {}) }, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} at ${path}: ${text.slice(0, 200)}`);
  return { response, text };
}
const queue = JSON.parse((await request(`/rest/v1/campaign_queue?campaign_id=eq.${campaignId}&select=status&limit=1000`)).text);
const statuses = {};
for (const row of queue) statuses[row.status] = (statuses[row.status] || 0) + 1;
if (queue.length !== 641 || statuses.sent !== 13 || statuses.paused !== 628 || Object.keys(statuses).length !== 2) {
  throw new Error(`Estado da fila mudou; configuração cancelada: ${JSON.stringify(statuses)}`);
}
const configPath = "/storage/v1/object/soberano-config/campaigns.json";
const current = await request(configPath);
const state = JSON.parse(current.text);
const campaign = (state.campaigns || []).find((item) => item.id === campaignId);
if (!campaign) throw new Error("Campanha Black Friday ausente em campaigns.json");
const oldStep = campaign.flow?.steps?.find((step) => step.id === campaign.flow?.startId);
if (oldStep?.kind !== "text") throw new Error(`A configuração ativa mudou para ${oldStep?.kind ?? "sem etapa"}; revisão manual necessária`);
const expectedPace = { capInicial: 50, capIncremento: 10, capMaximo: 641, horaInicio: 7, horaFim: 19 };
for (const [field, expected] of Object.entries(expectedPace)) {
  if (campaign.pace?.[field] !== expected) throw new Error(`Ritmo inesperado em ${field}`);
}
const assetFile = new URL("./asset-urls.json", import.meta.url);
const assets = JSON.parse(await readFile(assetFile, "utf8"));
if (assets.length !== 3 || assets.some((asset) => !/^https:\/\//.test(asset.url))) throw new Error("Lista de artes inválida");
const buttons = [
  { id: "bf_consultar_desconto", title: "Consultar desconto" },
  { id: "bf_tenho_duvidas", title: "Tenho dúvidas" },
  { id: "bf_deixar_depois", title: "Deixar para depois" },
];
campaign.flow = {
  uazapiOnly: true,
  startId: "bf_oferta",
  steps: [
    {
      id: "bf_oferta",
      kind: "buttons",
      text: "Black Friday Mega Sorgo Santa Elisa 🌱 Safra 27: sementes novas e até 30% de desconto. A condição varia conforme sua área de plantio. Escolha uma opção abaixo e consulto para você.",
      imageUrls: assets.map((asset) => asset.url),
      buttons,
      branches: {
        bf_consultar_desconto: "bf_area",
        bf_tenho_duvidas: "bf_duvida",
        bf_deixar_depois: "bf_fim",
      },
      fallbackNext: "bf_area",
    },
    {
      id: "bf_area",
      kind: "text",
      text: "Perfeito! Qual é a sua área de plantio em hectares? Com essa informação eu consulto o valor e a condição certinhos para você. 🌱",
      pedirHumano: true,
      handoffContexto: { campanha: campaignId, resposta: "consultar_desconto" },
      next: "bf_fim",
    },
    {
      id: "bf_duvida",
      kind: "text",
      text: "Claro! Pode escrever sua dúvida por aqui, e o Cícero vai te ajudar a consultar a condição para sua área. 😊",
      pedirHumano: true,
      handoffContexto: { campanha: campaignId, resposta: "duvida" },
      next: "bf_fim",
    },
    { id: "bf_fim", kind: "end" },
  ],
};
campaign.pace = expectedPace;
campaign.paceStartAt = "2026-11-13T10:00:00.000Z";
const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
const backupPath = `/storage/v1/object/soberano-config/backups/campaigns-before-bf-rotation-${timestamp}.json`;
const backup = await fetch(urlFor(backupPath), {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json", "x-upsert": "false" },
  body: current.text,
  signal: AbortSignal.timeout(30000),
});
if (!backup.ok) throw new Error(`Backup HTTP ${backup.status}; campaigns.json não alterado`);
const write = await fetch(urlFor(configPath), {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
  body: JSON.stringify(state),
  signal: AbortSignal.timeout(30000),
});
if (!write.ok) throw new Error(`Gravação da campanha HTTP ${write.status}`);
const updated = JSON.parse((await request(configPath)).text);
const saved = updated.campaigns.find((item) => item.id === campaignId);
const savedStep = saved?.flow?.steps?.find((step) => step.id === saved?.flow?.startId);
if (savedStep?.kind !== "buttons" || savedStep.imageUrls?.length !== 3 || savedStep.buttons?.length !== 3 || saved.flow?.uazapiOnly !== true || saved.paceStartAt !== "2026-11-13T10:00:00.000Z") {
  throw new Error("A verificação pós-gravação falhou; fila segue pausada");
}
console.log(JSON.stringify({ campaignId, queueStatuses: statuses, stepKind: savedStep.kind, imageCount: savedStep.imageUrls.length, buttons: savedStep.buttons.map((button) => button.title), uazapiOnly: saved.flow.uazapiOnly, pace: saved.pace, startsAt: saved.paceStartAt, backupPath }));
