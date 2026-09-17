# FlyFam — Cursor Teknik Devir Günlüğü

Bu dosya, Cursor ve diğer kod ajanlarının mevcut çalışmaları bozmadan devam etmesi için yaşayan teknik kayıttır. Yeni bir kod/dosya değişikliği tamamlandığında aynı formatla alta kayıt eklenmelidir. Gizli anahtar, parola veya kişisel kimlik bilgisi yazılmaz.

## Değişmez koruma kuralları

- Kullanıcının mevcut çalışma ağacı değişiklikleri korunur; kapsam dışı dosyalar geri alınmaz.
- Herkese açık yüzeylerde kişisel ad, kişisel e-posta ve kişisel GitHub kullanıcı adı kullanılmaz.
- Sunucu sırları mobil uygulamaya veya EAS yükleme arşivine dahil edilmez.
- Store ürün kimlikleri, auth callback'leri, migrationlar ve sürüm numaraları kanıt olmadan değiştirilmez.
- Route to Live maddeleri yalnız doğrulama kanıtıyla `OK` yapılır.

## Güncel teknik kayıtlar

### 2026-09-17 — Admin panel mobil + Pages yayın (ui=52)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`, `docs/CURSOR_CHANGE_HANDOFF.md`
- **Amaç:** Telefon/tablet’te kullanılabilir admin; güncel paneli GitHub Pages’e almak.
- **Uygulama:** Hamburger + sol slide menü + scrim; üst bar/form/tablo dokunmatik düzen; UI `52`. Deploy: `Deploy support site` workflow (`support/` + kopyalanan dashboard).
- **Doğrulama:** Kod incelemesi; push sonrası workflow + `?ui=52` cache bust.
- **Koruma:** Admin API / `data-view` ID’leri aynı; masaüstü rail davranışı korunur.

### 2026-09-17 — Roster: belirgin ayırıcı, Bugün, dar liste penceresi

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Takvim–liste geçişini netleştirmek; listede kaybolunca Bugün’e dönmek; ~365 gün FlatList yükünü azaltmak.
- **Uygulama:** `calendarRosterSep` (2px bar + Bugün chip); `listPastDaysBack` (açılış 1 gün geri, chunk +14, cap archive/admin); `onStartReached` / üst scroll ile genişleme; focus’ta reset; takvim gün seçiminde pencere o güne açılır. Takvim mark / archive fetch aynı.
- **Doğrulama:** Kod incelemesi — sep + goToToday + listMinYmd filtresi + maintainVisibleContentPosition.
- **Koruma:** DB/arşiv silinmez; `ROSTER_MAX_DAYS_AHEAD` 30; `calendarDayCardsOnly` aynı.

### 2026-09-17 — Aktivite default rol: tüm kullanıcılar (ui=51)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`
- **Amaç:** Aktivite sayfası açılınca / yüklenince varsayılan görünüm crew değil tüm rolleri kapsasın.
- **Uygulama:** `#activityRole` default `all`; `list_user_activity` fallback `all`; UI `51`.
- **Doğrulama:** Kod incelemesi — select `selected` + JS fallback.
- **Koruma:** Rol filtresi manuel değiştirilebilir; gün aralığı (30) aynı.

### 2026-09-17 — Takvim ↔ roster kart ayırıcısı

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Takvim gün alt çizgileri ile roster kartları arasındaki geçişi netleştirmek; kaydırırken çizgilerin kartlara yapışmasını azaltmak.
- **Uygulama:** `inlineCalendar` alt padding + `calendarRosterDivider` hairline; `rosterContentWrap` üst padding; takvim `overflow:hidden` + zIndex.
- **Doğrulama:** Simulator Program ekranı — takvim altında çizgi/boşluk, scroll’da kartlar çizgiye yapışmıyor.
- **Koruma:** Takvim mark / layover / liste veri mantığı aynı.

### 2026-09-17 — Aktivite zamanları tarayıcı lokalinde (ui=50)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`
- **Amaç:** Aktivite “Son görülme / Son import / Son olaylar” saatlerini admin panelinin açıldığı cihaz saat diliminde göstermek.
- **Uygulama:** `fmtLocalTs` (browser local); ops history UTC `fmtShortTs` aynı kaldı.
- **Doğrulama:** UI `50`.
- **Koruma:** Sıralama ISO timestamp üzerinden; sadece görüntü formatı değişti.

