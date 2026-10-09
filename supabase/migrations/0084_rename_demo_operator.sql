-- Rename the local/hosted demo tenant that was seeded as "Next to Godliness".
-- That name belongs to a real LAWMA operator. The replacement is fictional.
-- No-op when no matching row exists (fresh databases, or tenants already renamed).
-- Does not insert operators. Migration 0069 is left unchanged; dumpsites stay
-- attached by operator_id.

update public.operators as operator
set
  name = 'Demo Waste Co (Fictional)',
  brand_name = 'Demo Waste Co (Fictional)',
  lawma_reference = case
    when operator.lawma_reference in ('LAWMA-PSP-SURULERE-007', 'LAWMA-PSP-SURULERE-7')
      then 'DEMO-FICTIONAL-SURULERE'
    else operator.lawma_reference
  end
where lower(regexp_replace(operator.slug, '[^a-z0-9]', '', 'g')) in (
    'nexttogodliness',
    'nexttogodlinessventures'
  )
  or lower(regexp_replace(operator.name, '[^a-z0-9]', '', 'g')) like '%nexttogodliness%'
  or lower(regexp_replace(coalesce(operator.brand_name, ''), '[^a-z0-9]', '', 'g')) like '%nexttogodliness%';

update public.operators as operator
set slug = 'demo-waste-co'
where operator.id = (
  select candidate.id
  from public.operators as candidate
  where lower(regexp_replace(candidate.slug, '[^a-z0-9]', '', 'g')) in (
    'nexttogodliness',
    'nexttogodlinessventures'
  )
  order by candidate.id
  limit 1
)
and not exists (
  select 1
  from public.operators as taken
  where taken.slug = 'demo-waste-co'
    and taken.id <> operator.id
);
