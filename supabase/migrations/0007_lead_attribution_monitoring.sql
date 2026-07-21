-- Rastreabilidade operacional de leads por canal, numero receptor e criativo.
alter table channels add column if not exists owner_name text;
alter table channels add column if not exists owner_identifier text;

alter table conversations add column if not exists source_channel_name text;
alter table conversations add column if not exists source_channel_type text;
alter table conversations add column if not exists source_number text;
alter table conversations add column if not exists source_owner_name text;
alter table conversations add column if not exists lead_platform_id text;
alter table conversations add column if not exists ad_id text;
alter table conversations add column if not exists ad_name text;
alter table conversations add column if not exists campaign_id text;
alter table conversations add column if not exists campaign_name text;
alter table conversations add column if not exists creative_id text;
alter table conversations add column if not exists creative_name text;
alter table conversations add column if not exists source_url text;
alter table conversations add column if not exists ctwa_clid text;
alter table conversations add column if not exists attribution jsonb not null default '{}'::jsonb;

create index if not exists idx_conv_source_number on conversations(source_number);
create index if not exists idx_conv_ad_id on conversations(ad_id) where ad_id is not null;
create index if not exists idx_conv_creative_id on conversations(creative_id) where creative_id is not null;
create index if not exists idx_conv_campaign_id on conversations(campaign_id) where campaign_id is not null;

-- Completa o historico existente sem alterar a identidade/conversa original.
update conversations c
set
  source_channel_name = coalesce(c.source_channel_name, ch.name),
  source_channel_type = coalesce(c.source_channel_type, ch.type::text),
  source_number = coalesce(c.source_number, ch.phone_number, ch.display_name, ch.page_id, ch.ig_id, ch.name),
  source_owner_name = coalesce(c.source_owner_name, ch.owner_name),
  lead_platform_id = coalesce(c.lead_platform_id, ct.external_contact_id),
  ad_id = coalesce(c.ad_id, c.referral->>'ad_id', c.referral->>'source_id', c.referral->'externalAdReply'->>'source_id'),
  ad_name = coalesce(c.ad_name, c.referral->>'ad_name', c.referral->>'headline', c.referral->'externalAdReply'->>'headline'),
  campaign_id = coalesce(c.campaign_id, c.referral->>'campaign_id'),
  campaign_name = coalesce(c.campaign_name, c.referral->>'campaign_name'),
  creative_id = coalesce(c.creative_id, c.referral->>'creative_id', c.referral->'externalAdReply'->>'creative_id'),
  creative_name = coalesce(c.creative_name, c.referral->>'creative_name', c.referral->'externalAdReply'->>'body'),
  source_url = coalesce(c.source_url, c.referral->>'source_url', c.referral->'externalAdReply'->>'source_url'),
  ctwa_clid = coalesce(c.ctwa_clid, c.referral->>'ctwa_clid'),
  attribution = case
    when c.attribution = '{}'::jsonb and c.referral is not null then c.referral
    else c.attribution
  end
from channels ch, contacts ct
where c.channel_id = ch.id and c.contact_id = ct.id;

update contacts ct
set attributes = coalesce(ct.attributes, '{}'::jsonb) || jsonb_build_object(
  'platform_id', ct.external_contact_id,
  'channel_id', ch.id,
  'channel_name', ch.name,
  'channel_type', ch.type::text,
  'source_number', coalesce(ch.phone_number, ch.display_name, ch.page_id, ch.ig_id, ch.name),
  'source_owner_name', ch.owner_name,
  'phone_availability', case when ch.type::text = 'whatsapp' then 'available' else 'not_provided_by_meta' end
)
from channels ch
where ct.channel_id = ch.id;

insert into clientes (phone, customer_id, source_number, lead_name, enrich_status, raw)
select phone, customer_id, source_number, lead_name, 'pending', raw
from (
  select distinct on (regexp_replace(coalesce(ct.phone, ct.external_contact_id), E'\\D', '', 'g'))
    regexp_replace(coalesce(ct.phone, ct.external_contact_id), E'\\D', '', 'g') as phone,
    ct.customer_id,
    coalesce(ch.phone_number, ch.display_name, ch.name) as source_number,
    ct.name as lead_name,
    jsonb_build_object('backfilled_from_contact', ct.id, 'channel_id', ch.id) as raw
  from contacts ct
  join channels ch on ch.id = ct.channel_id
  where ch.type::text = 'whatsapp'
    and regexp_replace(coalesce(ct.phone, ct.external_contact_id), E'\\D', '', 'g') ~ '^[0-9]{10,15}$'
  order by regexp_replace(coalesce(ct.phone, ct.external_contact_id), E'\\D', '', 'g'), ct.last_seen_at desc
) latest
on conflict (phone) do update set
  customer_id = coalesce(clientes.customer_id, excluded.customer_id),
  source_number = coalesce(clientes.source_number, excluded.source_number),
  lead_name = coalesce(clientes.lead_name, excluded.lead_name),
  updated_at = now();