### 2026-09-17 — Admin aktivite grafikleri görünür (ui=49)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`
- **Kök neden:** Ops Console v2 CSS’te `.act-bar` / `.bar-open`… / `.top-screen-bar-*` stilleri düşmüştü; çubuklar yükseklikli ama renksiz/görünmezdi.
- **Uygulama:** Grafik çubuk stilleri geri eklendi; UI `49`.
- **Doğrulama:** Stil sınıfları HTML’deki `act-bar bar-*` ile eşleşiyor.
- **Koruma:** `list_user_activity` API aynı.

### 2026-09-16 — Faz senkronu stale (Nisan ping) düzeltildi

- **Dosyalar:** `supabase/migrations/20260916210000_phase_refresh_ping_from_sql_cron.sql`
- **Kök neden:** `pg_cron` her 2 dk `refresh_flights_api_refresh_phase()` çalıştırıyordu (başarılı); `system_health_pings.phase_refresh` yalnız Edge Function yazıyordu → admin Nisan’dan beri stale.
- **Uygulama:** SQL fonksiyon başarı/hata sonrası `phase_refresh` upsert ediyor. Live’da uygulandı; ping `ok`, ~180 satır.
- **Doğrulama:** `last_success_at` şimdi; `age_min < 1`.
- **Koruma:** Edge Function ping yazmaya devam edebilir (çift yol zararsız). Faz hesap mantığı aynı.

### 2026-09-16 — Admin panel açık gri tema (ui=48)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`
- **Amaç:** Koyu temadaki düşük kontrast / okunaksız alanları düzeltmek; gri–beyaz yüzey, koyu metin.
- **Uygulama:** `:root` light tokens; form/tablo/badge/drawer/palette renkleri; KPI/quick-actions `auto-fit` grid; UI cache `48`.
- **Doğrulama:** `ui=48` redirect; support `adminUi=48`. Fonksiyonel ID/JS dokunulmadı.
- **Koruma:** Admin API/RPC ve `data-view` kimlikleri aynı.

### 2026-09-16 — Moskova yatı: takvim 3 gün, süre = iniş→kalkış

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Takvim çizgisini gidiş–dönüş span’inde tutmak (14–16 = 3 gün); yatı süresi kartında yalnızca meydana iniş ile kalkış arası zamanı göstermek.
- **Uygulama:** `layoverDatesFromWindows` tekrar inclusive. Süre: FR24 landed/takeoff → actual → estimated → scheduled. Ara gün FOF gizleme `layoverInteriorDates` ile.
- **Doğrulama:** PC386/PC387 için blok 14–16; süre ~25sa (takvim günü değil).
- **Koruma:** ≥10 saat layover eşiği aynı.

### 2026-09-16 — Silmede uçulmamış uçuşu arşivleme

- **Dosyalar:** `supabase/migrations/20260916170000_skip_archive_on_unflown_live_delete.sql`
- **Amaç:** Kullanıcı roster’dan sildiğinde / import ile değiştirdiğinde uçulmamış uçuşların `flights_archive`’a yazılmaması; DB yükü ve yeniden import sonrası sahte geçmiş oluşmaması.
- **Uygulama:** `flight_row_was_live_tracked` + `tg_flights_ops_log_bd`: takip edilmemiş flight ve duty/sim silinince arşive insert yok, varsa junk archive silinir. Takip edilmiş uçuş silinince `past_12h_slim_card` kalır. Yeniden roster import yeni live id üretir — beklenen davranış; arşiv eski uçulmamış silmeleri geri getirmez.
- **Doğrulama:** Migration linked DB’ye uygulandı; scheduled satırlar `tracked=false`.
- **Koruma:** Cron `archive_and_cleanup_old_flights` (12h slim) aynı kalır. Uçulmuş kart geçmişi korunur.

### 2026-09-16 — Geçmiş roster: uçulmamış arşiv kartlarını ayıkla

