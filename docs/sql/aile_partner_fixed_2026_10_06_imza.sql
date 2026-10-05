-- Aile planı: 2026-10-06 Salı tam gün yerine yalnız 16:00.
-- O günkü iş notta durur; rozet harfi İ olmaz. Yer adı Acıbadem Hastanesi.
-- Salı sabit işine skipDates ekler; aynı place ile tek seferlik kayıt ekler (idempotent).
-- Çalıştırma: npx supabase db query --linked --agent=no -f docs/sql/aile_partner_fixed_2026_10_06_imza.sql
--            veya: node scripts/aile-apply-oct6-imza.mjs

do $$
declare
  cfg jsonb;
  pf jsonb;
  item jsonb;
  out_arr jsonb := '[]'::jsonb;
  tue jsonb := null;
  place_key text;
  has_imza boolean := false;
  skip jsonb;
  i int;
  n int;
  label_l text;
  ymd text := '2026-10-06';
begin
  select config into cfg from public.admin_planner_state limit 1;
  if cfg is null then
    raise exception 'admin_planner_state.config yok';
  end if;

  pf := coalesce(cfg->'partnerFixed', '[]'::jsonb);
  if jsonb_typeof(pf) <> 'array' then
    raise exception 'partnerFixed dizi değil';
  end if;

  n := jsonb_array_length(pf);
  for i in 0 .. n - 1 loop
    item := pf->i;
    label_l := lower(coalesce(item->>'label', '') || ' ' || coalesce(item->>'short', '') || ' ' || coalesce(item->>'place', ''));

    if (item ? 'weekdays')
       and (item->'weekdays') @> '2'::jsonb
       and (
         label_l like '%altunizade%'
         or label_l like '%acıbadem%'
         or label_l like '%acibadem%'
       )
    then
      tue := item;
      skip := coalesce(item->'skipDates', '[]'::jsonb);
      if jsonb_typeof(skip) <> 'array' then
        skip := '[]'::jsonb;
      end if;
      if not exists (
        select 1 from jsonb_array_elements_text(skip) s where s = ymd
      ) then
        item := jsonb_set(item, '{skipDates}', skip || to_jsonb(ymd));
      end if;
    end if;

    if (item ? 'dates')
       and exists (select 1 from jsonb_array_elements_text(item->'dates') d where d = ymd)
       and (
         label_l like '%imza%'
         or label_l like '%altunizade%'
         or label_l like '%acıbadem%'
         or label_l like '%acibadem%'
         or coalesce(item->>'icon', '') = 'İ'
       )
    then
      has_imza := true;
    end if;

    out_arr := out_arr || jsonb_build_array(item);
  end loop;

  if tue is null then
    raise exception 'Acıbadem/Altunizade Salı partnerFixed kaydı bulunamadı';
  end if;

  place_key := coalesce(tue->>'place', 'altunizade');

  if not has_imza then
    out_arr := out_arr || jsonb_build_array(jsonb_build_object(
      'place', place_key,
      'label', 'Acıbadem Hastanesi',
      'short', 'Acıbadem',
      'start', '16:00',
      'end', '17:00',
      'dates', jsonb_build_array(ymd),
      'skipPublicHolidays', false,
      'note', 'Sözleşme işleri henüz tamamlanmadı; bu gün hastanedeki iş imza (16:00).'
    ));
  end if;

  cfg := jsonb_set(cfg, '{partnerFixed}', out_arr);
  -- istemci migrateConfigInPlace ile aynı kimlik (tekrar yama uygulanmasın)
  if coalesce(cfg->'configMigrations', '[]'::jsonb) @> '"partner_fixed_2026_10_06_imza"'::jsonb then
    null;
  else
    cfg := jsonb_set(
      cfg,
      '{configMigrations}',
      coalesce(cfg->'configMigrations', '[]'::jsonb) || '"partner_fixed_2026_10_06_imza"'::jsonb
    );
  end if;

  update public.admin_planner_state
  set
    config = cfg,
    updated_at = now();

  raise notice 'partnerFixed güncellendi: % Salı skipDates + tek seferlik kayıt (has_imza=%).', ymd, has_imza;
end $$;

-- Hastane işinin görünen adı: Altunizade / imza rozeti → Acıbadem Hastanesi. Adres alanına dokunulmaz.
do $$
declare
  cfg jsonb;
  pf jsonb;
  places jsonb;
  item jsonb;
  p jsonb;
  out_arr jsonb := '[]'::jsonb;
  i int;
  n int;
  blob text;
  k text;
begin
  select config into cfg from public.admin_planner_state limit 1;
  if cfg is null then
    return;
  end if;
  places := coalesce(cfg->'places', '{}'::jsonb);
  if jsonb_typeof(places) = 'object' then
    for k in select jsonb_object_keys(places) loop
      p := places->k;
      blob := lower(coalesce(p->>'label', '') || ' ' || coalesce(p->>'short', ''));
      if blob like '%altunizade%' or blob like '%acıbadem%' or blob like '%acibadem%' then
        p := jsonb_set(p, '{label}', to_jsonb('Acıbadem Hastanesi'::text));
        p := jsonb_set(p, '{short}', to_jsonb('Acıbadem'::text));
        places := jsonb_set(places, array[k], p);
      end if;
    end loop;
    cfg := jsonb_set(cfg, '{places}', places);
  end if;
  pf := coalesce(cfg->'partnerFixed', '[]'::jsonb);
  if jsonb_typeof(pf) = 'array' then
    n := jsonb_array_length(pf);
    for i in 0 .. greatest(n - 1, -1) loop
      item := pf->i;
      blob := lower(coalesce(item->>'label', '') || ' ' || coalesce(item->>'short', '') || ' ' || coalesce(item->>'place', ''));
      if blob like '%altunizade%' or blob like '%acıbadem%' or blob like '%acibadem%' or coalesce(item->>'icon', '') = 'İ' or lower(coalesce(item->>'short', '')) like '%imza%' then
        if blob like '%altunizade%' or blob like '%acıbadem%' or blob like '%acibadem%' then
          item := jsonb_set(item, '{label}', to_jsonb('Acıbadem Hastanesi'::text));
          item := jsonb_set(item, '{short}', to_jsonb('Acıbadem'::text));
          item := item - 'icon';
        end if;
      end if;
      out_arr := out_arr || jsonb_build_array(item);
    end loop;
    cfg := jsonb_set(cfg, '{partnerFixed}', out_arr);
  end if;
  if not (coalesce(cfg->'configMigrations', '[]'::jsonb) @> '"partner_place_acibadem_hastanesi"'::jsonb) then
    cfg := jsonb_set(cfg, '{configMigrations}', coalesce(cfg->'configMigrations', '[]'::jsonb) || '"partner_place_acibadem_hastanesi"'::jsonb);
  end if;
  update public.admin_planner_state set config = cfg, updated_at = now();
end $$;

-- Doğrulama
select
  jsonb_pretty(
    (
      select jsonb_agg(x)
      from jsonb_array_elements(config->'partnerFixed') x
      where
        (x->'skipDates') @> to_jsonb('2026-10-06'::text)
        or (x->'dates') @> to_jsonb('2026-10-06'::text)
        or (
          (x->'weekdays') @> '2'::jsonb
          and lower(coalesce(x->>'label', '')) like '%altunizade%'
        )
    )
  ) as oct6_related
from public.admin_planner_state
limit 1;
