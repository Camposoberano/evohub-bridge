import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CAMPAIGN_ID,
  PACE,
  buildCampaign,
  normalizePhones,
  prepareCampaign,
  validateCampaignList,
} from "./prepare-isca-campaign.mjs";

test("normaliza números formatados e remove duplicata", () => {
  assert.deepEqual(normalizePhones("(11) 91036-3320\n5511910363320\n"), ["5511910363320"]);
});

test("rejeita lista que não tem exatamente 1253 números", () => {
  assert.throws(() => validateCampaignList(Array(1252).fill("5511999999999")), /1253/);
});

test("rejeita duplicatas que reduzem a lista", () => {
  const values = Array.from({ length: 1253 }, (_, i) => `5511999${String(i).padStart(6, "0")}`);
  values[1252] = values[0];
  assert.throws(() => validateCampaignList(values), /1253/);
});

test("fluxo manifesto entrega PDF e etiqueta apenas no ramo positivo", () => {
  const campaign = buildCampaign({ channelId: "channel-5895", coverUrl: "https://example/capa.jpg", pdfUrl: "https://example/isca.pdf" });
  assert.equal(campaign.id, CAMPAIGN_ID);
  assert.deepEqual(campaign.pace, PACE);
  const yes = campaign.flow.steps.find((step) => step.id === "quero");
  const no = campaign.flow.steps.find((step) => step.id === "nao");
  assert.deepEqual(yes.labels, ["interesse-silagem"]);
  assert.equal(no.labels, undefined);
  assert.equal(yes.media.type, "document");
});

test("dry-run não chama nenhuma escrita", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isca-campaign-"));
  const csv = join(dir, "phones.csv");
  const phones = Array.from({ length: 1253 }, (_, i) => `551199${String(i).padStart(7, "0")}`);
  await writeFile(csv, `telefone\n${phones.join("\n")}\n`);
  const calls = [];
  const client = {
    select: async (table, query) => {
      calls.push(["select", table, query]);
      if (table === "channels") return [{ id: "channel-5895", name: "5895", type: "whatsapp", status: "active" }];
      return [{ slot: "isca_silagem_capa", url: "https://example/capa.jpg" }, { slot: "isca_silagem", url: "https://example/isca.pdf" }];
    },
    uploadJson: async () => { calls.push(["upload"]); },
    upsert: async () => { calls.push(["upsert"]); },
    downloadJson: async () => { calls.push(["download"]); return null; },
  };
  const output = [];
  const result = await prepareCampaign({ csvPath: csv, client, output: (line) => output.push(line) });
  assert.equal(result.total, 1253);
  assert.equal(calls.some(([kind]) => kind === "upload" || kind === "upsert"), false);
  assert.equal(calls.some(([kind]) => kind === "download"), false);
  assert.deepEqual(JSON.parse(output[0]), {
    campaignId: CAMPAIGN_ID,
    channelId: "channel-5895",
    total: 1253,
    pdfFound: true,
    coverFound: true,
    pace: PACE,
  });
});

test("apply grava manifesto e fila em lotes de até 500 e relê os pendentes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isca-campaign-"));
  const csv = join(dir, "phones.csv");
  const phones = Array.from({ length: 1253 }, (_, i) => `551199${String(i).padStart(7, "0")}`);
  await writeFile(csv, `phone\n${phones.join("\n")}\n`);
  const writes = { upload: 0, batches: [], state: null };
  const client = {
    select: async (table) => {
      if (table === "channels") return [{ id: "channel-5895", name: "5895", type: "whatsapp", status: "active" }];
      if (table === "funnel_media") return [{ slot: "isca_silagem_capa", url: "https://example/capa.jpg" }, { slot: "isca_silagem", url: "https://example/isca.pdf" }];
      if (table === "campaign_queue") return writes.batches.flat().map((row) => ({ status: row.status }));
      throw new Error(`select inesperado: ${table}`);
    },
    downloadJson: async () => ({ campaigns: [], targets: {} }),
    uploadJson: async (_bucket, _file, state) => { writes.upload++; writes.state = state; },
    upsert: async (_table, rows) => { writes.batches.push(rows); },
  };
  const result = await prepareCampaign({ csvPath: csv, apply: true, client, output: () => {} });
  assert.equal(result.queued, 1253);
  assert.equal(writes.upload, 1);
  assert.deepEqual(writes.batches.map((batch) => batch.length), [500, 500, 253]);
  assert.equal(writes.state.campaigns[0].id, CAMPAIGN_ID);
  assert.equal(writes.batches.flat().every((row) => row.status === "pending"), true);
});

test("CSV ausente falha antes de qualquer leitura ou escrita do banco", async () => {
  const calls = [];
  const client = {
    select: async () => { calls.push("select"); return []; },
    downloadJson: async () => { calls.push("download"); return null; },
    uploadJson: async () => { calls.push("upload"); },
    upsert: async () => { calls.push("upsert"); },
  };
  await assert.rejects(
    prepareCampaign({ csvPath: join(tmpdir(), "arquivo-operacional-inexistente.csv"), client }),
    /CSV não encontrado/,
  );
  assert.deepEqual(calls, []);
});