- **Dosyalar:** `supabase/migrations/20260916150000_restore_slim_archive_from_ops_log.sql`, `supabase/migrations/20260916160000_purge_unflown_archive_cards.sql`, `mobile/screens/Roster.tsx`
- **Amaç:** ~12 ay slim archive geçmişini göstermek; kullanıcının roster’dan silip yerine koyduğu / hiç takip edilmeyen (uçulmayan) uçuşları geçmişte tutmamak.
- **Uygulama:** Ops log’dan restore yalnızca uçuş kanıtı olan satırlara (takeoff/first_seen/FR24/ATD-ATA veya landed/en_route…) veya duty/sim’e uygulanır. Kanıtsız scheduled flight arşiv kartları silinir. Client arşivi `crew_id` + `crew_ids.overlaps` ile çeker; liste penceresi arşivle hizalı (~365 gün).
- **Doğrulama:** Purge sonrası Gani geçmiş arşiv ~186 → ~71; leftover scheduled-flight arşiv örnekleri yoklanmalı. Live DB’de migration SQL uygulandı.
- **Koruma:** Gerçekten uçulmuş / canlı takip edilmiş kartlar ve duty_off/sim silinmez. Gelecek cron `past_12h_slim_card` akışı aynı kalır.

### 2026-09-16 — Route to Live kontrol merkezi

- **Dosyalar:** `docs/ROUTE_TO_LIVE.html`, `docs/ADMIN_STATUS_DASHBOARD.html`
- **Amaç:** Yayın hazırlığı, güvenlik, mağaza ve QA işlerini kalıcı bir kontrol listesinde toplamak.
- **Uygulama:** Admin panelinin en son menüsüne `12 · Route to Live` eklendi. Ayrı HTML sayfası iframe ile açılıyor.
- **Davranış:** 11 faz ve numaralı alt maddeler (`0.1`, `0.2`, `1.1`…) bulunur. OK işaretleri ve notlar tarayıcı `localStorage` alanında saklanır. Arama, filtre ve JSON dışa aktarma korunmalıdır.
- **Doğrulama:** Sayfa 55 görev/11 faz ile açıldı; iframe menüsü ve yerel OK kalıcılığı test edildi. Daha sonra eklenen maddeler nedeniyle görev sayısı artabilir.
- **Koruma:** Görev kimliklerini (`id`) gereksiz değiştirme; aksi halde kullanıcının yerel OK/not kayıtları kaybolur.

### 2026-09-16 — Alt madde numaralandırması

- **Dosya:** `docs/ROUTE_TO_LIVE.html`
- **Amaç:** Her işi faz ve sıra numarasıyla izlenebilir yapmak.
- **Uygulama:** Görev başlıkları çalışma anında `faz.sıra` biçiminde üretilir; numara aramada da bulunabilir.
- **Koruma:** Yeni görev eklerken aynı fazdaki sonraki numaraların değişebileceğini dikkate al; kalıcı referans için görünen numara yerine görev `id` değerini kullan.

### 2026-09-16 — EAS gizli dosya sınırı

- **Dosyalar:** `.easignore`, `mobile/.easignore`
- **Route to Live:** `1.1 · Gizli ortam dosyaları build paketinden çıkarıldı` → **OK**.
- **Uygulama:** `.env`, özel anahtar, sertifika, provisioning, keystore ve sunucu servis hesabı dosyaları EAS yükleme kapsamından çıkarıldı.
- **Doğrulama:** Her iki ignore dosyasında kurallar ve `git diff --check` doğrulandı.
- **Koruma:** `mobile/google-services.json` istemci build'i için gereklidir; servis hesabı sanılarak silinmemeli veya ignore edilmemeli.

### 2026-09-16 — Apple Finance karar kapısı

- **Dosya:** `docs/ROUTE_TO_LIVE.html`
- **Durum:** Banka hesabı sahibi, bireysel Account Holder ve sözleşmeyle belirlenen gelir hak sahibi senaryosu Apple Finance'a yazılı olarak soruldu. Talep gönderimi OK; resmî yanıt bekleniyor.
- **Koruma:** Yanıt gelmeden banka, vergi formu, yayıncı kimliği veya hesap transferi konusunda kesin kabul varsayma ve mağaza ayarlarını değiştirme.

### 2026-09-16 — Gizli anahtar envanteri (Route to Live 1.2+)

