-- Türkçe kullanıcılar için havalimanı ve şehir adları (TR ve diğer ülkeler için kullanılabilir).
alter table public.airports
  add column if not exists name_tr text,
  add column if not exists city_tr text;

comment on column public.airports.name_tr is 'Havalimanı adı (Türkçe); uygulama dil Türkçe iken gösterilir.';
comment on column public.airports.city_tr is 'Şehir adı (Türkçe); uygulama dil Türkçe iken gösterilir.';

create index if not exists airports_city_tr on public.airports (city_tr) where city_tr is not null;
