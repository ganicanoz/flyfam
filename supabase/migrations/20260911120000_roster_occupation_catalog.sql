-- Roster occupation / duty code catalog (admin-editable, app reads published snapshot).
-- Save = draft table; Deploy = bump published_version + published_payload (no app store rebuild).

create table if not exists public.roster_occupation_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  airline_icao text not null default '',
  category text not null default 'other',
  label_tr text not null,
  label_en text not null,
  description_tr text not null default '',
  description_en text not null default '',
  card_accent text not null default 'other',
  calendar_mark text not null default 'none',
  special_notes text not null default '',
  sort_order int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint roster_occupation_codes_code_airline_uidx unique (code, airline_icao),
  constraint roster_occupation_codes_category_chk check (
    category in ('standby','off','leave','training','office','meeting','simulator','other','flight')
  ),
  constraint roster_occupation_codes_accent_chk check (
    card_accent in ('flight','standby','off','leave','training','office','meeting','simulator','other')
  ),
  constraint roster_occupation_codes_cal_chk check (
    calendar_mark in ('flight_dot','standby_bar','off_bar','none')
  )
);

create index if not exists roster_occupation_codes_airline_idx
  on public.roster_occupation_codes (airline_icao);
create index if not exists roster_occupation_codes_category_idx
  on public.roster_occupation_codes (category);

create table if not exists public.roster_occupation_catalog_meta (
  id int primary key default 1 check (id = 1),
  published_version int not null default 0,
  published_at timestamptz,
  published_payload jsonb not null default '[]'::jsonb,
  draft_updated_at timestamptz
);

insert into public.roster_occupation_catalog_meta (id, published_version, published_payload)
values (1, 0, '[]'::jsonb)
on conflict (id) do nothing;

alter table public.roster_occupation_codes enable row level security;
alter table public.roster_occupation_catalog_meta enable row level security;

-- Clients read only the published snapshot (not draft rows).
drop policy if exists roster_occupation_catalog_meta_select_authenticated on public.roster_occupation_catalog_meta;
create policy roster_occupation_catalog_meta_select_authenticated
  on public.roster_occupation_catalog_meta
  for select
  to authenticated
  using (true);

-- Draft table: no direct client access (admin via service role / edge).
revoke all on public.roster_occupation_codes from anon, authenticated;
grant select on public.roster_occupation_catalog_meta to authenticated;
grant select on public.roster_occupation_catalog_meta to anon;