- **Dosyalar:** `.env`, `mobile/.env`, `mobile/app.config.js`, `mobile/lib/flightApi.ts`, `mobile/lib/flightStatusPoll.ts`, `mobile/lib/aerodataboxHttp.ts`, `mobile/lib/airportBoardCache.ts`, `docs/ROUTE_TO_LIVE.html`
- **Amaç:** Anahtar değerlerini göstermeden rotasyon ve mobil paket sızıntısı riskini belirlemek.
- **Bulgular:** Takip edilen güncel dosyalarda doğrudan Resend, Supabase PAT, Stripe anahtarı veya özel anahtar bloğu bulunmadı. Yerel ortam dosyalarında sunucu sırları mevcut ancak Git tarafından ignore ediliyor.
- **Mobil paket riski:** `airlabsKey` ve `flightradar24Token` Expo `extra` içine yazılıyor; ayrıca RapidAPI anahtarı mobil koddan okunuyor. `supabaseAnonKey` istemci anahtarı olarak beklenen biçimde herkese açıktır ve güvenliği RLS sağlar.
- **Rotasyon:** Açık paylaşılmış Resend anahtarı yenilenmelidir. Supabase service-role/access-token/cron ve uçuş sağlayıcı anahtarları, bağımlılık ve dağıtım planı kurulmadan iptal edilmemelidir.
- **Koruma / geriye uyumluluk:** Uçuş sağlayıcı tokenlarını doğrudan kaldırmak canlı uçuş, airport board ve roster durum akışlarını bozabilir. Önce Edge Function proxy, sonra mobil regresyon testi, sonra anahtar rotasyonu yapılır.
- **Kalan doğrulama:** Git geçmişi, güvenilir bir secret scanner ile değerleri loglamadan ayrıca taranmalıdır.

### 2026-09-16 — Resend anahtar rotasyonu ve e-posta yayın işleri

- **Dosya:** `docs/ROUTE_TO_LIVE.html`
- **SMTP durumu:** Alan adıyla sınırlandırılmış `FlyFam Supabase SMTP Primary 2026-09` anahtarı Supabase özel SMTP yapılandırmasına bağlandı. `auth@flyfamapp.com` göndereniyle gerçek şifre yenileme isteği HTTP 200 aldı ve Resend logunda Primary anahtar kullanımı doğrulandı.
- **Tamamlanan güvenlik işi:** Eski `Onboarding` anahtarı ile iki geçici rotasyon anahtarı kullanıcı onayıyla kalıcı olarak silindi; Resend’de yalnız çalışan Primary anahtarı kaldı. Yerel `.env` içindeki eski `RESEND_API_KEY` değeri boşaltıldı. Primary anahtar değeri kaynak, doküman veya konuşma notlarına yazılmamalı.
- **Kritik kimlik bulgusu:** Auth e-postalarındaki callback bağlantısı kişisel kullanıcı adını içeren GitHub Pages alanına gidiyor. Callback `flyfamapp.com` altına taşınmadan kişisel kimlik temizliği tamamlanmış sayılmaz.
- **Yeni Route maddeleri:** `Auth callback’i kişisel GitHub adresinden taşı` ve `Tüm kullanıcı e-postalarını profesyonel biçimde yenile` eklendi.
- **Şablon kapsamı:** Confirm signup, recovery, invite, magic link ve email change; TR/EN, FlyFam logo/renkleri, mobil/masaüstü, dark mode ve Gmail/Apple Mail/Outlook doğrulaması.
- **Koruma / geriye uyumluluk:** Yeni callback uçtan uca doğrulanmadan eski callback kaldırılmamalı. Resend rotasyonu tamamlandı; Supabase SMTP’deki Primary anahtar korunmalı ve yerel dosyalara geri yazılmamalı.

### 2026-09-16 — Uçuş sağlayıcı anahtarlarını mobil paketten çıkarma (1. aşama)

