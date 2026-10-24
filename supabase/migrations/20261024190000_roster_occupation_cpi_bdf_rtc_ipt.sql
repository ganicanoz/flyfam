-- CPI* (simülatör), BDF (doğum günü izni), RTC* (Route To Commander), SNV/IPT açıklama güncellemesi.
-- Draft tabloya upsert + yayınlanan katalogu yeniden paketle (sürüm +1).

insert into public.roster_occupation_codes (
  code, airline_icao, category, label_tr, label_en,
  description_tr, description_en, card_accent, calendar_mark, special_notes, sort_order, active
) values
  (
    'CPI', 'PGT', 'simulator', 'CPI', 'CPI',
    'CPI başlığı altında simülatör (CPI1, CPI2, CPIX…)',
    'Simulator under CPI heading (CPI1, CPI2, CPIX…)',
    'simulator', 'off_bar', 'CPI* pattern → sim; flight_number CPI', 215, true
  ),
  (
    'CPI1', 'PGT', 'simulator', 'CPI 1', 'CPI 1',
    'CPI simülatör 1', 'CPI simulator 1',
    'simulator', 'off_bar', '', 216, true
  ),
  (
    'CPI2', 'PGT', 'simulator', 'CPI 2', 'CPI 2',
    'CPI simülatör 2', 'CPI simulator 2',
    'simulator', 'off_bar', '', 217, true
  ),
  (
    'CPIX', 'PGT', 'simulator', 'CPI X', 'CPI X',
    'CPI simülatör X', 'CPI simulator X',
    'simulator', 'off_bar', '', 218, true
  ),
  (
    'BDF', 'PGT', 'off', 'Doğum Günü İzni', 'Birthday Off',
    'Şirketin doğum gününde verdiği izin. Genelde 2 gün: doğum günü + ek off günü.',
    'Company birthday off. Usually 2 days: birthday plus an extra off day.',
    'off', 'off_bar', 'Pasta ikonu (🎂); 2 gün', 219, true
  ),
  (
    'RTC', 'PGT', 'training', 'Route To Commander', 'Route To Commander',
    'Route To Commander (RTC). IPT sim yanında detay olarak da görülebilir.',
    'Route To Commander (RTC). May appear as detail next to IPT simulator.',
    'training', 'flight_dot', 'RTC 1 / RTC 2 varyantları', 220, true
  ),
  (
    'RTC1', 'PGT', 'training', 'Route To Commander 1', 'Route To Commander 1',
    'Route To Commander 1', 'Route To Commander 1',
    'training', 'flight_dot', '', 221, true
  ),
  (
    'RTC2', 'PGT', 'training', 'Route To Commander 2', 'Route To Commander 2',
    'Route To Commander 2', 'Route To Commander 2',
    'training', 'flight_dot', '', 222, true
  ),
  (
    'SNV', 'PGT', 'training', 'Sınav', 'Exam',
    'Ofiste girilen sınav / test', 'Exam or test taken in the office',
    'training', 'flight_dot', '', 168, true
  ),
  (
    'IPT', 'PGT', 'simulator', 'Simülatör', 'Simulator',
    'IPT simülatörü (kodda IPT geçen tüm varyantlar). Yanında RTC 1/2 gibi detay olabilir.',
    'IPT simulator (any code containing IPT). May include RTC 1/2 detail.',
    'simulator', 'off_bar', '*IPT* pattern → sim like SIM', 189, true
  )
on conflict (code, airline_icao) do update set
  category = excluded.category,
  label_tr = excluded.label_tr,
  label_en = excluded.label_en,
  description_tr = excluded.description_tr,
  description_en = excluded.description_en,
  card_accent = excluded.card_accent,
  calendar_mark = excluded.calendar_mark,
  special_notes = excluded.special_notes,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

-- Publish so apps pick up new codes without waiting for a manual Deploy click.
update public.roster_occupation_catalog_meta
set
  published_version = coalesce(published_version, 0) + 1,
  published_at = now(),
  draft_updated_at = now(),
  published_payload = coalesce(
    (
      select jsonb_agg(row_to_json(t)::jsonb order by t.sort_order, t.code)
      from (
        select
          code, airline_icao, category, label_tr, label_en,
          description_tr, description_en, card_accent, calendar_mark,
          special_notes, sort_order, active
        from public.roster_occupation_codes
        where active = true
      ) t
    ),
    '[]'::jsonb
  )
where id = 1;