insert into public.roster_occupation_codes (
  code, airline_icao, category, label_tr, label_en,
  description_tr, description_en, card_accent, calendar_mark, special_notes, sort_order, active
) values
  ('STBY', 'PGT', 'standby', 'Nöbet', 'Standby', 'Standby', 'Standby', 'standby', 'standby_bar', 'Ev standby; STBY* varyantları', 100, true),
  ('STBY1', 'PGT', 'standby', 'Ev standby', 'Home Standby', 'Home Standby', 'Home Standby', 'standby', 'standby_bar', '', 101, true),
  ('STBY2', 'PGT', 'standby', 'Ev standby', 'Home Standby', 'Home Standby', 'Home Standby', 'standby', 'standby_bar', '', 102, true),
  ('STBYA', 'PGT', 'standby', 'Ev standby', 'Home Standby', 'Home Standby', 'Home Standby', 'standby', 'standby_bar', '', 103, true),
  ('STBYB', 'PGT', 'standby', 'Ev standby', 'Home Standby', 'Home Standby', 'Home Standby', 'standby', 'standby_bar', '', 104, true),
  ('STBYC', 'PGT', 'standby', 'Ev standby', 'Home Standby', 'Home Standby', 'Home Standby', 'standby', 'standby_bar', '', 105, true),
  ('SB', 'PGT', 'standby', 'Nöbet', 'Standby', 'Standby', 'Standby', 'standby', 'standby_bar', 'Meydan standby', 106, true),
  ('SB1', 'PGT', 'standby', 'Nöbet', 'Airport Standby', 'Airport Standby', 'Airport Standby', 'standby', 'standby_bar', '', 107, true),
  ('SB2', 'PGT', 'standby', 'Nöbet', 'Airport Standby', 'Airport Standby', 'Airport Standby', 'standby', 'standby_bar', '', 108, true),
  ('SB3', 'PGT', 'standby', 'Nöbet', 'Airport Standby', 'Airport Standby', 'Airport Standby', 'standby', 'standby_bar', '', 109, true),
  ('SB4', 'PGT', 'standby', 'Nöbet', 'Airport Standby', 'Airport Standby', 'Airport Standby', 'standby', 'standby_bar', '', 110, true),
  ('SB5', 'PGT', 'standby', 'Nöbet', 'Airport Standby', 'Airport Standby', 'Airport Standby', 'standby', 'standby_bar', '', 111, true),
  ('SB6', 'PGT', 'standby', 'Nöbet', 'Airport Standby', 'Airport Standby', 'Airport Standby', 'standby', 'standby_bar', '', 112, true),
  ('SBX', 'PGT', 'standby', 'Nöbet', 'Airport Standby', 'Airport Standby', 'Airport Standby', 'standby', 'standby_bar', '', 113, true),
  ('HSBY', 'THY', 'standby', 'Ev Nöbeti', 'Home Standby', 'Home Standby', 'Home Standby', 'standby', 'standby_bar', '', 114, true),
  ('HSYB', 'THY', 'standby', 'Ev Nöbeti', 'Home Standby', 'Home Standby', 'Home Standby', 'standby', 'standby_bar', 'HSBY yazım varyantı', 115, true),
  ('ASYB', 'THY', 'standby', 'Havalimanı Nöbeti', 'Airport Standby', 'Airport Standby', 'Airport Standby', 'standby', 'standby_bar', '', 116, true),
  ('SBYP', 'IGO', 'standby', 'Ev Nöbeti', 'Home Standby', 'Home Standby', 'Home Standby', 'standby', 'standby_bar', 'IndiGo', 117, true),
  ('ASBD', 'IGO', 'standby', 'İç Hat Havalimanı Nöbeti', 'Standby at Domestic Airport', 'Standby at Domestic Airport', 'Standby at Domestic Airport', 'standby', 'standby_bar', '', 118, true),
  ('SBY', '', 'standby', 'Nöbet', 'Standby', 'Standby', 'Standby', 'standby', 'standby_bar', 'Paylaşılan', 119, true),
  ('RSV', 'PGT', 'standby', 'Rezerv', 'Reserve', 'Reserve', 'Reserve', 'standby', 'standby_bar', 'RSV* sayılır', 120, true),
  ('RZV', 'PGT', 'standby', 'Rezerve', 'Reserve', 'Reserve', 'Reserve', 'standby', 'standby_bar', '', 121, true),
  ('RZVM', 'PGT', 'standby', 'Zorunlu Rezerve', 'Mandatory Reserve', 'Mandatory Reserve', 'Mandatory Reserve', 'standby', 'standby_bar', '', 122, true),
  ('FSF', 'PGT', 'off', 'Boş Gün', 'Fixed Single Off', 'Fixed Single Off', 'Fixed Single Off', 'off', 'off_bar', 'Kart: Boş Gün / restDay', 123, true),
  ('FOF', 'PGT', 'off', 'Boş Gün', 'Fixed Double Off', 'Fixed Double Off', 'Fixed Double Off', 'off', 'off_bar', 'SXS filler olarak da', 124, true),
  ('MSF', 'PGT', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', '', 125, true),
  ('RSF', 'PGT', 'off', 'Boş Gün', 'Requested Single Off', 'Requested Single Off', 'Requested Single Off', 'off', 'off_bar', '', 126, true),
  ('ROF', 'PGT', 'off', 'Boş Gün', 'Requested Double Off', 'Requested Double Off', 'Requested Double Off', 'off', 'off_bar', '', 127, true),
  ('RUF', 'PGT', 'off', 'Telafisiz off', 'Request Unrecovered Single Off', 'Request Unrecovered Single Off', 'Request Unrecovered Single Off', 'off', 'off_bar', '', 128, true),
  ('SOF', 'PGT', 'off', 'Özel Boş Gün', 'Special Day Off', 'Special Day Off', 'Special Day Off', 'off', 'off_bar', '', 129, true),
  ('SOS', 'PGT', 'off', 'Özel izin', 'Special Time Off', 'Special Time Off', 'Special Time Off', 'off', 'off_bar', '', 130, true),
  ('LSF', 'PGT', 'off', 'Lisans off', 'Licence Renewal Off', 'Licence Renewal Off', 'Licence Renewal Off', 'off', 'off_bar', '', 131, true),
  ('OFF', 'SXS', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', 'FHY DOFF→OFF', 132, true),
  ('OFFB', 'SXS', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', '', 133, true),
  ('FREE', 'FHY', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', '', 134, true),
  ('DOFF', 'FHY', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', 'Normalize OFF', 135, true),
  ('RQST', 'FHY', 'off', 'Boş Gün', 'Request Off', 'Request Off', 'Request Off', 'off', 'off_bar', '', 136, true),
  ('OFG', 'IGO', 'off', 'Altın Boş Gün', 'Golden Day Off', 'Golden Day Off', 'Golden Day Off', 'off', 'off_bar', 'UI genelde Boş Gün', 137, true),
  ('IBB', 'THY', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', '', 138, true),
  ('IBE', 'THY', 'off', 'Boş Gün', 'Replaceable Off Day', 'Replaceable Off Day', 'Replaceable Off Day', 'off', 'off_bar', '', 139, true),
  ('IBX', 'THY', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', '', 140, true),
  ('IOZ', 'THY', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', '', 141, true),
  ('IBC', 'THY', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', '', 142, true),
  ('IBY', 'THY', 'off', 'Boş Gün', 'Off Day', 'Off Day', 'Off Day', 'off', 'off_bar', '', 143, true),
  ('TOF', 'SXS', 'off', 'Serbest Zaman', 'Time Off', 'Time Off', 'Time Off', 'off', 'off_bar', 'Saatli blok; tam gün izin değil', 144, true),
  ('III', 'THY', 'leave', 'Yıllık İzin', 'Annual Leave', 'Annual Leave', 'Annual Leave', 'off', 'off_bar', 'restDay değil yıllık izin etiketi', 145, true),
  ('VAV', 'PGT', 'leave', 'Yıllık İzin', 'Annual Leave', 'Annual Leave', 'Annual Leave', 'off', 'off_bar', '', 146, true),
  ('VAC', 'PGT', 'leave', 'Yıllık İzin', 'Annual Leave', 'Annual Leave', 'Annual Leave', 'off', 'off_bar', 'Abbr sözlüğünde Vaccine; ürün yıllık izin', 147, true),
  ('AVAC', 'SXS', 'leave', 'Yıllık İzin', 'Annual Leave', 'Annual Leave', 'Annual Leave', 'off', 'off_bar', '', 148, true),
  ('UPV', 'PGT', 'leave', 'Ücretsiz İzin', 'Unpaid Leave', 'Unpaid Leave', 'Unpaid Leave', 'off', 'off_bar', '', 149, true),
  ('PRV', 'PGT', 'leave', 'Hamilelik', 'Pregnancy Leave', 'Pregnancy Leave', 'Pregnancy Leave', 'off', 'off_bar', '', 150, true),
  ('MAV', 'PGT', 'leave', 'Mazeret', 'Excuse Leave', 'Excuse Leave', 'Excuse Leave', 'off', 'off_bar', '', 151, true),
  ('DEV', 'PGT', 'leave', 'Yas izni', 'Bereavement Leave', 'Bereavement Leave', 'Bereavement Leave', 'off', 'off_bar', '', 152, true),
  ('JSV', 'PGT', 'leave', 'İş arama', 'Job Search Vacation', 'Job Search Vacation', 'Job Search Vacation', 'off', 'off_bar', '', 153, true),
  ('TAV', 'PGT', 'leave', 'Taşınma', 'Moving Leave', 'Moving Leave', 'Moving Leave', 'off', 'off_bar', '', 154, true),
  ('SRH', 'PGT', 'leave', 'Raporlu', 'Sick Report', 'Sick Report', 'Sick Report', 'off', 'off_bar', '', 155, true),
  ('SXH', 'PGT', 'leave', 'Yokluk', 'Absence', 'Absence', 'Absence', 'off', 'off_bar', '', 156, true),
  ('YERDR', 'PGT', 'training', 'Yer Dersi', 'Ground Training', 'Ground Training', 'Ground Training', 'training', 'flight_dot', 'YERDR* ; takvim kırmızı nokta', 157, true),
  ('REC', 'PGT', 'training', 'Recurrent', 'Recurrent Training', 'Recurrent Training', 'Recurrent Training', 'training', 'flight_dot', 'Kartta genelde Görev', 158, true),
  ('TRT', 'PGT', 'training', 'Tip eğitimi', 'Type Rating Training', 'Type Rating Training', 'Type Rating Training', 'training', 'flight_dot', '', 159, true),
  ('KDME', 'PGT', 'training', 'Eğitim', 'Training', 'Training', 'Training', 'training', 'flight_dot', '', 160, true),
  ('FAA', 'PGT', 'training', 'İlk yardım', 'First Aid Training', 'First Aid Training', 'First Aid Training', 'training', 'flight_dot', '', 161, true),
  ('FAT', 'PGT', 'training', 'İlk yardım', 'First Aid', 'First Aid', 'First Aid', 'training', 'flight_dot', '', 162, true),
  ('IKA', 'PGT', 'training', 'IKA eğitimi', 'INSS / KKA Training', 'INSS / KKA Training', 'INSS / KKA Training', 'training', 'flight_dot', '', 163, true),
  ('ISG', 'PGT', 'training', 'İSG eğitimi', 'Work Health and Safety Training', 'Work Health and Safety Training', 'Work Health and Safety Training', 'training', 'flight_dot', '', 164, true),
  ('SMA', 'PGT', 'training', 'Sim eğitimi', 'Simulator Training', 'Simulator Training', 'Simulator Training', 'training', 'flight_dot', 'SIM/IPT yoksa training sınıfı', 165, true),
  ('TRA', 'PGT', 'training', 'Eğitmen', 'Training Instructor', 'Training Instructor', 'Training Instructor', 'training', 'flight_dot', '', 166, true),
  ('SEM', 'PGT', 'training', 'Seminer', 'Seminar', 'Seminar', 'Seminar', 'training', 'flight_dot', '', 167, true),
  ('SNV', 'PGT', 'training', 'Sınav', 'Exam', 'Exam', 'Exam', 'training', 'flight_dot', '', 168, true),
  ('SDM', 'PGT', 'training', 'Toplantı', 'Safety Department Meeting', 'Safety Department Meeting', 'Safety Department Meeting', 'training', 'flight_dot', 'Eğitim sınıfı; SB… kuralına düşmez', 169, true),
  ('MEET', 'PGT', 'meeting', 'Toplantı', 'Meeting', 'Meeting', 'Meeting', 'training', 'flight_dot', '', 170, true),
  ('G3M1', 'PGT', 'meeting', 'Toplantı', 'Meeting', 'Meeting', 'Meeting', 'training', 'flight_dot', '', 171, true),
  ('G3M2', 'PGT', 'meeting', 'Toplantı', 'Meeting', 'Meeting', 'Meeting', 'training', 'flight_dot', '', 172, true),
  ('G4M1', 'PGT', 'meeting', 'Toplantı', 'Meeting', 'Meeting', 'Meeting', 'training', 'flight_dot', '', 173, true),
  ('G4M2', 'PGT', 'meeting', 'Toplantı', 'Meeting', 'Meeting', 'Meeting', 'training', 'flight_dot', '', 174, true),
  ('GMA', 'PGT', 'meeting', 'Toplantı', 'Meeting', 'Meeting', 'Meeting', 'training', 'flight_dot', '', 175, true),
  ('GMO', 'PGT', 'meeting', 'Toplantı', 'Meeting', 'Meeting', 'Meeting', 'training', 'flight_dot', '', 176, true),
  ('GOA', 'PGT', 'office', 'Ofis', 'Office Duty', 'Office Duty', 'Office Duty', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 177, true),
  ('OSA', 'PGT', 'office', 'Ofis', 'Office Support', 'Office Support', 'Office Support', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 178, true),
  ('G3A1', 'PGT', 'office', 'Ofis', 'Office Duty', 'Office Duty', 'Office Duty', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 179, true),
  ('G3A2', 'PGT', 'office', 'Ofis', 'Office Duty', 'Office Duty', 'Office Duty', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 180, true),
  ('G4A1', 'PGT', 'office', 'Ofis', 'Office Duty', 'Office Duty', 'Office Duty', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 181, true),
  ('G4A2', 'PGT', 'office', 'Ofis', 'Office Duty', 'Office Duty', 'Office Duty', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 182, true),
  ('O1A', 'PGT', 'office', 'SAW kontrol 1', 'Saw Office Check-1', 'Saw Office Check-1', 'Saw Office Check-1', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 183, true),
  ('O2A', 'PGT', 'office', 'SAW kontrol 2', 'Saw Office Check-2', 'Saw Office Check-2', 'Saw Office Check-2', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 184, true),
  ('ADB', 'PGT', 'office', 'İzmir kontrol', 'Izmir Office Check', 'Izmir Office Check', 'Izmir Office Check', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 185, true),
  ('AYT', 'PGT', 'office', 'Antalya kontrol', 'Antalya Office Check', 'Antalya Office Check', 'Antalya Office Check', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 186, true),
  ('ECN', 'PGT', 'office', 'Ercan kontrol', 'Ercan Office Check', 'Ercan Office Check', 'Ercan Office Check', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 187, true),
  ('ESB', 'PGT', 'office', 'Esenboğa kontrol', 'Esenboga Office Check', 'Esenboga Office Check', 'Esenboga Office Check', 'office', 'flight_dot', 'Gri kutu + takvim kırmızı', 188, true),
  ('IPT', 'PGT', 'simulator', 'Simülatör', 'Simulator', 'Simulator', 'Simulator', 'simulator', 'off_bar', '*IPT* pattern', 189, true),
  ('SIM8A', 'PGT', 'simulator', 'Sim A (737)', 'PFTC Simulator-A 737', 'PFTC Simulator-A 737', 'PFTC Simulator-A 737', 'simulator', 'off_bar', '*SIM* → Simülatör kart etiketi', 190, true),
  ('SIM8B', 'PGT', 'simulator', 'Sim B (737)', 'PFTC Simulator-B 737', 'PFTC Simulator-B 737', 'PFTC Simulator-B 737', 'simulator', 'off_bar', '', 191, true),
  ('SIM8C', 'PGT', 'simulator', 'Sim C (737)', 'PFTC Simulator-C 737', 'PFTC Simulator-C 737', 'PFTC Simulator-C 737', 'simulator', 'off_bar', '', 192, true),
  ('SIM8D', 'PGT', 'simulator', 'Sim D (737)', 'PFTC Simulator-D 737', 'PFTC Simulator-D 737', 'PFTC Simulator-D 737', 'simulator', 'off_bar', '', 193, true),
  ('SIM8E', 'PGT', 'simulator', 'Sim E (737)', 'PFTC Simulator-E 737', 'PFTC Simulator-E 737', 'PFTC Simulator-E 737', 'simulator', 'off_bar', '', 194, true),
  ('SIM8M', 'PGT', 'simulator', 'Sim M (737)', 'PFTC Simulator-M 737', 'PFTC Simulator-M 737', 'PFTC Simulator-M 737', 'simulator', 'off_bar', '', 195, true),
  ('DUTY', 'PGT', 'other', 'Uçuş görevi', 'Flight duty', 'Flight duty', 'Flight duty', 'other', 'none', '', 196, true),
  ('CFR', 'THY', 'other', 'Potansiyel Görev (CFR)', 'Potential Duty (CFR)', 'Potential Duty (CFR)', 'Potential Duty (CFR)', 'other', 'none', '', 197, true),
  ('DH', '', 'other', 'Deadhead', 'Deadhead', 'Deadhead', 'Deadhead', 'other', 'none', 'Deadhead uçuş', 198, true),
  ('BRA', 'PGT', 'other', 'Brifing', 'Briefing', 'Briefing', 'Briefing', 'other', 'none', '', 199, true),
  ('CD', 'PGT', 'other', 'Görev iptali', 'Cancel Duty', 'Cancel Duty', 'Cancel Duty', 'other', 'none', '', 200, true),
  ('CXL_DUTY', 'PGT', 'other', 'Görev iptali', 'Cancel Duty', 'Cancel Duty', 'Cancel Duty', 'other', 'none', '', 201, true),
  ('DLY', 'PGT', 'other', 'Gecikme', 'Delay', 'Delay', 'Delay', 'other', 'none', '', 202, true),
  ('DOT', 'PGT', 'other', 'Yurt dışı', 'Duty out of Turkey', 'Duty out of Turkey', 'Duty out of Turkey', 'other', 'none', '', 203, true),
  ('HKA', 'PGT', 'other', 'Hastane', 'Hospital Check', 'Hospital Check', 'Hospital Check', 'other', 'none', '', 204, true),
  ('INSTR', 'PGT', 'other', 'Eğitmen', 'Instructor', 'Instructor', 'Instructor', 'other', 'none', '', 205, true),
  ('INTVW', 'PGT', 'other', 'Mülakat', 'Interview', 'Interview', 'Interview', 'other', 'none', '', 206, true),
  ('MCH', 'PGT', 'other', 'Medikal kontrol', 'Medical Check (5 years)', 'Medical Check (5 years)', 'Medical Check (5 years)', 'other', 'none', '', 207, true),
  ('MUA', 'PGT', 'other', 'Sağlık', 'Health Controlling', 'Health Controlling', 'Health Controlling', 'other', 'none', '', 208, true),
  ('ODM', 'PGT', 'other', 'Özel hastane', 'Special Hospital Check', 'Special Hospital Check', 'Special Hospital Check', 'other', 'none', '', 209, true),
  ('PAM', 'PGT', 'other', 'Part-time (MCH)', 'Paid Part Time Period with MCH', 'Paid Part Time Period with MCH', 'Paid Part Time Period with MCH', 'other', 'none', '', 210, true),
  ('PAV', 'PGT', 'other', 'Part-time', 'Paid Part Time Period', 'Paid Part Time Period', 'Paid Part Time Period', 'other', 'none', '', 211, true),
  ('POS', 'PGT', 'other', 'Pozisyonlama', 'Positioning', 'Positioning', 'Positioning', 'other', 'none', '', 212, true),
  ('WAH', 'PGT', 'other', 'İş kazası', 'Work-related Accident', 'Work-related Accident', 'Work-related Accident', 'other', 'none', '', 213, true),
  ('WTA', 'PGT', 'other', 'Mahkeme/Tanıklık', 'Witness/Court', 'Witness/Court', 'Witness/Court', 'other', 'none', '', 214, true)
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

-- Initial publish so apps can load without a manual Deploy click.
update public.roster_occupation_catalog_meta
set
  published_version = 1,
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