- **Dosyalar:** `mobile/app.config.js`, `mobile/lib/flightApi.ts`, `mobile/lib/flightStatusPoll.ts`, `mobile/lib/aerodataboxHttp.ts`, `mobile/lib/airportBoardCache.ts`, `mobile/locales/tr.json`, `mobile/locales/en.json`, `docs/ROUTE_TO_LIVE.html`
- **Amaç:** FR24, AirLabs, AeroAPI ve AeroDataBox kimlik bilgilerinin iOS/Android JavaScript paketine gömülmesini engellemek.
- **Uygulama:** Sağlayıcı alanları Expo `extra` bölümünden kaldırıldı. Mobil doğrudan-provider yedekleri anahtarsız/inert bırakıldı. Uçuş numarası ve roster sorgularının birincil yolu mevcut `flight-lookup` Edge Function; hub panolarının mobil tarafı yalnız `hub_airport_board_cache` tablosundan hydrate oluyor. Kaynakta bulunan eski AeroDataBox yedek anahtarı mobil, Edge shared modülleri, bildirim/senkron fonksiyonları ve tanı scriptlerinden kaldırıldı. Kullanıcı mesajları artık mobil `.env` içine token eklenmesini istemiyor.
- **Doğrulama:** Çalışma ağacında bilinen gömülü AeroDataBox anahtarı kalmadı. Üretim secret envanterinde FR24, AirLabs, AeroAPI ve AeroDataBox API Market kayıtları mevcut. `flight-lookup` v94, `check-flight-status-and-notify` v121 ve `sync-hub-airport-boards` v44 üretime deploy edildi. Deploy ısınması sırasında ilk çağrı ağ hatası verdi; kısa yeniden denemede canlı `flight-lookup` beklenen `by_number/info` yanıtını başarıyla döndürdü. Hub cache anonim oturumda görünmedi; migration gereği yalnız authenticated kullanıcı okuyabilir, bu beklenen RLS davranışıdır. Genel TypeScript kontrolü çalıştı ancak bu değişikliklerden bağımsız mevcut router/tip hataları nedeniyle proje genelinde temiz değil; Route to Live `typescript-clean` maddesi açık kalmalı.
- **Koruma / geriye uyumluluk:** `flight-lookup` ve `sync-hub-airport-boards` üretim secret/env durumu ile gerçek cihaz uçuş arama, roster refresh, kuyruk kodu ve hub cache regresyonu doğrulanmadan sağlayıcı panelindeki anahtarları iptal etme. Mobil yerel debug araçları ayrı geliştirme scriptleri olarak kalabilir; üretim uygulamasına tekrar secret bağlama.
- **Route to Live maddesi:** `public-provider-keys` açıklaması ilerleme durumuyla güncellendi; regresyon + üretim secret doğrulaması + sağlayıcı rotasyonu bitmeden OK yapılmadı.

### 2026-09-17 — Uçuş sağlayıcı güvenlik regresyonu

- **Üretim:** Hub pano senkronu güvenli Edge Function üzerinden zorla çalıştırıldı; 12/12 URL tamamlandı, 730 satır yazıldı, erken kesilme ve hata yok.
- **Simülatör:** iPhone 17 Pro üzerinde FlyFam build 44 mevcut oturumla açıldı. Roster yüklendi, “az önce güncellendi” durumu ile gerçekleşen saat/statü kartları görüntülendi. Hub cache dolduktan sonra uygulama yeniden başlatıldı ve açılış/roster akışı hatasız kaldı.
- **RapidAPI:** Doğru kişisel hesap ve varsayılan uygulama kontrol edildi. Authorization sayfası `Authorization Keys (0)` gösteriyor; panelde silinecek/rotate edilecek aktif RapidAPI anahtarı bulunmuyor. Koddan çıkarılan eski anahtar yeniden kullanılmamalı.
- **Kalan:** Native `extra` temizliğinin mağaza paketine yansıması için yeni temiz binary gerekir. Bu binary gerçek iPhone/Android cihazda uçuş arama, roster yenileme, kuyruk kodu ve hub cache akışından geçmeden `public-provider-keys` maddesini OK yapma.

### 2026-09-17 — 1.3.0 (45) sürüm eşlemesi

- **Dosyalar:** `mobile/app.config.js`, `mobile/android/app/build.gradle`, `mobile/ios/FlyFam.xcodeproj/project.pbxproj`, `docs/ROUTE_TO_LIVE.html`
- **Uygulama:** iOS ana hedefi, bildirim uzantısı ve paylaşım uzantısı dahil tüm `CURRENT_PROJECT_VERSION` değerleri 45; Android `versionCode` 45; Expo iOS/Android değerleri 45 yapıldı. Pazarlama sürümü `1.3.0` korunuyor.
- **Koruma:** EAS `appVersionSource` local. Build öncesi dört kaynağın da 45 kaldığını doğrula; submit bu adımın kapsamında değildir.

### 2026-09-17 — Anahtarsız EAS production build 45

- **EAS ortam temizliği:** Production ortamından eski public Aviation Edge, AviationStack, FR24 ve RapidAPI değişkenleri silindi. Preview/development dahil üç ortamda uçuş sağlayıcı isimli `EXPO_PUBLIC_*` değişken kalmadığı değer göstermeden doğrulandı.
- **Buildler:** iOS `c5d67330-54b0-49b7-b342-209d747aff4a` ve Android `9580ecff-cc6c-410d-bd4e-2502dc18b8c4` başarıyla tamamlandı; ikisi de `1.3.0 (45)`. Mağazalara submit edilmedi.
- **Güvenlik uyarısı:** EAS liste komutu plain-text değişkenleri terminal çıktısına yazdı. Çıktıdaki sağlayıcı değerlerini tekrar etme. FR24, AviationStack ve varsa Aviation Edge anahtarları artık rotasyon gerektirir; yenileri yalnız Supabase Edge secrets içine girilmeli, canlı testten sonra eskileri sağlayıcı panelinde iptal edilmeli.
- **Route to Live:** `eas-builds` tamamlandı. Yeni `rotate-flight-provider-secrets` kritik maddesi eklendi. `public-provider-keys` gerçek cihaz regresyonu bitene kadar açık.

## Yeni kayıt şablonu

### YYYY-AA-GG — Kısa başlık

- **Dosyalar:**
- **Amaç:**
- **Uygulama:**
- **Doğrulama:**
- **Koruma / geriye uyumluluk:**
- **Route to Live maddesi:**
## FR24 sunucu anahtarı rotasyonu (17 Eylül 2026)

- FR24 Key Management altında `flyfam-server-2026-09` adlı yeni production token oluşturuldu.
- Token değeri repo, sohbet notu veya `.env` dosyasına yazılmadan doğrudan Supabase Edge Function secret `FR24_API_TOKEN` üzerine kaydedildi.
- Production `flight-lookup` fonksiyonunda `mode: fr24_summary` ile gerçek uçuş sorgusu HTTP 200 döndürdü; FR24 alanları başarıyla geldi.
- Eski FR24 token (`flyfam`) FR24 panelinden iptal edildi; panelde yalnız `flyfam-server-2026-09` kaldı.
- İptal sonrasında production `flight-lookup` / `fr24_summary` tekrar HTTP 200 döndürdü; `fr24Id` ve rota alanları doğrulandı.
- Cursor sonraki çalışmalarda FR24 değerini EAS veya mobil `EXPO_PUBLIC_*` alanlarına geri eklememeli; yalnız `FR24_API_TOKEN` adlı Supabase server secret kullanılmalı.

## AviationStack sunucu anahtarı rotasyonu (17 Eylül 2026)

- AviationStack panelindeki eski anahtar `Reset Key` ile geçersiz kılındı ve yeni anahtar üretildi.
- Yeni değer repo, sohbet notu, EAS veya mobil `.env` içine yazılmadan doğrudan Supabase Edge Function secret `AVIATIONSTACK_API_KEY` üzerine kaydedildi.
- Sağlayıcı panelindeki aylık ücretsiz kota `100/100` dolu olduğundan canlı veri çağrısı bu ay doğrulanamıyor; kota yenilendiğinde ya da plan yükseltildiğinde production `flight-lookup` fallback testi yapılmalı.
- Backend halen AviationStack'i AirLabs/AeroDataBox/AeroAPI sonuçları yetersiz kaldığında server-side fallback olarak kullanıyor. Cursor bu anahtarı mobil `EXPO_PUBLIC_*` alanlarına geri eklememeli.
- `EXPO_PUBLIC_AVIATION_EDGE_API_KEY` adlı Supabase secret envanterde bulunuyor; ancak güncel Edge Function kaynaklarında okunmuyor ve mobil Aviation Edge yolu anahtarsız/inert. Sağlayıcı hesabı doğrulanmadan bu eski kaydı yeniden kullanma veya istemciye taşıma.

## Güvenlik incelemesi bulguları (17 Eylül 2026)

- Yeni API anahtarı veya mobil pakete gömülü yeni sağlayıcı sırrı bulunmadı.
- **Yüksek:** `supabase/migrations/20260826120000_crew_peer_links_rls.sql` içinde belirli kullanıcı UUID'leriyle doğrudan `approved` arkadaşlık kuruluyor. Kişisel kimlik sızıntısı ve normal onay akışını atlayarak roster/uçuş erişimi verme riski var.
- **Orta:** `supabase/migrations/20260906140000_notification_artwork_storage.sql` tüm authenticated kullanıcıların public bildirim görsellerini yazmasına/ezmesine izin veriyor. Yazma yetkisi admin veya service-role sınırına çekilmeli.
- **Orta:** `docs/android-closed-testers.csv` ve `docs/android-closed-testers-comma.txt` gerçek test kullanıcı e-postaları içeriyor. Bu üretilmiş listeler Git takibinden çıkarılmalı ve ignore edilmelidir.
- Cursor bu maddeleri düzeltirken mevcut migration geçmişini geriye dönük bozmak yerine yeni telafi migration'ı kullanmalı; kullanıcı verisini veya mevcut onaylı bağlantıları körlemesine silmemeli.

### Güvenlik bulgularının giderilmesi

- `20260826120000_crew_peer_links_rls.sql` içindeki kişiye özel demo UUID seed'i kaynak koddan kaldırıldı.
- Üretimde daha önce oluşmuş seed bağlantıları silinmeden, yalnız normal onay iş akışları devreye girmeden önceki dağıtım penceresinde oluşturulmuş `approved` kayıtlar `revoked` durumuna alındı. Doğrulama sorgusunda eski onaylı bağlantı sayısı `0` döndü.
- `20260917120000_security_hardening_peer_links_and_artwork.sql` eklendi ve üretimde uygulandı; Supabase migration geçmişine `applied` olarak işlendi.
- Public `notification-artwork` okuması korundu; authenticated insert/update politikaları kaldırıldı. Service-role operasyonları RLS'yi aşarak güvenilir sunucu yüklemelerine devam edebilir. Üretim doğrulamasında güvensiz politika sayısı `0` döndü.
- Android kapalı test kullanıcı listeleri `.gitignore` kapsamına alındı. Dosyalar yerelde korunuyor ancak Git tarafından izlenmiyor; `git ls-files` sonucu boş doğrulandı.
- Bu düzeltmeleri geri alma, kişiye özel UUID seed'i ekleme veya storage yazma yetkisini genel `authenticated` rolüne açma.

## Tam Git secret taraması ve kaynak kimliği temizliği (17 Eylül 2026)

- Homebrew üzerinden Gitleaks 8.30.1 kuruldu. `--all` ile 89 commit tarandı; 22 geçmiş eşleşmesi bulundu ve sınıflandırıldı.
- Geçmiş RapidAPI eşleşmeleri daha önce kaynaklardan kaldırılan değerlerdir; sağlayıcı panelinde aktif Authorization Key bulunmadığı ayrıca doğrulanmıştı. Firebase/GCP istemci anahtarları ayrı `firebase-restrict` maddesinde kısıtlama doğrulaması bekliyor. Supabase anon JWT istemci için yayımlanabilir anahtardır; güvenlik RLS ve server authorization ile sağlanır.
- Güncel diff'in yalnız eklenen satırlarına yapılan Gitleaks taraması sıfır sızıntı döndürdü. Ignore kapsamındaki `.env`, Firebase service-account JSON ve yerel tester listeleri repoya alınmamalıdır.
- `mobile/lib/crewPeerDemo.ts` içindeki şahsi isimler, kullanıcı/crew UUID'leri ve hardcoded karşılıklı demo fallback kaldırıldı. Dosyanın mevcut public API'si korunarak yalnız `get_my_approved_crew_peers` sunucu sonuçları gösteriliyor.
- Mobil admin yetkisi hardcoded e-posta yerine `admin-dashboard` / `check_access` sunucu kontrolüne taşındı. `ADMIN_DASHBOARD_ALLOWED_EMAILS` yalnız Supabase secret olarak kalır. `admin-dashboard`, `admin-panel-login` ve `sync-fr24-usage-metrics` üretime deploy edildi; yetkisiz kontrol HTTP 401 döndürdü.
- Admin panel HTML içindeki kişisel e-posta/session alanı ve backend fallback e-postaları kaldırıldı. Bilinen şahsi ad/e-posta varyasyonları çalışma ağacında sıfır sonuç verdi.
- Genel TypeScript kontrolü mevcut, önceden kayıtlı router/tip sorunları nedeniyle başarısız; bu değişikliklerde yeni raporlanan tip hatası yok. `typescript-clean` Route maddesi açık kalır.
