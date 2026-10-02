# FlyFam — Cursor Teknik Devir Günlüğü

Bu dosya, Cursor ve diğer kod ajanlarının mevcut çalışmaları bozmadan devam etmesi için yaşayan teknik kayıttır. Yeni bir kod/dosya değişikliği tamamlandığında aynı formatla alta kayıt eklenmelidir. Gizli anahtar, parola veya kişisel kimlik bilgisi yazılmaz.

## Değişmez koruma kuralları

- Kullanıcının mevcut çalışma ağacı değişiklikleri korunur; kapsam dışı dosyalar geri alınmaz.
- Herkese açık yüzeylerde kişisel ad, kişisel e-posta ve kişisel GitHub kullanıcı adı kullanılmaz.
- Sunucu sırları mobil uygulamaya veya EAS yükleme arşivine dahil edilmez.
- Store ürün kimlikleri, auth callback'leri, migrationlar ve sürüm numaraları kanıt olmadan değiştirilmez.
- Route to Live maddeleri yalnız doğrulama kanıtıyla `OK` yapılır.

## Güncel teknik kayıtlar

### 2026-10-02 — iOS 1.3.0 (51) EAS build + TestFlight yüklemesi

- **İçerik:** RevenueCat/IAP (diğer oturum), Consent ekranı, sunucu roster import (`b1efbcb`) ve EAS Update kurulumu tek build'de. Sürüm 1.3.0 aynı; build numarası 50 → 51: `app.config.js` (`ios.buildNumber`, `android.versionCode`), `project.pbxproj` `CURRENT_PROJECT_VERSION` (6 satır; uygulama + share extension + notification service hepsi `$(CURRENT_PROJECT_VERSION)` okuyor), `android/app/build.gradle` `versionCode`. Android build alınmadı.
- **EAS ortamı:** `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` production + preview ortamında yoktu (önceki RevenueCat testleri yerel `.env`'li development build'lerdi; `.env` EAS yüklemesine girmez). Yerel `.env`'deki public SDK anahtarı değer yazdırılmadan `sensitive` olarak iki ortama eklendi; varlığı isimle doğrulandı. Anahtarsız build'de satın alma sessizce eski StoreKit yoluna düşerdi.
- **Yükleme arşivi güvenliği:** `eas build:inspect --stage archive` ile kontrol edildi; kök `.easignore`'a `/.local/` (git-ignored ama EAS'e giden, token içeren yerel dosya) ve `/tmp/` (yerel PDF) eklendi. Sonrasında arşivde `.env*`, `.p8`, keystore, PDF yok; `mobile/lib/rosterServerImport.ts`, `mobile/lib/revenueCat.ts`, `_shared/roster-import/*` var.
- **Build:** `2b5d8806-d2e2-4f9e-8b1f-dd5bf005a92a` FINISHED, kanal `production`, runtime `1.3.0`. `eas submit:status`: TestFlight 1.3.0 (51) `processingState: VALID`, iç/dış test `IN_BETA_TESTING`, `easBuildId` bu build. Bilgisayar uykusu sırasında CLI isteği yeniden denediği için aynı içerikli ikinci bir EAS build (`51f6a854…`) da oluştu; kullanılmıyor. Submission kaydı `ERRORED — already submitted` gösteriyor çünkü ilk deneme yüklemeyi tamamlamıştı (TestFlight kaydı aynı submission id'yi taşıyor).
- **Yapılmadı:** App Store Connect taslağına ekleme (Codex'in işi), `Submit for Review`. Sandbox satın alma + restore, StoreKit ürün görünürlüğü ve OTA ilk yayını gerçek cihazda TestFlight build 51 ile yapılmalı.
- **Doğrulama:** `npx tsc --noEmit` OK; `git diff --check` OK; build/submit durumları EAS + App Store Connect API (`eas submit:status`) ile.

### 2026-10-02 — EAS Update (OTA) kuruldu — build 51'den itibaren geçerli

- **Amaç:** JS düzeltmeleri (ekran, akış, istemci mantığı) mağaza build'i olmadan sessizce yayınlansın. Kullanıcı kararı: sunucu import'u + EAS Update birlikte.
- **Dosyalar (yalnız çalışma ağacında):** `mobile/package.json` + `package-lock.json` (`expo-updates ~29.0.20`; lock değişikliği yalnız ekleme/hoist, mevcut sürüm değişmedi), `mobile/ios/Podfile.lock` + `FlyFam.xcodeproj/project.pbxproj` (`pod install`: EXUpdates, EASClient, EXStructuredHeaders, ReachabilitySwift — ekleme), `mobile/ios/Podfile` + `app.config.js` share extension `excludedPackages`'a `expo-eas-client`, `expo-structured-headers` (expo-updates zaten hariçti; uzantıya sızıyorlardı), `mobile/ios/FlyFam/Supporting/Expo.plist` (`EXUpdatesEnabled` true, `EXUpdatesRuntimeVersion` 1.3.0, `EXUpdatesURL`), `mobile/android/app/src/main/AndroidManifest.xml` (ENABLED true, `EXPO_RUNTIME_VERSION`, `EXPO_UPDATE_URL`) + `res/values/strings.xml` (`expo_runtime_version`), `mobile/app.config.js` (`runtimeVersion: '1.3.0'`, `updates.url`, `checkAutomatically: ON_LOAD`, `fallbackToCacheTimeout: 0`), `mobile/eas.json` (kanallar: development / preview / production).
- **Davranış:** Açılışta arka planda kontrol, bekleme yok; indirilen güncelleme bir sonraki soğuk açılışta devreye girer. Sunucu hatası açılışı engellemez (gömülü bundle).
- **Runtime version kuralı (kritik):** Bare projede elle sabit `1.3.0`; üç yer birlikte: `app.config.js` `runtimeVersion`, `Expo.plist` `EXUpdatesRuntimeVersion`, `strings.xml` `expo_runtime_version`. Native bağımlılık/native kod/`pod install` gerektiren her değişiklikte üçü birlikte artırılmalı (ör. `1.3.0-2`); aksi halde OTA eski binary'ye uyumsuz JS gönderebilir. Uygulama sürümü / build numarası değiştirilmedi.
- **Doğrulama:** `npx expo config --type public` runtimeVersion + updates doğru. `pod install` uyarısız (ilk denemedeki share extension modül uyarısı exclude ile giderildi); uzantı xcconfig'inde EXUpdates/EASClient/EXStructuredHeaders yok, ana uygulamada var. Release simülatör build (`xcodebuild`, imzasız) BAŞARILI; `.app` içinde `EXUpdates.bundle/app.manifest` (44 asset) ve doğru `Expo.plist`. Geçici simülatörde açıldı, giriş ekranı geldi; yerel build kanal başlığı taşımadığı için update kontrolü beklenen 400 (`expo-channel-name` gerekli) verdi ve uygulama gömülü bundle ile çalışmaya devam etti (EAS Build kanalı build sırasında ekler). Geçici simülatör silindi. `expo-doctor`: 3 başarısız kontrol önceden de vardı (non-CNG senkron uyarısı, RN Directory, patch sürümleri); expo-updates kaynaklı yok. Android yerelde derlenemedi (Java yok).
- **Commit:** `package-lock.json`, `Podfile.lock`, pbxproj RevenueCat değişiklikleriyle iç içe olduğundan ikisi build 51 ile birlikte tek commit'te (bkz. build 51 kaydı) gönderildi.
- **Yayın komutu (build 51+ mağazadayken):** `cd mobile && npx eas-cli@latest update --channel production --environment production --message "<açıklama>"`. `EXPO_PUBLIC_*` değerleri güncelleme bundle'ına gömülür; EAS `production` ortamında Supabase URL/anon key'in tanımlı olduğu ilk yayından önce (değer yazdırmadan) doğrulanmalı. İlk yayın preview kanalında denenmeli; mümkünse `--rollout-percentage` ile kademeli.
- **Açık:** Build 50 ve öncesi OTA almaz. Android build/OTA denenmedi. İlk gerçek OTA henüz yayınlanmadı. Apple kuralı: OTA yalnız hata düzeltme/küçük JS değişikliği; uygulamanın amacını değiştiren özellik OTA ile verilmemeli.
- **Koruma:** Share extension'da expo-updates ve bağımlılıkları hariç kalmalı. Sunucu import fallback'i (bkz. aşağıdaki kayıt) OTA'dan bağımsız çalışır.

### 2026-10-02 — Roster import sunucuya taşındı (`import-roster`) + zaman dilimi performans düzeltmesi

- **Amaç:** Parser / birleştirme / plan düzeltmeleri yeni build gerektirmeden canlıya çıksın. Mobil yalnız PDF'i (ve varsa cihaz metnini) gönderir; parse + birleştirme + plan + RPC sunucuda çalışır.
- **Dosyalar:** `supabase/functions/_shared/roster-import/run.ts` (yeni; eski `importPdfFlightsViaRpc` gövdesinin birebir taşınması, `beforeImport` / `trackImport` kancaları), `supabase/functions/import-roster/index.ts` (yeni, deploy edildi), `mobile/lib/pdfRosterImport.ts` (`importPdfFlightsViaRpc` artık `runRosterImport` sarmalayıcısı; `flushPendingRosterClear` + istemci aktivite kaydı kancada), `mobile/lib/userActivity.ts` (`appMeta` export), `mobile/lib/rosterServerImport.ts` (yeni), `mobile/lib/rosterPdfParse.ts` (`getAccessTokenForEdgeFunctions` export), `mobile/screens/Roster.tsx`, `mobile/screens/AddFlight.tsx`, `supabase/functions/_shared/roster-pdf/timeAndSchedule.ts`.
- **`import-roster`:** `verify_jwt` açık + `auth.getUser(jwt)`; RPC'ler kullanıcının kendi JWT'siyle (`add_me_to_flight` / `remove_me_from_flight`, RLS aynı). Profil yok / havayolu yok / desteklenmeyen → 400 (`no_crew`, `airline_required`, `airline_unsupported`); parse hatası → 502 `parse_failed`. Birleştirme sırası mobil ile aynı: Edge metni, sonra cihaz metni (SXS'te ikisi de yok). `dry_run` yazmadan satır + plan döner. Aktivite kaydı `server_import: true` + uygulama sürüm bilgisiyle.
- **Mobil:** Roster ve AddFlight önce `importRosterPdfViaServer`; 200 + `ok` dışındaki her durum (ağ, 401 sonrası yenileme başarısız, 4xx/5xx/546, bozuk yanıt) `unavailable` → eski cihaz yolu (`parseRosterPdfFromDevice` + `importPdfFlightsViaRpc`) aynen çalışır. Uyarılar, home base sorusu (sunucu satırlarıyla), takip akışı (eski uçuş onayı, şüpheli PDF raporu) değişmedi. **Uzaktan kapatma:** `import-roster` 503 dönerse tüm istemciler eski yola düşer.
- **Performans (kök neden):** `localDateTimeInTimezoneToUtcIso` her satırda ±1 günü dakika dakika `Intl` ile tarıyordu (27 satırlık THY planı ~8 sn CPU → Edge 546 `WORKER_RESOURCE_LIMIT`; telefonda da yavaşlık). Yeni sürüm aralıktaki saatlik ofsetleri toplayıp aday dakikaları doğruluyor + formatter önbelleği; plan 36 ms.
- **Doğrulama:** Eski/yeni runner eşdeğerliği 6/6 senaryo (RPC kaydı, sorgular, son DB, sonuç birebir). Zaman dilimi: origin/main sürümüyle 5.650 vaka (rastgele, DST geçiş günleri, geçersiz/kenar) 0 fark; çağrı başına ~0,66 ms. Canlı `import-roster` (geçici test kullanıcıları, sonra silindi): yetkisiz 401, profil yok 400, desteklenmeyen 400, küçük gövde 400, THY `dry_run` 200 (~3 sn, 27/27 hazır, çok ayaklı zincir DB düzeltmesiyle aynı, yazma/kayıt yok). Yazma yolu sentetik (var olmayan, ön kontrol edilmiş) Freebird uçuşlarıyla: 2 uçuş doğru UTC saatleriyle oluştu, ekip bağlandı, aktivite `server_import` ile kaydedildi, tekrar import idempotent; temizlik sonrası sentetik uçuş 0. İstemci yardımcı harness 18/18 (200, 0 satır, 401→yenile→tekrar, 401/404/500/502/503/546/400/ağ/bozuk yanıt/sonuçsuz satır/okunamayan PDF/oturum yok → `unavailable`, canlı sentetik import 2). `npx tsc --noEmit` (mobile) 0 hata; `parse-roster-pdf`, `import-roster`, `admin-dashboard` esbuild bundle OK ve yeniden deploy edildi (admin önizlemesi de aynı CPU düzeltmesini aldı).
- **Açık:** Sunucu yolu yalnız bu değişikliği içeren yeni build'lerde devreye girer (eski build'ler cihaz yolunu kullanır; sunucu düzeltmeleri onlara ulaşmaz). EAS Update (JS'in OTA güncellenmesi) henüz kurulmadı — `expo-updates` native bağımlılık + `Podfile.lock` / pbxproj değişikliği ister; IAP çalışması ve inceleme sürecindeki build ile çakışmaması için ayrı karar bekliyor. Sunucu yanıtı commit sonrası kaybolursa istemci cihaz yoluyla tekrar import eder (RPC'ler idempotent; aktivite iki kez kaydedilebilir).
- **Koruma:** Eski cihaz yolu silinmedi, fallback olarak kalmalı. `import-roster` ile mobil birleştirme sırası ve `runRosterImport` gövdesi aynı tutulmalı; parser değişikliği sonrası `parse-roster-pdf`, `import-roster` ve `admin-dashboard` birlikte deploy edilmeli.

### 2026-10-02 — Admin roster PDF incelemesi (pop-up + önizleme + düzeltme) ve admin JWT doğrulama açığı

- **Dosyalar:** `supabase/functions/_shared/roster-import/plan.ts` (yeni, önceki oturumdan), `supabase/functions/_shared/roster-import/merge.ts` (yeni; `mobile/lib/pdfRowMerge.ts` artık yalnız re-export), `supabase/functions/admin-dashboard/{index.ts,rosterReports.ts (yeni)}`, `supabase/functions/sync-fr24-usage-metrics/index.ts`, `supabase/migrations/20261002090000_roster_pdf_report_review.sql`; `docs/ADMIN_STATUS_DASHBOARD.html` = `support/admin/index.html` (ui 62), `support/index.html` (`adminUi` 62)
- **Güvenlik (kritik, canlıda kapatıldı):** `admin-dashboard` (`verify_jwt=false`) JWT'yi yalnız decode edip e-postayı allowlist'te arıyordu; imzasız/sahte token ile admin yetkisi alınabiliyordu. Artık `adminClient.auth.getUser(jwt)` ile Auth sunucusunda doğrulanıyor, `sub` eşleşmesi ve doğrulanmış e-posta kullanılıyor. `sync-fr24-usage-metrics` bearer yolu da aynı şekilde düzeltildi (cron secret yolu aynı).
- **Migration (uygulandı):** `roster_pdf_reports` + `admin_note`, `reviewed_at`, `reviewed_by`, `last_action`; durum `new|reviewed|fixed|dismissed`. `admin_add_crew_to_flight(p_crew_id, …)` / `admin_remove_crew_from_flight(p_crew_id, p_flight_id)`: gövde canlı `add_me_to_flight` / `remove_me_from_flight` ile birebir (canlı tanımlar `pg_get_functiondef` ile karşılaştırıldı), ekip parametreden; yalnız `service_role` execute (anon/authenticated false doğrulandı).
- **Edge aksiyonları (`rosterReports.ts`):** `list_roster_pdf_reports` (durum filtresi, ad/e-posta, `new_count`), `get_roster_pdf_report_url` (5 dk imzalı URL), `preview_roster_pdf_report` (PDF'i bucket'tan indirir → admin JWT'siyle canlı `parse-roster-pdf` → mobil ile aynı birleştirme (SXS'te Edge'e güven) → paylaşılan `buildRosterImportPlan` (profil ICAO + home base) → ekibin aralıktaki DB satırlarıyla fark: ekle / güncelle / aynı, PDF'te olmayan uçuşlar, eksik satırlar, şimdiki ve düzeltme sonrası zincir şüpheleri, `plan_hash`; `new` → `reviewed`), `apply_roster_pdf_report_fix` (planı yeniden hesaplar, `plan_hash` uyuşmazsa 409; seçili anahtarlar `admin_add_crew_to_flight`, seçili ve hâlâ «PDF'te yok» listesindeki uçuşlar `admin_remove_crew_from_flight`; `last_action` + `fixed`), `update_roster_pdf_report` (durum/not). Kullanıcı bildirimi mevcut `send_push_notification` ile.
- **Panel (ui 62):** «PDF incelemeleri» sayfası + nav rozeti; girişte / oturum geri yüklemede yeni rapor varsa pop-up, yenilemede ve 60 sn yoklamada yalnız görülmemişler (sessionStorage). İnceleme: PDF'i aç, fark tablosu (ekle/güncelle varsayılan işaretli, «PDF'te yok» varsayılan işaretsiz), not, İncelendi / Yoksay, onaylı uygula, push metni düzenlenebilir.
- **Doğrulama:** Yerel harness (bundle edilmiş `rosterReports.ts` + service role, geçici test kullanıcısı, gerçek THY PDF'i yalnız Storage'da): 15/15 PASS — liste + e-posta, imzalı URL `%PDF-`, önizleme 27 satır ve düzeltilmiş çok ayaklı rota DB düzeltmesiyle birebir, `new→reviewed`, sentetik (çakışmayan) uçuş «PDF'te yok»ta, yanlış hash 409, boş seçim 400, stale dışı id reddi, kaldırma satırı sildi, `fixed` + not + `last_action`, geçersiz durum 400, bilinmeyen rapor 404; temizlik: test ekibine bağlı uçuş 0, dosya ve kullanıcı silindi. Ekleme yolu gerçek paylaşılan satırlara dokunmamak için canlıda uygulanmadı (aynı RPC seed adımında çalıştı). Canlı: sahte imzalı token `admin-dashboard` ve `sync-fr24-usage-metrics` → 401, token yok → 401, gerçek admin olmayan kullanıcı → 403 (geçerli token doğrulamadan geçiyor). `merge.ts` HEAD mobil dosyasıyla yalnız import yolları + önceki oturumdaki Edge esaslı birleştirme farkı; re-export davranış testi PASS. `npx tsc --noEmit` (mobile) 0 hata; `rosterReports.ts` + `merge.ts` strict tsc OK; esbuild bundle OK. Panel: inline script `node --check` OK, sahte API ile yerel önizleme (pop-up, rozet, detay, uygula yükü doğru). Yayın: origin/main worktree, `git diff --cached --check` + gizlilik taraması temiz, `31610a0`, `deploy-support.yml` başarılı, canlı sayfada ui 62 işaretleri var.
- **Açık:** Gerçek admin oturumuyla canlı panelde uçtan uca deneme yapılmadı (admin parolası yok); ilk gerçek raporda önizleme + uygula izlenmeli. `flights.crew_id → crew_profiles` FK'si `ON DELETE CASCADE`: bir hesabın silinmesi, son yazan o olduğu paylaşılan uçuş satırlarını diğer ekipler için de silebilir (mevcut risk, bu değişiklikle gelmedi). Roster ile ilgili mobil/Edge/migration dosyaları + bu kayıt ayrı worktree'den commit edildi; diğer pencerelerin yerel değişiklikleri (`config.toml`, IAP, aile planı vb.) dahil edilmedi.
- **Koruma:** Admin işlemleri kullanıcının kendi import'uyla aynı RPC kurallarını kullanır; kaldırma yalnız sunucunun yeniden hesapladığı «PDF'te yok» listesinden ve açık seçimle. Mobil import davranışı değişmedi (birleştirme kodu taşındı, içerik aynı).

### 2026-10-01 — Roster import güvenlik ağı: Edge esaslı birleştirme, zincir kontrolü, eski uçuş onayı, PDF hata raporu

- **Dosyalar:** `mobile/lib/pdfRowMerge.ts`, `mobile/lib/pdfRosterImport.ts`, `mobile/lib/rosterPdfReport.ts` (yeni), `mobile/lib/pdfImportAlert.ts`, `mobile/lib/userActivity.ts`, `mobile/screens/Roster.tsx`, `mobile/screens/AddFlight.tsx`, `mobile/locales/{tr,en}.json`; `supabase/migrations/20261001190000_roster_pdf_reports.sql`; Edge `roster-pdf-report` (yeni), `delete-my-account`; `scripts/roster-pdf-reports.mjs` (yeni)
- **Kök risk:** Mağaza uygulaması Edge satırlarını cihazdaki paketlenmiş (eski olabilen) parser çıktısıyla `tarih|uçuş` anahtarıyla birleştiriyor ve aynı anahtarda yerel değeri tercih ediyordu → Edge düzeltmesi tek başına yetmiyor, yeniden import'ta eski tarihli hayalet satırlar ekleniyordu. Yeniden import yanlış tarihteki eski satırı da silmiyordu. Başarısız importlar hiç kaydedilmiyordu.
- **Uygulama:**
  - `mergeTextParseRowsIntoPrimary`: Edge'de uçuş varsa metin parse'ı, Edge'de ±3 gün içinde aynı uçuş + rota olan ayağı başka tarihle ekleyemez; aynı anahtarda Edge alanları korunur (yalnız boş alan doldurulur). Edge'de hiç uçuş yoksa eski davranış. SIM/duty satırları eski davranış.
  - `importPdfFlightsViaRpc` sonucu: `suspectLegs` (`findSuspectRosterLegs`: önceki inişten önce kalkış, 48 saatten kısa arada farklı havalimanından kalkış, negatif / 20 saati aşan süre; yalnız bu import'un uçuşları) ve `staleFlights` (import tarih aralığında, bu PDF'te olmayan, `roster_entry_kind=flight` üyelikler; aynı numara ±3 gün içinde başarısız/eksik satır varsa hariç). `roster_import` olayına `parse_source`, `suspect_n`, `suspect`, `stale_n` eklendi.
  - `runPdfImportFollowUps`: başarı mesajı → şüpheli satır uyarısı (+ «PDF'i FlyFam'e gönder») → «PDF'te olmayan N uçuş, kaldırılsın mı?» (Kalsın varsayılan; Kaldır = `remove_me_from_flight`). `AddFlight` Roster'a geçişi uyarılardan sonra yapar.
  - `showPdfImportAlert`: her hata/bilgi popup'ı `roster_import_issue` olayı yazar (başlık, havayolu, kaynak, satır/başarısız sayısı, Edge ipucu; kişisel veri yok); `pdfUri` verilirse «PDF'i FlyFam'e gönder» düğmesi (Android 3 düğme sınırı içinde).
  - PDF gönderme: açık onay metni (ekip arkadaşı adları dahil, yalnız hata analizi, 30 günde silinir) → Edge `roster-pdf-report` (JWT + `getUser`, `%PDF-` imzası, 1 KB–10 MB, kullanıcı başına 24 saatte 5) → private bucket `roster-pdf-reports/{uid}/{tarih}/{uuid}.pdf` + `roster_pdf_reports` satırı; her yüklemede süresi dolan ≤50 rapor Storage API ile silinir. Tablo RLS açık + anon/authenticated revoke; bucket'ta istemci politikası yok.
  - `delete-my-account`: auth silmeden önce kullanıcının rapor dosyalarını bucket'tan siler (satırlar FK cascade).
  - `scripts/roster-pdf-reports.mjs list|fetch|mark`: service role anahtarı CLI'dan okunur (yazdırılmaz); PDF'ler repo dışına (`~/Downloads/flyfam-roster-reports`) iner.
- **Doğrulama:** esbuild + RN stub ile 14 test: birleştirme (hayalet satır düşer, SIM kalır, Edge değeri korunur, Edge'siz eski davranış, yeni/uzak tarihli uçuş eklenir), zincir (doğru 4 ayaklı rota temiz; eski hatalı DB satırları ve HKG çakışması işaretlenir; süre hatası), sahte istemciyle tam import (eski satır + aralıktaki elle eklenmiş uçuş `staleFlights`'ta; aralık dışı / duty satırı değil; geçmiş temizliği aynı). `npx tsc --noEmit` 0 hata. Migration `db push` OK (mevcut olay tipleri kısıta uyuyordu). Canlı uçtan uca (geçici test kullanıcısı, sentetik PDF): OPTIONS 200, auth'suz 401, PDF olmayan 400, yükleme 200 + satır + birebir dosya, kullanıcı tablo/bucket okuyamıyor, 6. yükleme 429, `delete-my-account` 200 → satır 0 / dosya 0 / kullanıcı silindi. Script `list`/`mark` duman testi OK. `git diff --check` OK.
- **Veri düzeltmesi (kullanıcı onayıyla, PDF GMT tablosuyla doğrulanmış):** İkinci bir THY ekibinin iki dönüş ayağı (yerde konaklama) bir gün ileri alındı; satırlarda başka ekip yoktu, hedef tarihte kayıt yoktu.
- **Açık:** Mobil değişiklikler yeni store build ile çıkar; o zamana kadar THY ekiplerine yeniden import önerilmemeli (eski build hayalet satır ekler) — düzeltmeler DB'den yapılmalı. Salt okunur taramada iki THY ekibinde çakışma kaldı (HKG dönüşü; aynı gün iki ayrı görev) — doğru gün için PDF gerekiyor. Tur/konaklama belirsizliği (aynı gün dönüş gibi görünen konaklama) zincir kontrolüyle yakalanmaz. Süresi dolan rapor temizliği canlıda henüz tetiklenmedi (ilk 30 gün). Rota boşluğu kuralı DH/pozisyonlama ve aynı şehir farklı havalimanında yanlış alarm verebilir (yalnız uyarı). Gizlilik metnine «hata analizi için onaylı PDF saklama, 30 gün» cümlesi eklenmesi kullanıcı kararı.
- **Koruma:** Edge `parse-roster-pdf` sözleşmesi, `add_me_to_flight`, geçmiş üyelik temizliği, SXS'te Edge'e güven, SIM/duty birleştirmesi, `local_extract` engeli ve mevcut panoya kopyala raporu aynı. Kaldırma yalnız kullanıcı onayıyla; varsayılan «Kalsın».

### 2026-10-01 — THY lokal plan: çok günlü rotalarda ayak tarihi GMT tablosundan (parser)

- **Dosyalar:** `supabase/functions/_shared/roster-pdf/airlines/thy/lineScan.ts` (`parseLocalTimeProgramFromPdfText_THY`); Edge `parse-roster-pdf` deploy
- **Kök neden:** Lokal blokta (MB/GMB) ayak günü saat sırasından çıkarılıyordu; yerde konaklamalı çok ayaklı rotalarda ve PDF'in yanlış bastığı GMB tarihinde ayaklar 1–3 gün kayıyordu. Aynı uçuş numarası iki ayağı aynı güne düşünce `pdfRowDedupeKey` (`tarih|uçuş`) ikisini tek satırda birleştiriyor, rota/saat karışıyordu.
- **Uygulama:** Lokal ayak üretildikten sonra aynı PDF'in GMT tablosunda aynı uçuş + kalkış + varış (kullanılmamış, tahmini günden ≤3 gün) aranır; lokal kalkış günü = UTC kalkış + (lokal saat − UTC saat), fark −12…+14 saate oturtulur (TZ tablosu gerekmez). Eşleşme yoksa eski tarih korunur.
- **Doğrulama:** 5 gerçek THY PDF metni (yerelde, repoya konmadı): değişen 13 ayağın tamamı GMT UTC + lokal saatle doğru; değişmeyen satırlar aynı. Edge THY yolu (dedupe/merge/ghost) simülasyonunda çok ayaklı rota 4 ayrı satır. `npx tsc --noEmit` 0 hata; esbuild bundle OK; `git diff --check` OK; deploy OK.
- **Veri düzeltmesi (kullanıcı onayıyla):** Bildirimi tetikleyen tek ekibin 4 ayaklı rotası DB'de düzeltildi (3 satır koşullu güncelleme + eksik ayak eklendi; satırlarda başka ekip yoktu). Sonuç sorgusu 4 ayak / doğru UTC.
- **Açık:** Diğer ekiplerin mevcut DB kayıtları eski parser tarihleriyle duruyor olabilir (yeniden import, aynı numara+tarih satırını günceller ama yanlış tarihteki eski satırı silmez). Aynı gün aynı numaralı iki ayak hâlâ tek satır (DB anahtarı da numara+tarih). Mobil yerel parse yolu yeni build ile güncellenir.
- **Koruma:** GMT fallback, SIM/duty/off satırları, Pegasus/SXS/FHY/IGO parser'ları ve `prepareImportRows` THY davranışı (tarih kaydırma yok) aynı.

### 2026-09-27 — Pegasus Plan (Z): gece yarısı sonrası kalkış +1 gün (parser)

- **Dosyalar:** `supabase/functions/_shared/roster-pdf/airlines/pegasus/dutyTable.ts`; Edge `parse-roster-pdf` deploy
- **Amaç:** Lokal plan için `prepareImportRows` düzeltmesinin Z karşılığı. Z satırları (`dep_schedule_utc_iso`) import’taki `dutyFix`’i atladığı için duty 23:05Z → 00:15Z kalkış duty gününde kalıyordu.
- **Uygulama:** Yalnız `treatAsUtcPair` satırlarında, rest-end kuralı uygulanmadıysa: `dutyStart − dep ≥ 6 saat` → `flight_date` +1 gün (UTC çifti o tarihten üretilir). Lokal satırlar değişmedi (çift kaydırma yok).
- **Veri taraması (salt okunur):** Gelecek 104 uçuş / 10 ekip. Gece yarısı kayması başka ekipte yok. 6 «tarih ≠ lokal kalkış günü» satırı UTC-tarih konvansiyonu (hata değil; FR24 ±2 gün penceresi). `a3cc…` ekibinde 2 şüpheli bitişik gün kopyası (PC2261 / PC2381 30.09) — kullanıcı kararıyla dokunulmadı.
- **Doğrulama:** Sentetik Z metni → `importPdfFlightsViaRpc` (sahte istemci): PC2678/PC2677 10-02 (00:15Z/01:45Z), PC318 10-07, PC319 10-07 23:10Z, PC1311/1312 aynı. Lokal plan çıktısı değişmedi. `tsc` 0 hata. Deploy OK; OPTIONS 200, auth’suz POST 401.
- **Açık:** Gerçek Pegasus Z PDF’iyle doğrulanmadı. Mobil yerel metin birleştirmesi (Metro) aynı paylaşılan kodu kullanır; store build 49 Edge sonucunu alır.
- **Koruma:** Lokal plan, rest-end layover kuralı, SIM/duty/FSF satırları, THY/SXS/FHY/IGO parser’ları aynı.

### 2026-09-27 — Pegasus import: gece yarısı sonrası ilk uçuş +1 gün (PC2678 / PC319)

- **Dosyalar:** `mobile/lib/pdfRosterImport.ts` (`prepareImportRows`); canlı DB Gani `PC2678`, `PC319`
- **Kök neden:** 2026-09-24 kaydında eklenen `midnightOutbound` istisnası (duty ≥20:00 + kalkış <04:00 → +1 yapma) yanlış varsayıma dayanıyordu. PDF `flight_date` = duty başlangıç günü; duty kalkıştan önce başlar (≈1s10dk). Kullanıcı teyidi: duty 01.10 23:05 → PC2678 kalkış **02.10 00:15**. Aynı istisna PC319’u (TBS 03:10) PC318’den önceki güne atıyordu.
- **Uygulama:** İstisna kaldırıldı; `dutyStart > dep` → +1 gün (eski kural). 04:00 sonrası gece dönüşleri (PC2677/583/551) zaten bu yoldan +1 alıyordu, davranışları aynı.
- **Doğrulama:** `importPdfFlightsViaRpc` sahte istemciyle (esbuild + RN stub) çalıştırıldı: PC2678 10-02 STD 10-01T21:15Z, PC2677 10-02, PC318 10-07, PC319 10-08, PC979/980 09-28, PC582 10-14, PC583 10-15; `failed 0`. `npx tsc --noEmit` 0 hata. DB: PC2678 → 10-02 (21:15Z), PC319 → 10-08 (10-07T23:10Z); tek crew (Gani), çakışan satır yoktu.
- **Açık:** Plan (Z) PDF’lerde (`dep_schedule_utc_iso`) ilk uçuşun gece yarısı geçişi `dutyTable.ts`’te ayrıca ele alınmıyor; gerçek Z PDF’iyle doğrulanmadı.
- **Koruma:** Rest-end layover kuralı, kronolojik overnight, UTC çiftli satırlar ve duty/off satırları aynı.

### 2026-09-27 — Swipe silme / biten uçuş silme / temizle–import yarışı (Gani roster boşaldı)

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/lib/rosterFlightClear.ts`, `mobile/lib/pdfRosterImport.ts`, `mobile/screens/AddFlight.tsx`, `supabase/migrations/20260927180000_remove_me_from_flight_strips_archive_card.sql`
- **Olay (Gani, 27 Eyl ~20:28–20:31 TR):** Deep link PDF import (`ok 38`, `failed 26`) sonrası `flight_ops_log`’da 33 `deleted`; import’un yeniden kullandığı mevcut uçuşlar import’tan hemen sonra tarih sırasıyla ~1 sn arayla silindi, 20:30:48’de yeni oluşan 6 uçuş da silindi → canlı `flight_crew` = 0. Aynı saatte tek aktif oturum iPhone FlyFam/49; cron/trigger/admin yolu silme yapmıyor. Desen «Uçuşları temizle (geri al)» commit döngüsüyle uyumlu (kesin aktör log API `Backend error` nedeniyle doğrulanamadı).
- **Kök nedenler:**
  1. Undo-clear 5 sn sonra satır satır `remove_me_from_flight` çalıştırıyor; import/manuel ekleme bunu beklemiyordu. `add_me_to_flight` numara+tarih ile aynı satırı yeniden kullandığı için arkadan gelen silme yeni import’u da siliyordu.
  2. Biten (takip edilmiş) uçuş silinince `tg_flights_ops_log_bd` onu `past_12h_slim_card` olarak arşive yazıyor → roster arşiv kartını geri getiriyordu. Arşiv kartı (`_archived`) silme RPC’de no-op idi.
  3. Swipe: aynı anda birden çok satır açık kalabiliyordu, `leftThreshold=20` küçük sağa kaydırmada sync’i otomatik tetikliyordu.
- **Uygulama:** `flushPendingRosterClear` (bekleyen undo’yu hemen commit + süren döngüyü bekle) → `importPdfFlightsViaRpc` başında ve `AddFlight.handleSave`’de. Clear commit takip edilir, satır hatası döngüyü kesmez. Tekli silmede `archivedFlightsRef` + disk cache güncellenir. Swipe: tek açık satır, liste kaydırınca kapanır, eşik 45, kenar ofseti 16. Migration: `remove_me_from_flight` canlı temizlikten sonra çağıranı `flights_archive` kartından çıkarır; ekip kalmazsa kartı siler (cron arşiv yolu aynı).
- **Doğrulama:** `npx tsc --noEmit` 0 hata. Migration canlı DB’de `begin … rollback` ile Gani’nin arşiv kartında denendi: kart 1→0, rollback sonrası üretim değişmedi. Kullanıcı onayıyla fonksiyon production’a `db query -f` ile uygulandı: canlı tanım `flights_archive` içeriyor, `authenticated` execute OK. Swipe/import akışı cihazda denenmedi (Metro ⌘R).
- **Migration geçmişi:** `20260927180000` remote history’ye **kaydedilmedi** (önünde uygulanmamış `20260927120000_harden_privileged_rpc_access` var; `db push` onu da gönderirdi). Sonraki `db push` ikisini sırayla uygular/kaydeder; bu dosya idempotent `create or replace`.
- **Kullanıcı teyidi:** Import öncesi/sonrası «Uçuşları temizle» kullanıldı → yarış kök nedeni doğrulandı.
- **Açık:** Gani’nin canlı roster’ı şu an boş; PDF yeniden import edilmeli. Import’taki 26 başarısız satır (eklenen >0 olunca kullanıcıya gösterilmiyor) PDF olmadan incelenemedi.
- **Koruma:** Cron `archive_and_cleanup_old_flights`, trigger arşiv davranışı, paylaşılan uçuşta diğer ekip üyeleri ve undo penceresi aynı.

### 2026-09-27 — Admin toplu seçim (kullanıcı + uçuş) + aktivite «Peer review» (ui=58)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html` (+ kopya `support/admin/index.html`), `support/index.html`, `supabase/functions/admin-dashboard/index.ts`, `supabase/functions/admin-panel-ui/index.ts`
- **Amaç:** Admin panelde çoklu seçimle kullanıcı/uçuş işlemleri; aktivitede kişi başı `PeerRoster_<uuid>` ekranlarını tek kalemde toplamak.
- **Uygulama:**
  - Ortak `runBulkAction` (eşzamanlılık sınırı, tekrar eden ID tekil, `skip`/hata sayımı, ilerleme, aynı anda tek toplu işlem) + `copyTextToClipboard`.
  - Kullanıcılar: checkbox sütunu + görünenleri seç; çubuk: email doğrula, onay/şifre maili, Geniş Sülale ver (yalnız crew), push (başlık/mesaj/link), ID/email kopyala, sil (`SİL` yazarak onay). Filtre dışı seçim sayısı gösterilir. Hepsi mevcut tekil admin aksiyonlarını çağırır (yeni backend yetkisi yok).
  - Uçuşlar (mevcut seçim çubuğu): API yenile (kota uyarısı, eşzamanlılık 2), crew ekle/çıkar (çıkarmada «crew kalmayan uçuş silinir» uyarısı), ID kopyala.
  - Aktivite: `PeerRoster_*` → «Peer review» (backend top_screens sayımı + panel birleştirme / son olay detayı).
  - ZeroDeploy `wispy-glade-310` **HTTP 451 (askıya alındı)**; `admin-panel-ui` 302 ve destek linkleri `https://app.flyfamapp.com/admin/`’e çevrildi.
- **Doğrulama:** Script sözdizimi OK; yerel tarayıcıda sahte veriyle seçim/tümünü seç/filtre dışı sayım/runner (1 başarılı·1 atlandı·1 hata, eşzamanlı engel) ve Peer review birleştirme (4+3→7) OK. `admin-dashboard` + `admin-panel-ui` deploy OK; yetkisiz `check_access` 401; `admin-panel-ui` → `app.flyfamapp.com/admin/?ui=58`; CORS preflight 200.
- **Açık:** `app.flyfamapp.com/admin/` hâlâ ui=57 — ui=58 için bu dosyaların `main`’e push’u gerekir (Deploy support site workflow). Gerçek veriyle toplu aksiyonlar canlıda denenmedi.
- **Koruma:** Tekil aksiyonlar, `bulk_update_flights`/`bulk_delete_flights`, ID alanlı eski toplu form aynı; mobil `PeerRoster_<uuid>` route adları değişmedi.

### 2026-09-26 — Offline peer/aile: «Plan gerekli» yerine cache roster

- **Dosyalar:** `mobile/lib/rosterAccessCache.ts`, `mobile/screens/Roster.tsx`, `mobile/contexts/SessionContext.tsx`
- **Kök neden:** Peer sekmesinde `isCrew=false`; access RPC offline fail → `has_access:false` → paywall; cache roster olsa bile «Plan gerekli».
- **Uygulama:** Son başarılı `get_crew_roster_access` / `get_my_subscription_access` diske; fail’de cache; yoksa local roster varsa geçici `has_access`; paywall offline+flights iken gizlenir; sign-out temizler.
- **Doğrulama:** Online peer sekmesini bir kez aç → uçak modu → peer sekmesi son program + çevrimdışı (Plan gerekli yok).
- **Koruma:** Sunucunun gerçek `has_access:false` yanıtı (online) paywall’ı korur.

### 2026-09-26 — Roster offline: boş network yanıtı cache’i siliyordu

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Kök neden:** `fetchCrewLiveRosterRows` / `fetchFlightIdsForCrew` ağ hatasında throw etmeden `[]` dönüyordu; `refreshCrewLiveOnlyFromDb` yine de `persistRosterCache([])` + `setRosterOffline(false)` çağırıyordu → disk cache siliniyor, cold start boş.
- **Uygulama:** network fail bayrağı; fail’de hydrate + offline bayrak, persist yok; `persistRosterCache` boş listeyi yazmaz; aile `flightIds===0` için probe.
- **Doğrulama:** Metro ⌘R — online bir kez roster aç (cache yaz), uçak modu + kill/reopen → son program + çevrimdışı banner. (Cihazda doğrulanacak.)
- **Koruma:** Başarılı online boş roster disk’i temizlemez (nadir); offline öncelikli.

### 2026-09-26 — Kemal Saygılı Eki PDF roster sync + app parse kök neden

- **Dosyalar:** (veri) Kemal `crew_id` `19c3f4f2…`; parser fix önceki kayıtta
- **Kök neden (uygulama yanlış parse):**
  1. THY lokal parser yalnız `TK###` arıyordu → `VF###` (AJet) hiç üretilmiyordu.
  2. VF’li blokta uçuş bulunamayınca duty fallback `BUS`’u görev sanıyordu.
  3. THY `filterPdfRowsForCrewAirline` da yalnız TK kabul ediyordu (VF drop).
  - Kanıt: import sonrası DB’de TK+CFR/off + BUS, **0 VF**.
- **Sync:** Düzeltilmiş 36 satır `add_me_to_flight` ile yazıldı; BUS silindi; yanlış `TK775@10-25` kaldırıldı; 11 VF eklendi.
- **Doğrulama:** Canlı Oct roster = 36 (parse ile aynı). Pull-to-refresh / uygulamayı açınca görünür.
- **Koruma:** Edge `parse-roster-pdf` VF fix deploy’lu; yeni PDF import doğru.

### 2026-09-26 — THY PDF: VF (AJet) uçuş + BUS yok say + CFR/off

- **Dosyalar:** `supabase/functions/_shared/roster-pdf/airlines/thy/lineScan.ts`, `crewAirlineFilter.ts`, `thy/README.md`, `mobile/lib/pdfRosterImport.ts`; Edge `parse-roster-pdf` deploy
- **Amaç:** THY ekip PDF’de AJet `VF###` uçuş olarak; `BUS`/`BUS-01` import edilmez; CFR + IBI/IBB/IBE boş günleri lokal programdan gelir.
- **Uygulama:** Lokal/GMT parser TK|VF (+ opsiyonel `P`); THY filter `isVfFlightCode`; GMB tarih ataması BUS atlandıktan sonra sabah ayağı için.
- **Doğrulama:** `Published_121130.pdf` → 36 satır (11 VF, 0 BUS, CFR×5, off günleri); Edge deploy OK.
- **Koruma:** PGT/SXS/FHY/IGO filter aynı; TK path aynı.

### 2026-09-24 — Store 1.3.0 (49) build + submit (iOS + Android)

- **Dosyalar:** `mobile/app.config.js`, `mobile/android/app/build.gradle`, `mobile/ios/FlyFam.xcodeproj/project.pbxproj`
- **Amaç:** Binary 48→49; COTD/katalog/expand takvim düzeltmeleri telefona; production EAS + auto-submit.
- **Durum:** Build + submit tamamlandı (`exit 0`).
  - Android build `3752bcbe…` — submit `0eacc07e…` (Play internal OK)
  - iOS build `e7947e27…` — submit `6749e6c8…` (ASC yüklendi; Apple işliyor)
- **Doğrulama:** EAS her iki build finished; Android submission done; iOS «successfully uploaded to App Store Connect».
- **Not:** Fingerprint ExpoConfigLoader uyarısı (non-fatal). Android track=internal.
- **Koruma:** Marketing 1.3.0 / build 49.

### 2026-09-24 — COTD ev görevi: turuncu çizgi, kırmızı nokta yok

- **Dosyalar:** `occupationLabels.ts` (`isHomeDutyOccupationCode`), `public.ts`, `Roster.tsx`, `RosterFlightCard.tsx`
- **Amaç:** Çevrimiçi eğitim evden — nöbet gibi turuncu; takvimde kırmızı nokta yok.
- **Uygulama:** COTD training’den ayrıldı; takvim `standby`; kart standby chrome + «Görev» rozeti + saat.
- **Doğrulama:** Metro ⌘R — COTD turuncu çizgi/kart; nokta yok; FSF yeşil; yer dersi kırmızı kalır.
- **Koruma:** `isTrainingOccupationCode` yer dersi/ofis kırmızı yolu aynı.

### 2026-09-24 — Eğitim kartı kırmızı+saat; expand takvim ay senkron

- **Dosyalar:** `mobile/components/roster/RosterFlightCard.tsx`, `mobile/screens/Roster.tsx`, `mobile/theme/tokens.ts`, `mobile/locales/{tr,en}.json`
- **Amaç:** COTD/yer dersi yeşil off değil kırmızı training; saat satırı; liste expand takvimde ‹ › ay + liste kaydırınca ay senkron.
- **Uygulama:** `compactKind: 'training'` + `cardAccent('training')`=flightDot; schedule `dep–arr`; expand’da `shiftCalendarMonth`; list→calendar sync expanded’da da.
- **Doğrulama:** Metro ⌘R — COTD kırmızı «Görev» + saat; expand ‹Ekim›; liste Ekim’e kayınca grid Ekim.
- **Koruma:** FSF yeşil off; takvim görünümü ay okları aynı; collapsed hafta şeridi aynı.

### 2026-09-24 — COTD kartı «Boş Gün» gösteriyordu (sim)

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/components/roster/RosterFlightCard.tsx`, `supabase/functions/_shared/roster-pdf/occupationLabels.ts`
- **Neden:** Compact off kartı `blockTitle` yok sayıp hep `roster.restDay` basıyordu; Roster da training/leave dışı duty_off’u restDay’e zorluyordu. COTD `isTrainingOccupationCode` listesinde değildi.
- **Uygulama:** Off compact `model.blockTitle`; non-flight `blockTitle` olduğu gibi; COTD training kodu.
- **Doğrulama:** Metro ⌘R — COTD «Çevrimiçi Eğitim» (katalog) veya en azından «Görev»; Boş Gün değil.
- **Koruma:** FSF/FOF hâlâ Boş Gün (`blockLabel` / off kodları).

### 2026-09-24 — Deploy görev kodu (COTD) uygulamada görünmüyor

- **Dosyalar:** `mobile/lib/rosterOccupationCatalog.ts`, `mobile/App.tsx`, `mobile/screens/Roster.tsx`, `mobile/screens/EditDuty.tsx`, `supabase/migrations/20260924160000_roster_occupation_catalog_meta_anon_select.sql`
- **Neden:** COTD yayınlanmıştı (v6, «Çevrimiçi Eğitim») ama (1) katalog AsyncStorage/hydrate sonrası asenkron `refresh` UI’yi yeniden çizmiyordu, (2) kart etiketi generic bucket’lara düşebiliyordu, (3) anon RLS yok → oturum öncesi/yenileme boş satır.
- **Uygulama:** `subscribeOccupationCatalog` + Roster tick; oturum + AppState `active`’te katalog yenile; `blockLabel` önce yayınlanan/yerel etiket; airline_icao geçir; anon SELECT migration (henüz remote push edilmedi — authenticated yenileme yeterli).
- **Doğrulama:** Canlı meta v6 + COTD satırı; kod yolu. Metro ⌘R / uygulamayı öne getir → COTD «Çevrimiçi Eğitim», öneri butonu kalkmalı.
- **Koruma:** Baked fallback aynı; Deploy akışı aynı. Anon policy migration’ı ayrı `db push` (diğer pending migration’larla karıştırma).

### 2026-09-24 — Admin panel online ui=57 (ZeroDeploy)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`, `support/admin/index.html`, `supabase/functions/admin-panel-ui`
- **Amaç:** Görev kodu öneri popup’ını canlıya almak (eski winter-hill 404).
- **Uygulama:** Fresh ZeroDeploy `https://wispy-glade-310.zerodeploy.app/` (ui=57 + popup); destek linkleri + `admin-panel-ui` 302 güncellendi.
- **Doğrulama:** Host HTTP 200, `var UI = '57'`, `occSugAlertBackdrop` mevcut; function Location → wispy-glade.
- **Koruma:** Claim token `.local/` (gitignore); 72s içinde claim veya X-Claim-Token ile redeploy.

### 2026-09-24 — Store 1.3.0 (48) build + submit (iOS + Android)

- **Dosyalar:** `mobile/app.config.js`, `mobile/android/app/build.gradle`, `mobile/ios/FlyFam.xcodeproj/project.pbxproj`
- **Amaç:** Binary 47→48; roster import/yatı/FSF düzeltmeleri telefona; production EAS + auto-submit.
- **Durum:** Build kuyruğa alındı + submit planlandı (EAS bitince otomatik).
  - Android build `9d84aac6…` — submit `7ac154d7…`
  - iOS build `a3ab0539…` — submit `2fdbb13b…`
- **Not:** Fingerprint ExpoConfigLoader uyarısı (non-fatal); credentials hazır. Android track=internal.
- **Koruma:** Marketing 1.3.0 / build 48.

### 2026-09-24 — Admin: yeni görev kodu önerisi popup

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html` (ui=57), `support/index.html` (adminUi=57)
- **Amaç:** Kullanıcı yeni occupation code önerince admin popup + sol menü rozeti görsün.
- **Uygulama:** Giriş/yenile/oturum restore’da pending kontrol; popup → Öneri kuyruğu; 60s poll (yalnız yeni id’ler); `navOccPendingBadge`.
- **Doğrulama:** Kod yolu. Panel `?ui=57` ile soft-refresh.
- **Koruma:** Onay/red akışı aynı.

### 2026-09-24 — Görev kodu öneri onayı: description_en NOT NULL

- **Dosyalar:** `supabase/functions/admin-dashboard/index.ts` (deploy)
- **Olay:** Admin COTD onayında 500 — `description_en` null.
- **Uygulama:** `review_occupation_suggestion` upsert’ta `description_tr`/`description_en` boş string veya note/label. Canlıda COTD (PGT, training) kataloga yazıldı + öneri approved + catalog publish.
- **Doğrulama:** Function deploy OK; `roster_occupation_codes` COTD satırı var; suggestion `approved`.
- **Koruma:** Manuel kod kaydı / Deploy aynı.

### 2026-09-24 — Ekim PDF sync + FSF gizleme / yatı (Gani SAW)

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/lib/pdfRosterImport.ts`; canlı DB Gani `24.09–24.10` planı
- **Neden:** Admin `parse-roster-pdf` doğruydu; uygulamada (1) gece uçuşları yanlış `flight_date`/UTC (PC2678 2 Eki, PC319 aynı gün sabah), (2) üs boşken SAW geceleri yatı → ara gün **FSF** listeden düşüyordu, (3) session home_base kaçınca aynı şişme.
- **Uygulama:** Admin parse ile DB senkron; gece dönüş PC319/583/551 +1g. Import: duty midnight outbound +1 yok; PC kronolojik overnight. Layover home_base fallback. Ara günde FSF/FOF/STBYC/COTD gizlenmez. SAW yatı yalnız AYT 25–26 + VKO 18–20.
- **Doğrulama:** DB `PC2678@10-01`, `PC319@10-08` after PC318; FSF 29/9·9/10·16/10·21/10; layover sim → AYT+VKO. Metro ⌘R.
- **Koruma:** Empty home → yatı yok; ≥10–72s; Moskova inclusive span.

### 2026-09-24 — Gani PDF eksik satır + üs koruması (SAW)

- **Dosyalar:** `mobile/lib/pdfRosterImport.ts`, `mobile/contexts/SessionContext.tsx`, `mobile/screens/Roster.tsx`; canlı DB `PC398`/`PC399`
- **Neden:** Home base SAW doğruydu; “her gece yatı” boş üs varsayımı değildi. Import sonrası `flight_date < dün` temizliği plan içi geçmişi (20–21 Eyl PC398/399 LED) siliyordu. `roster_list_show` kolon hatasında session `home_base_iata`’yı da null’luyordu.
- **Uygulama:** Cleanup tabanı = bu import’un en erken `effectiveDate`. Session: yalnız `roster_list_show` eksikse home_base korunur. Canlı pencere 3→7g. PC398/399 PDF (L) saatleriyle yeniden eklendi.
- **Doğrulama:** DB’de 20 Eyl PC398 SAW→LED, 21 Eyl PC399 LED→SAW; SAW ile yatı yalnız AYT 25–26 (+ VKO 18–20). Metro ⌘R / Geçmişi Göster → 20–21 görünür.
- **Koruma:** ≥10s / 72s max yatı; empty home → yatı yok; Moskova inclusive span aynı.

### 2026-09-24 — Takvim yatı şişmesi (üs boşluğu / FOF gizleme)

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Neden:** `home_base` yokken SAW vb. üs gece boşlukları yatı sayılıyordu; ara gün FOF/OFF listeden düşüyordu. Admin PDF tablosu doğru görünüyordu.
- **Uygulama:** Home base yoksa yatı yok; yatı penceresi 10–72 saat.
- **Doğrulama:** Metro ⌘R; üs araları pembe yatı olmamalı; FOF/FSF günleri listede; gerçek outstation yatı (ör. AYT gece) kalır.
- **Koruma:** ≥10s eşik / inclusive span (çok günlü gerçek yatı) aynı.

### 2026-09-24 — Store 1.3.0 (47) build + submit (iOS + Android)

- **Dosyalar:** `mobile/app.config.js`, `mobile/android/app/build.gradle`, `mobile/ios/FlyFam.xcodeproj/project.pbxproj`
- **Amaç:** Binary 46→47; production EAS build her iki platform + auto-submit.
- **Durum:** Build kuyruğa alındı + submit planlandı (EAS bitene kadar beklemede).
  - Android build `21366b2e…` — submit `ed41f99b…`
  - iOS build `b837f6d6…` — submit `c8866714…`
- **Not:** Fingerprint ExpoConfigLoader uyarısı (non-fatal); credentials hazır. Android track=internal.
- **Koruma:** Marketing 1.3.0 / build 47.

### 2026-09-24 — Geçmişi Göster bugün kartını örtmesin

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Absolute past FAB listenin üstüne binip bugün kartını gizliyordu.
- **Uygulama:** Past bar tekrar in-flow (listeyi aşağı iter); absolute/overlay kaldırıldı.
- **Doğrulama:** Tepede Geçmişi Göster → bugün başlığı/kartı barın altında görünür.
- **Koruma:** Reveal yerinde kalır; Bugün FAB aynı.

### 2026-09-24 — Üst takvim açılışta bugün haftasına roll

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Program açılınca hafta şeridi eski haftada (offset 0) kalmasın; roll çalışsın.
- **Uygulama:** `initialScrollIndex` + `listSessionKey` remount; `scrollCalendarToWeekOf` layout retry; momentum’da pin yalnız liste sync’i keser.
- **Doğrulama:** Metro ⌘R; açılışta bugünün haftası; parmakla yukarı/aşağı hafta roll.
- **Koruma:** Liste→takvim sync / Geçmişi Göster aynı.

### 2026-09-24 — Takvim işaretleri her zaman + liste→takvim sync

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Nokta/yatı çizgileri Geçmişi Göster beklemeden dursun; liste kaydırınca üst takvim takip etsin.
- **Uygulama:**
  - Layover taraması `CALENDAR_RANGE` (listPast’tan bağımsız).
  - Slim arşiv crew’da her zaman yüklenir (takvim işaretleri için).
  - Viewability → selectedDate + hafta senkronu; `listData` selectedDate’e bağlı değil (sıçrama yok).
- **Doğrulama:** Metro ⌘R; açılışta geçmiş nokta/yatı; liste aşağı → takvim haftası/seçim kayar.
- **Koruma:** Bugün-pin yalnız açılış/FAB; Geçmişi Göster yerinde kalır.

### 2026-09-24 — Bugün-pin yalnız açılış + Bugün FAB; geçmiş yerinde

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Geçmişi Göster bugüne zıplamasın; gereksiz scroll retry/pin kalksın; liste daha tepkili olsun.
- **Uygulama:**
  - Today-pin yalnız focus/open effect + `goToToday`. Canlı iniş→bugün kaldırıldı.
  - Reveal: `openRosterAnchor`/`pending`/scroll hedefleri temizlenir; MVP önce açılır; absolute past FAB (layout sıçraması yok).
  - Pin effect pending’i tüketir → past/listData değişince tekrar bugüne çekmez.
  - `scrollListToDate` tek kısa retry; FlatList batch/period hızlandı.
- **Doğrulama:** Metro ⌘R; yukarı→Geçmişi Göster yerinde kalır; Bugün FAB / sekme focus → bugün tepe.
- **Koruma:** +7g chunk / past FAB tepede yeniden / Bugün FAB aynı.

### 2026-09-24 — Geçmiş açılınca yerinde kal + buton kaybol

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Geçmişi Göster → +7g ama ekran 7 gün öncesine gitmesin; buton kaybolsun; tepede yeniden görünsün.
- **Uygulama:** `scrollToOffset(0)` kaldırıldı. `maintainVisibleContentPosition` past>0. Reveal’da FAB gizle + `pastFabNeedsLeaveTopRef` (önce aşağı inmeden tekrar açılmaz).
- **Doğrulama:** Bas → yerinde; FAB yok; aşağı→yukarı en eskiye → FAB yine.
- **Koruma:** +7g chunk / cap / Bugün FAB aynı.

### 2026-09-24 — Geçmişi Göster: yuvarlak köşe + üst border + overlap fix

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Neden:** `borderTopWidth:0` üst çerçeveyi kesiyordu; absolute overlay listeyle overlap yapıyordu.
- **Uygulama:** In-flow üst bar; `borderRadius:12`; dört kenar `borderWidth:1` primary; liste altına itilir.
- **Doğrulama:** Üst/yan/alt mavi çerçeve görünür; kartlarla örtüşmez.
- **Koruma:** Scroll’da göster/gizle + +7g aynı.

### 2026-09-24 — FAB hız + Geçmişi Göster beyaz/mavi

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Neden:** Bugün 220ms / Geçmiş 160ms debounce + `minimumViewTime:80` geç aç/kapa yapıyordu.
- **Uygulama:** Debounce kaldırıldı; viewability `minimumViewTime:0`; scroll throttle 16. Past bar: beyaz zemin + primary yazı.
- **Doğrulama:** Kaydırınca FAB anında; past üst bar beyaz/mavi.
- **Koruma:** Üst flush konum + +7g aynı.

### 2026-09-24 — Geçmişi Göster: liste tepesine dayalı

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** FAB sol altta değil; liste alanının en üstüne full-bleed dayalı mavi bar.
- **Uygulama:** `listAndClearContainer` içinde `top:0; left:0; right:0`. Yukarı scroll görünürlüğü aynı.
- **Doğrulama:** Tepede scroll → üstte Geçmişi Göster; Bugün sağ altta kalır.
- **Koruma:** +7g / focus gizle aynı.

### 2026-09-22 — Geçmişi Göster: yukarı scroll FAB (mavi)

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Sürekli şerit kalksın; yukarı/tepe scroll’da mavi FAB çıksın (Bugün gibi).
- **Uygulama:** `showPastFab` y≤28; y>64 gizle. Sol alt primary pill; her basış +7g. Focus’ta gizli.
- **Doğrulama:** Liste tepesine kaydır → FAB; aşağı → kaybolur; bas → +7.
- **Koruma:** Bugün FAB / past remount aynı.

### 2026-09-22 — Geçmişi Göster: tam genişlik + her basış +7g

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Amaç:** Buton metni “Geçmişi Göster”, tam genişlik; her basışta 7 gün daha geri (cap’e kadar).
- **Uygulama:** Toggle/gizle kaldırıldı; `revealListPastWeek` her seferinde `+LIST_PAST_CHUNK_DAYS`. Cap’te disabled. Kapatma: Bugün FAB / sekme focus.
- **Doğrulama:** Buton full width; 1./2. basış +7/+14; Bugün → past=0.
- **Koruma:** Takvim geçmiş gün `ensureListPastCoversYmd` aynı.

### 2026-09-22 — Liste yalın model: Geçmiş chip + takvim blink kes

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Amaç:** Liste kaybolma / sıçrama / takvim blink’i bitirmek; geçmiş bilinçli açılsın.
- **Uygulama:**
  - Varsayılan liste = bugün→ileri. Scroll/`onStartReached` past expand kaldırıldı. MVP kaldırıldı.
  - Sabit chip: `Geçmiş (7 gün)` / `Geçmişi gizle`. Takvim geçmiş günü hâlâ `ensureListPastCoversYmd`.
  - Viewability yalnız Bugün FAB; liste→takvim/selectedDate senkronu yok (blink yok).
  - Focus: past=0 + FlatList remount. Bugün FAB geçmişi de kapatır.
- **Doğrulama:** Metro ⌘R; Program→Aile→Program bugün tepe; chip 7g aç/kapa; kaydırınca takvim sabit.
- **Koruma:** Takvim→liste tepe hiza; arşiv lazy past>0 veya eski selectedDate ile.

### 2026-09-22 — Aile→Program: 30 Eyl kayması

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Neden:** Sekme dönüşünde `listPastDaysBack→0` üstten satır silerken FlatList eski `contentOffset`’i tutuyordu → aynı Y ileriki güne (ör. 30 Eyl) düşüyordu; `scrollToOffset(0)` layout yarışında yetişmiyordu.
- **Uygulama:** Focus’ta `listSessionKey++` → FlatList remount (offset 0). MVP yalnız past>0 prepend’te. `removeClippedSubviews={false}`.
- **Doğrulama:** Metro reload; Program→Aile→Program → bugün tepe.
- **Koruma:** Yukarı past chunk + takvim gün seçimi aynı.

### 2026-09-22 — Sekme focus → bugün tepe + Metro notu

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Sayfa/sekme değişince liste bugünü en üste alsın; simülatörde doğrulanabilir olsun.
- **Uygulama:** Focus’ta hemen bugün seç + `pendingRosterAnchor`. Anchor effect `listMinYmd===bugün` ve ilk header bugün olana kadar bekler; `scrollToOffset(0)` çoklu retry. Metro kapalıysa JS güncellenmez.
- **Doğrulama:** Metro yeniden; Program’dan çık→gir → bugün tepe.
- **Koruma:** addedFlightDate yolu aynı.

### 2026-09-22 — Takvim/Bugün: günü liste tepesine hizala

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Tarihe veya Bugün’e basınca gün başlığı listenin ortasında değil en üstünde olsun.
- **Kök neden:** `scrollToIndex({ viewPosition: 0 })` `getItemLayout` yokken VirtualizedList öğeyi “görünür alana” (sıkça orta) alıyordu.
- **Uygulama:** `applyScrollToDate` yalnız `scrollToOffset` (ölçülen/tahmini offset); idx=0 → offset 0. `scrollListToDate` ekstra tepe kilidi retry + pin.
- **Doğrulama:** Kod yolu. Takvim günü / Bugün FAB → dayHeader takvim altında tepe.
- **Koruma:** Lazy past / boş gün ensure / FAB visibility aynı.

### 2026-09-22 — Liste sıçrama / yanlış gün: sıfırdan düzeltme

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Kök nedenler:**
  1. Viewability `selectedDate` her kaydırmada boş gün `dayHeader` enjekte edip kaldırıyordu → liste yapısı mid-scroll değişiyor = sıçrama / yanlış gün.
  2. Focus’ta `listPastDaysBack→0` üstten satır silerken MVP + eski `itemHeightsRef` offset’i yanlış güne bırakıyordu.
  3. Açılışta `scrollToIndex` tahmini yüksekliklerle bugünü ıskalıyordu (`index*avg` fallback daha kötü).
- **Uygulama:** Boş gün yalnız `listEnsureEmptyYmd` (takvim/açılış/programatik); scroll `selectedDate` enjekte etmez. Focus/açılışta MVP askı + height reset + pin. Bugün tepe = `scrollToOffset(0)`. `onScrollToIndexFailed` ölçülü offset. Pin sırasında structure height wipe yok.
- **Doğrulama:** Kod yolu + lint. Simülatör: sekme aç → bugün üstte; kaydır → sıçrama yok; takvim boş gün → tek header; Bugün FAB.
- **Koruma:** Lazy past chunk / `ensureListPastCoversYmd` / FAB visibility aynı. Mağaza 46 bu fix’i içermez.

### 2026-09-21 — Store 1.3.0 (46) build + submit (iOS + Android)

- **Dosyalar:** (sürüm `app.config.js` / gradle / pbxproj = 1.3.0 / 46)
- **Amaç:** Production EAS build her iki platform + store submit.
- **Durum:** Build + auto-submit planlandı (henüz bitmedi).
  - Android build `05c62ef2…` — submit `39e4fea8…`
  - iOS build `7898d095…` — submit `2fdcdfb4…`
- **Not:** Fingerprint ExpoConfigLoader uyarısı (non-fatal); credentials hazır.
- **Koruma:** Marketing 1.3.0 / build 46.

### 2026-09-21 — Liste yukarı scroll: smooth prepend (MVP)

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Yukarı kaydırırken geçmiş chunk eklenince ani zıplamayı azaltmak.
- **Uygulama:** `maintainVisibleContentPosition` (minIndexForVisible:1); `goToToday`/takvim kaydırmada MVP geçici askı. Liste `extraData`’dan `selectedDate` çıkarıldı; viewability aynı günü tekrar setState etmez; takvim hafta sync animasyonsuz.
- **Doğrulama:** Kod yolu. Simülatörde yukarı kaydır → konum korunmalı; Bugün FAB hâlâ doğru hizalar.
- **Koruma:** 1 haftalık chunk + expand kilit aynı.

### 2026-09-21 — Liste yukarı kaydır: 1 haftalık chunk

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Yukarı roll’da listenin en eskiye zıplamasını kesmek; takvim haftası ile uyumlu geri açılış.
- **Kök neden:** Overscroll/`beginDrag` her frame’de expand kilidini açıyordu → chunk peş peşe cap’e kadar ekleniyordu.
- **Uygulama:** `LIST_PAST_CHUNK_DAYS=7`. Kilit yalnız içeride (y > 72) açılır; tepede/overscroll’ta bir chunk sonrası kilit kalır.
- **Doğrulama:** Kod yolu. Simülatörde yukarı→+7g, tekrar için aşağı kaydırıp yeniden yukarı.
- **Koruma:** Takvim gün seçimi `ensureListPastCoversYmd` aynı; açılış past=0.

### 2026-09-21 — Admin giriş Aile başlığı + uçuş kontrol ham veri

- **Dosyalar:** `mobile/contexts/AdminRosterContext.tsx`, `mobile/screens/Family.tsx`, `mobile/screens/Profile.tsx`, `docs/ADMIN_STATUS_DASHBOARD.html` (ui=56)
- **Amaç:** Admin mode girişi Profil’den Aile başlığına (5 dokunuş / 3 sn). Uçuş kontrol ham verisi okunabilir, FR24 üstte, geniş panel.
- **Uygulama:** `onAdminSecretTap`; Profil secret kaldırıldı. `paintFcRawDebug` provider kartları + satırlı kv; layout `fc-layout`.
- **Doğrulama:** Kod yolu + lint. Admin HTML `?ui=56`.
- **Koruma:** `check_access` whitelist aynı; non-admin dokunuş no-op.

### 2026-09-21 — Uygulama ekran haritası HTML

- **Dosyalar:** `docs/APP_SCREEN_MAP.html`
- **Amaç:** Auth → kapılar → Main sekmeler → stack ekranlarının haritası, kısa açıklamalar ve marketing-v3 görselleri.
- **Doğrulama:** Dosya `docs/` altında; göreli screenshot yolları.
- **Koruma:** Uygulama kodu değişmedi.

### 2026-09-21 — Liste hızlandırma: live-first + lazy archive + focus throttle

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Program sekmesi navigasyonunu hızlandırmak; her focus’ta ~365g arşiv çekimini kaldırmak.
- **Uygulama:** Focus ~45s throttle; focus/poll `refreshCrewLiveOnlyFromDb` (canlı ~3g + bellek arşivi). Slim arşiv `ensureArchivedRosterLoaded` — past expand / eski takvim günü / manuel sync (`refreshCrewListFromDb`). TTL 180s. `layoverSourceFlights` + `allFlightsSorted` `listMinYmd` ile budanır. Açılışta past=0 aynı.
- **Doğrulama:** Kod yolu + lint. Sekme dönüşü throttle; yukarı/takvimde arşiv lazy; sync ikonu full.
- **Koruma:** Takvim mark / peer sekmeleri / past reset focus’ta aynı.

### 2026-09-21 — Yenileme yalnız ikon butonu; pull-to-refresh kaldırıldı

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Aşağı çekince scroll yerine yenileme açılmasın; güncelleme yalnız sağ üst ikondan.
- **Uygulama:** FlatList `RefreshControl` kaldırıldı. Ay satırında küçük sync metni + en sağda yuvarlak `refresh` ikon butonu.
- **Doğrulama:** Kod yolu. Üstte çekince geçmiş expand / scroll; yenileme ikona basınca.
- **Koruma:** Sessiz arka plan `runUserRefresh({ silent })` aynı.

### 2026-09-21 — Liste: açılışta geçmiş yok, lazy past + performans

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Liste görünümünde ~24s+ geçmişi açılışta render etme; yukarı scroll / takvim navigasyonuna kadar ertele; açılış ve kaydırmayı hızlandır.
- **Uygulama:** `LIST_INITIAL_PAST_DAYS=0` (yalnız bugün→ileri). `onStartReached` mount’ta şişirmesin diye `listPastExpandArmedRef` (üstte sürükleme / aşağı kaydırma / overscroll). Takvim `ensureListPastCoversYmd` aynı. `listData` erken `listMinYmd` filtresi; FlatList `windowSize`/`initialNumToRender` düşürüldü.
- **Doğrulama:** Kod yolu + lint. Simülatörde: açılışta dün yok; yukarı çek / takvimden dün → gelir.
- **Koruma:** DB/arşiv fetch aynı; takvim mark’ları aynı; `calendarDayCardsOnly` aynı.

### 2026-09-21 — Sürüm eşlemesi 1.3.0 (46)

- **Dosyalar:** `mobile/app.config.js`, `mobile/android/app/build.gradle`, `mobile/ios/FlyFam.xcodeproj/project.pbxproj`
- **Amaç:** Sonraki store build için binary/build 45 → 46.
- **Uygulama:** iOS `buildNumber` + tüm `CURRENT_PROJECT_VERSION` (ana + notification + share) = 46; Android `versionCode` = 46; pazarlama `1.3.0` aynı.
- **Doğrulama:** Üç kaynakta 46; 45 kalmadı. Build/submit henüz yok.
- **Koruma:** EAS `appVersionSource` local. Route to Live tamamlanmış 45 maddeleri dokunulmadı.

### 2026-09-21 — Dosya aktarımı roster’da + takvim hiza + sync butonu

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** (1) “Dosyadan içe aktar” manuel AddFlight sayfasını açmasın; (2) liste kaydırınca açık takvim görünen güne hizalansın; (3) “Az önce güncellendi” yenileme butonu gibi görünsün.
- **Uygulama:** PDF picker + parse/RPC pipeline Roster üzerinde (`FlightOperationOverlay`); başarıda liste yenilenir, AddFlight’a gidilmez. `onViewableItemsChanged` hafta/ay takvimini senkronlar; expand’ta ay grid offset sıfırlanır. Sync metni yanında `refresh` ikonu + chip çerçevesi.
- **Doğrulama:** Kod yolu + lint. Mağaza build’i yeni sürüm ister.
- **Koruma:** Manuel uçuş ekle aynı; paylaşılan PDF deeplink AddFlight yolu aynı.

### 2026-09-21 — Dosyadan içe aktar: picker yerine manuel form

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Kök neden:** “Dosyadan içe aktar” doğrudan manuel `AddFlight` açıp picker’ı sheet kapanırken çağırıyordu; iOS ikinci pencereyi iptal edince yalnız manuel form kalıyordu.
- **Uygulama:** Sheet kapandıktan sonra `DocumentPicker`; dosya seçilmezse roster’da kalınır; seçilince `AddFlight` yalnız `sharedPdfUri` ile açılır.
- **Doğrulama:** Kod yolu. Mağaza 1.3.0 (45) bu düzeltmeyi içermez — yeni build gerekir.
- **Koruma:** Manuel uçuş ekle aynı.

### 2026-09-20 — PC398 “indi” DB trigger koruması + UI STD guard

- **Dosyalar:** `supabase/migrations/20260920194500_protect_premature_landed_trigger.sql` (prod), `mobile/screens/Roster.tsx`
- **Amaç:** Üretim uygulaması eski poll ile satırı tekrar landed/19 Eyl yapsa bile kalıcı “İndi” olmasın.
- **Uygulama:** BEFORE UPDATE trigger — STD öncesi landed/en_route ve yanlış-gün FR24/STD ezmesi reddedilir. `getFlightStatus` STD gelmeden asla landed dönmez.
- **Doğrulama:** Corrupt UPDATE denemesi trigger sonrası `scheduled` / 20 Eyl kalır.
- **Koruma:** Gerçek iniş (STD sonrası) aynı.

### 2026-09-20 — PC398 hâlâ “indi”: internal_status + poll STD ezmesi

- **Dosyalar:** `mobile/lib/flightApiRefreshPhase.ts`, `mobile/screens/Roster.tsx`, `supabase/functions/_shared/cachedRosterPollPatch.ts`, `check-flight-status-and-notify` (deploy)
- **Kök neden:** `internal_status=landed` → UI “İndi”; poll/cache dünkü STD/takeoff ile `flight_date`/`scheduled_*` eziliyordu.
- **Fix:** Satır 20 Eyl scheduled’a reset; PC398 cache silindi. `landedFromRow` STD öncesi landed demez. Poll/cache roster STD/STA’yı ezmez (yalnız estimated); takeoff/landed/status ±12–18h dışı yazılmaz; `flight_date` provider’dan güncellenmez.
- **Doğrulama:** 15s sonra hâlâ `scheduled` / FR24 null / 20 Eyl 19:00Z.
- **Koruma:** Arşiv STD koruması aynı.

### 2026-09-20 — Gani PC398 20 Eyl ekle + arşiv STD koruması

- **Dosyalar:** `supabase/migrations/20260920193000_protect_archive_before_std.sql` (prod uygulandı); canlı `flights` insert
- **Amaç:** Bugün (20 Eyl) PC398 programda olmalı; yanlış-gün ATA ile erken “indi” sonrası canlı satırın silinmesini engelle.
- **Uygulama:** `archive_and_cleanup_old_flights` — STD geçmeden arşiv yok; ATA STD−90dk’dan önceyse block_end’de yok sayılır. Gani (`d0373b44-…`) PC398 SAW→LED 20 Eyl 19:00–22:45Z eklendi (`c2abec4c-…`, flight_crew bağlı).
- **Doğrulama:** Migration API 201; uçuş `scheduled`/`semi_active`; fonksiyon def’de STD/90dk koruması.
- **Koruma:** 12h slim arşiv gerçek iniş sonrası aynı; poll yanlış-gün ETA fix (önceki kayıt) duruyor.

### 2026-09-20 — Store 1.3.0 (45) build + submit (iOS + Android)

- **Dosyalar:** (sürüm zaten `app.config.js` / gradle / pbxproj = 1.3.0 / 45)
- **Amaç:** Production EAS build her iki platform; ardından store submit.
- **Doğrulama (OK):**
  - iOS build `ec56ab91…` finished + submit `1cfb3304…` **finished** (ASC). Özel EAS bağlantısı dokümandan kaldırıldı.
  - Android build `5c7cf65f…` finished + submit `f93b1c76…` **finished** (Play internal). Özel EAS bağlantısı dokümandan kaldırıldı.
- **Not:** Yerel wait GraphQL `ENOTFOUND` ile exit 1 verdi; submit yine de sunucuda tamamlandı. Sonraki iOS retry’lar `errored` (aynı binary zaten ASC’te). Disk ENOSPC / DerivedData temizliği build öncesi yapıldı.
- **Koruma:** Marketing 1.3.0 / build 45.

### 2026-09-20 — PC398 yanlış-gün ETA/ATA → erken “indi” + 12h arşiv

- **Dosyalar:** `supabase/functions/check-flight-status-and-notify/index.ts` (deploy)
- **Olay:** Anonim test uçuşu PC398 (SAW→LED, `flight_date` 2026-09-19) programdan düşüp “indi” göründü.
- **Gerçek:** FR24 kalkış/iniş 19 Eyl UTC doğru; 12h slim arşiv 20 Eyl ~16:23 UTC (`past_12h_slim_card`) — canlı listeden kalkması beklenen davranış.
- **Bug:** Snapshot’ta `estimated_*` / `actual_arrival` **18 Eyl** (önceki gün PC398) yazılmıştı; provider `landed` + `scheduledArr` ATA sanılıp erken kilitleyebiliyordu.
- **Fix:** ETA/ETD yalnız roster STD/STA ±12h ise yazılır; `scheduledArr` asla ATA olmaz; provider `landed` yalnız güvenilir `actualIn` ile; `hasStrongLandedEvidence` yanlış-gün ATA’yı reddeder.
- **Doğrulama:** Kod yolu + arşiv snapshot incelemesi; function deploy OK.
- **Koruma:** FR24 `flight_ended` / gerçek landed aynı; github/admin host değişiklik yok.

### 2026-09-17 — Admin login fix + GitHub yedek + mobil host

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html` (ui=55), `support/index.html`, `supabase/config.toml`, `supabase/functions/admin-panel-ui/index.ts`, `admin-panel-login` deploy
- **Amaç:** Mobilde şifre doğru olsa da “Giriş başarısız”; GitHub yedek kalsın; güvenlik netleşsin.
- **Kök neden:** `admin-panel-login` çağrısında `Authorization` yoktu → gateway `UNAUTHORIZED_NO_AUTH_HEADER`; UI bunu genel “başarısız” gösteriyordu.
- **Uygulama:** Login’e `Authorization: Bearer <anon>`; `verify_jwt=false` deploy; destek sayfasında mobil + GitHub iki link; mobil host `https://winter-hill-9203.zerodeploy.app/`.
- **Doğrulama:** Login POST yanlış şifre → `Invalid credentials` (gateway değil); host `var UI = '55'` + Bearer satırı.
- **Koruma:** github.io deploy workflow aynı; panel verisi yine Supabase auth + whitelist.

### 2026-09-17 — Bugün üst hiza + FAB viewport

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Bugünü takvim altına (liste üstü) hizala; FAB yalnız bugün ekranda yokken, titremesiz.
- **Uygulama:** `scrollToIndex({ viewPosition: 0 })`; FAB `todayInView` + 220ms debounce show; bugün görünürken hemen gizle.
- **Doğrulama:** Bugün tuşu → gün başlığı üstte; bugün görünürken FAB yok; uzaklaşınca sabit FAB.
- **Koruma:** Açılış pending scroll aynı.

### 2026-09-17 — Admin mobil host: zerodeploy (github.io bypass)

- **Dosyalar:** `support/index.html`, `supabase/functions/admin-panel-ui/index.ts`, `supabase/config.toml`; claim meta `.local/zerodeploy-admin.json` (gitignore)
- **Amaç:** Telefonda yalnız admin “internet bağlantınızı kontrol edin” — `github.io` bazı hatlarda açılmıyor.
- **Kısıt:** Supabase Storage/Edge GET `text/html` → `text/plain`+sandbox (custom domain olmadan).
- **Uygulama:** Panel `https://cold-rain-7664.zerodeploy.app/` (ui=54, `text/html`). Destek linki + `admin-panel-ui` 302 bu URL’ye. 72s içinde claim/redeploy gerekir.
- **Doğrulama:** GET host → 200 `text/html`, `var UI = '54'`; edge 302 → aynı host.
- **Koruma:** github.io yedek duruyor; admin API aynı.

### 2026-09-17 — Admin sol menü UX (ui=54)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`
- **Amaç:** Sol menüyü daha okunaklı yapmak; aktif sayfayı net göstermek.
- **Uygulama:** Grup ayırıcı çizgileri; “Şu an” kartı; aktif satırda mavi vurgu + “Şimdi” rozeti + `aria-current`; numara rozetleri; UI `54`.
- **Doğrulama:** Stil/HTML yapı incelemesi; `switchView` etiket güncelliyor.
- **Koruma:** `data-view` ID’leri ve sayfa yükleme yan etkileri aynı.

### 2026-09-17 — Açılış bugün tepe + FAB visibleListYmd

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Kök neden:** `pendingRosterAnchor` liste hazır olmadan siliniyordu; FAB `selectedDate`’e bağlıydı ve viewability programatik kilitte güncellenmiyordu.
- **Uygulama:** Açılış anchuru her zaman bugün (eklenen uçuş hariç); pending yalnız dayHeader hazırken scroll + sonra clear; FAB `visibleListYmd !== today`.
- **Doğrulama:** Soğuk açılış → bugün üstte; aşağı kaydır → Bugün FAB.
- **Koruma:** `goToToday` tek atış; takvim seçimi aynı.

### 2026-09-17 — Bugün FAB: titremesiz tek atış + “Bugün”

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Kök neden:** Çoklu retry + viewability’nin tekrar scroll etmesi titreme/zıplama yapıyordu.
- **Uygulama:** `goToToday` tek `applyScrollToDate`; pin süresince viewability/height düzeltmesi sessiz; FAB metni yalnız `roster.today`.
- **Doğrulama:** Geçmişe kaydır → Bugün → hızlı, titresiz bugün.
- **Koruma:** Takvim gün seçimi `scrollListToDate` aynı.

### 2026-09-17 — Bugüne dön: zıplama fix + yuvarlak 2 satır

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Kök neden:** Programatik scroll sonrası viewability / takvim momentum / `maintainVisibleContentPosition` listeyi eski konuma çekiyordu.
- **Uygulama:** `listScrollPinUntilRef` + uzun hold; goToToday animasyonsuz; MVP kaldırıldı; takvim momentum pin sırasında yok sayılır; FAB 64 daire, “Bugüne / dön”.
- **Doğrulama:** Geçmişe kaydır → Bugüne dön → listede bugünde kalmalı.
- **Koruma:** Takvim gün seçimi / liste penceresi aynı.

### 2026-09-17 — Takvim: nöbet turuncu yalnız uçuşsuz günlerde

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Amaç:** Nöbet→uçuş günlerinde turuncu kalksın; hâlâ nöbet / uçuşa dönmemiş nöbet turuncu kalsın.
- **Uygulama:** `standby` set geri; aynı günde `flightCount > 0` ise standby çizgisi bastırılır. Yatı / off / uçuş noktası aynı.
- **Doğrulama:** Kod incelemesi — bastırma döngüsü + barKind önceliği.
- **Koruma:** Liste nöbet kartları / görev tebliği aynı.

### 2026-09-17 — Bugüne dön FAB: metin + scroll fix

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Amaç:** FAB’da ikon yok, “Bugüne dön”; kompakt pill; basınca liste hedefe otursun.
- **Uygulama:** `roster.backToToday`; `goToToday` içinde `listPastDaysBack` reset kaldırıldı (scroll yarışı).
- **Doğrulama:** Geçmiş/gelecek güne kaydır → FAB → bugün.
- **Koruma:** Focus’ta pencere daraltma aynı.

### 2026-09-17 — Admin test: karşılıklı crew peer yeniden onay

- **Dosyalar:** (kod yok; üretim `crew_peer_links` service_role güncellemesi)
- **Amaç:** Güvenlik hardening’in revoke ettiği admin/test karşılıklı peer çiftini, açık operatör isteğiyle yeniden `approved` yapmak.
- **Uygulama:** Aynı seed `created_at` penceresindeki iki satır (`follower↔peer` karşılıklı) `status=approved`.
- **Doğrulama:** İki satır `approved`; her iki follower tarafında peer görünüyor.
- **Koruma:** Diğer kullanıcıların peer link’leri ve hardening migration’ı değiştirilmedi; genel seed revoke politikası geri alınmadı.

### 2026-09-17 — Bugün floating FAB (sağ alt)

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Bugün kontrolünü header yerine sağ alt floating tuş yapmak.
- **Uygulama:** `todayFab` absolute, tab bar üstü (`insets.bottom + 76`); yalnız `selectedDate !== today` iken; header chip kaldırıldı.
- **Doğrulama:** Simülatör — geçmiş güne kaydırınca sağ altta Bugün FAB.
- **Koruma:** Takvim ayırıcı + `goToToday` aynı.

### 2026-09-17 — Admin kısa mobil URL `/admin/`

- **Dosyalar:** `.github/workflows/deploy-support.yml`, `support/index.html`
- **Amaç:** Mobil Chrome’da uzun dosya adını “bulamama” / Google aramasına düşme.
- **Uygulama:** Pages’e `admin/index.html`; destek sayfasında büyük buton + kısa link.
- **Doğrulama:** Deploy sonrası `…/flyfam/admin/` 200.
- **Koruma:** Eski `ADMIN_STATUS_DASHBOARD.html` yolu kalır.

### 2026-09-17 — Bugün görünür + ayırıcı takvim altı

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Bugün chip’i her zaman ay satırı sağında görünsün; ayırıcı takvim bloğunun en altına full-bleed çizgi olarak otursun.
- **Uygulama:** `inlineCalendarHeaderRight` (Bugün + sync); Bugün bugündeyken muted; `calendarRosterSep` FlatList’ten sonra, `marginHorizontal: -12`, `borderTopWidth: 2`.
- **Doğrulama:** Simülatör — başlıkta Bugün; takvim gün çizgilerinin altında net ayırıcı.
- **Koruma:** `goToToday` / liste penceresi aynı.

### 2026-09-17 — Bugün: ay satırına taşındı

- **Dosyalar:** `mobile/screens/Roster.tsx`
- **Amaç:** Ayırıcı satırındaki chip yerine iOS Takvim tarzı konum.
- **Uygulama:** `Bugün` ay başlığı ile sync meta arasında; yalnız `selectedDate !== today` iken; ayırıcı yalnızca çizgi.
- **Doğrulama:** Simülatör — geçmiş güne gidince başlıkta Bugün, bugündeyken gizli.
- **Koruma:** `goToToday` / liste penceresi mantığı aynı.

### 2026-09-17 — Metro `@/` alias (bare metro)

- **Dosyalar:** `mobile/metro.config.js`
- **Kök neden:** `start-metro-direct.js` Expo CLI `tsconfigPaths` wrapper’ını atlıyor; `@/lib/supabase` çözülemiyordu.
- **Uygulama:** `resolver.resolveRequest` içinde `@/` → project root.
- **Doğrulama:** Simülatör Reload — SessionContext bundle.
- **Koruma:** Relative import’lar ve node_modules çözümlemesi aynı.

### 2026-09-17 — Admin mobil boş/açılmama düzeltmesi (ui=53)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`
- **Kök neden:** Mobil CSS’te `.nav-scrim { display:none }` media query’yi eziyordu; rail grid içinde yer kaplayıp içeriği itebiliyordu; üst bar grid+order mobilde kırılgandı.
- **Uygulama:** Shell `display:block`; rail fixed + kapalıyken `visibility/pointer-events` kapalı; cmd-bar flex kolon; scrim `display:block !important` mobilde; UI `53`.
- **Doğrulama:** Stil brace dengesi 0; tek `@media 1100/760`; Pages deploy.
- **Koruma:** Masaüstü rail/grid aynı.

### 2026-09-17 — Admin panel mobil + Pages yayın (ui=52)

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html`, `support/index.html`, `docs/CURSOR_CHANGE_HANDOFF.md`
- **Amaç:** Telefon/tablet’te kullanılabilir admin; güncel paneli GitHub Pages’e almak.
- **Uygulama:** Hamburger + sol slide menü + scrim; üst bar/form/tablo dokunmatik düzen; UI `52`. Deploy: `Deploy support site` workflow (`support/` + kopyalanan dashboard).
- **Doğrulama:** Kod incelemesi; push sonrası workflow + `?ui=52` cache bust.
- **Koruma:** Admin API / `data-view` ID’leri aynı; masaüstü rail davranışı korunur.

### 2026-09-17 — Metro 127.0.0.1 bind (sim bağlantı)

- **Dosyalar:** `mobile/scripts/start-metro-direct.js`
- **Amaç:** Simülatörün `http://127.0.0.1:8081` isteğinin IPv6-only Metro dinlemesine takılmasını önlemek.
- **Uygulama:** `metro start --host 127.0.0.1`.
- **Doğrulama:** `lsof` → `127.0.0.1:8081 LISTEN`.
- **Koruma:** Roster UI / liste penceresi değişiklikleri aynı.

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
- Geçmiş RapidAPI eşleşmeleri daha önce kaynaklardan kaldırılan değerlerdir; sağlayıcı panelinde aktif Authorization Key bulunmadığı ayrıca doğrulanmıştı. Firebase/GCP istemci anahtarı kısıtlaması aşağıdaki `firebase-restrict` çalışmasıyla tamamlandı. Supabase anon JWT istemci için yayımlanabilir anahtardır; güvenlik RLS ve server authorization ile sağlanır.
- Güncel diff'in yalnız eklenen satırlarına yapılan Gitleaks taraması sıfır sızıntı döndürdü. Ignore kapsamındaki `.env`, Firebase service-account JSON ve yerel tester listeleri repoya alınmamalıdır.

## 2026-09-17 — Firebase / Google Cloud Android API anahtarı sertleştirmesi

- Google Play Console'daki FlyFam **uygulama imzalama anahtarının üretim SHA-1** parmak izi alındı.
- Bu parmak izi Firebase Console'da Android uygulaması `com.flyfam.app` kaydına eklendi ve SHA-1 satırı görünerek doğrulandı.
- Firebase'in otomatik oluşturduğu Android API anahtarının Google Cloud **Application restrictions** ayarı `Android apps` olarak değiştirildi.
- İzin verilen tek Android uygulaması `com.flyfam.app` + Google Play üretim SHA-1 kombinasyonu olarak kaydedildi.
- Mevcut **25 API restriction** seçimi değiştirilmedi.
- Anahtar ayrıntısı yeniden açıldı; Android kısıtlamasının kalıcı olduğu doğrulandı.
- Bu güvenlik ayarı debug/yanlış imzalı APK'ların ilgili Firebase istemci anahtarını kullanmasını engeller. Play Store üretim imzası desteklenir. Yeni yapılandırmanın Google altyapısına yayılması yaklaşık 5 dakika sürebilir.

## 2026-09-17 — Admin yetkilendirme üretim regresyonu

- `admin-dashboard` üretim uç noktasında `check_access` için kimliksiz istek HTTP 401 ile reddedildi.
- Sahte JWT ile gönderilen aynı istek HTTP 401 ile reddedildi.
- `admin-panel-login` yanlış parola isteğini HTTP 401 ile reddetti.
- Mevcut yetkili admin panel oturumu canlı operasyon verilerini yeniden yükledi; arayüz `Oturum açık` ve `OK` sonucu gösterdi.
- `admin-auth` Route to Live maddesi tamamlandı.
- Önemli takip işi: yayımlanmış admin paneli hâlâ kişisel GitHub Pages alanından açılıyor. Bu durum `public-domain` maddesi kapsamında `flyfamapp.com` marka alanına taşınmalı; mevcut işlev ve auth akışı taşıma sırasında korunmalı.
- `mobile/lib/crewPeerDemo.ts` içindeki şahsi isimler, kullanıcı/crew UUID'leri ve hardcoded karşılıklı demo fallback kaldırıldı. Dosyanın mevcut public API'si korunarak yalnız `get_my_approved_crew_peers` sunucu sonuçları gösteriliyor.
- Mobil admin yetkisi hardcoded e-posta yerine `admin-dashboard` / `check_access` sunucu kontrolüne taşındı. `ADMIN_DASHBOARD_ALLOWED_EMAILS` yalnız Supabase secret olarak kalır. `admin-dashboard`, `admin-panel-login` ve `sync-fr24-usage-metrics` üretime deploy edildi; yetkisiz kontrol HTTP 401 döndürdü.
- Admin panel HTML içindeki kişisel e-posta/session alanı ve backend fallback e-postaları kaldırıldı. Bilinen şahsi ad/e-posta varyasyonları çalışma ağacında sıfır sonuç verdi.
- Genel TypeScript kontrolü mevcut, önceden kayıtlı router/tip sorunları nedeniyle başarısız; bu değişikliklerde yeni raporlanan tip hatası yok. `typescript-clean` Route maddesi açık kalır.

## 2026-09-21 — Markalı kamusal URL geçişi hazırlandı

- Kamusal FlyFam yüzeyi için kök `flyfamapp.com` sitesini bozmadan `app.flyfamapp.com` alt alanı seçildi.
- `support/CNAME` eklendi. GitHub Pages yayını bağlandığında destek, yasal metinler, auth callback ve admin yedeği bu markalı alan altında çalışacak.
- Mobil `authRedirect` ve `legalUrls`, `admin-dashboard` callback fallback'i, Supabase doğrulama/şifre sıfırlama e-posta şablonları ve şablon üretim scripti `https://app.flyfamapp.com` adresine geçirildi.
- `support/index.html` içindeki kişisel GitHub admin yedeği markalı `/admin/` adresiyle değiştirildi. Base44 ve destek dağıtım belgelerindeki aktif kişisel URL'ler temizlendi; özel EAS hesap bağlantıları handoff dokümanından çıkarıldı.
- Bilinen kişisel kullanıcı adı çalışma ağacında sıfır sonuç veriyor. Generic GitHub Pages örnekleri kişisel kimlik içermediği için yalnız tarihsel/teknik açıklamalarda kalabilir.
- Henüz canlıya alınmadı. Cursor bu URL'leri eski kişisel hosta geri çevirmemeli. Sıradaki adımlar: Cloudflare `app` CNAME, GitHub Pages custom domain, canlı HTTPS testi, Supabase Redirect URLs ve üretim e-posta şablonları.

## 2026-09-21 — Auth e-posta şablonları yeni tasarıma geçirildi

- `scripts/build-auth-email-templates.py` yeni FlyFam tasarım sistemine göre güncellendi: `#0F1B3D → #173E91 → #1A5CF5` başlık gradienti, kompakt logo, uçuş rotası motifi, geniş mavi CTA ve sade hesap kartı.
- Kayıt doğrulama ve şifre sıfırlama metinleri TR/EN olarak kısaltılıp profesyonelleştirildi. Türkçe ana işlem, İngilizce yardımcı etiket ve güvenlik açıklaması aynı e-postada korunuyor.
- `supabase/templates/confirmation.html` ve `recovery.html` HTTPS Storage logosu kullanılarak yeniden üretildi. Bağlantılar `https://app.flyfamapp.com/auth-callback.html` hedefini koruyor.
- Her iki şablon yerel tarayıcıda görsel olarak doğrulandı; üretim Supabase Email Templates ekranına henüz kaydedilmedi.
- Cursor bu oluşturulmuş HTML'leri elle eski stile çevirmemeli; değişiklik gerekiyorsa önce üretici script güncellenip şablonlar yeniden üretilmeli.

## 2026-09-21 — Auth e-postaları sıfırdan yeniden tasarlandı

- Önceki kompakt gradient tasarım kullanıcı geri bildirimiyle terk edildi; `scripts/build-auth-email-templates.py` yeni premium e-posta sistemiyle baştan yazıldı.
- `supabase/email-assets/flyfam-email-confirmation-hero.jpg`: uçuş ekibi ile aile arasındaki bağı anlatan, kişisel veri ve marka içermeyen özgün geniş görsel.
- `supabase/email-assets/flyfam-email-recovery-hero.jpg`: güvenli hesap kurtarma ve rotaya dönüş temasını anlatan özgün geniş görsel.
- Şablon düzeni artık beyaz FlyFam başlığı → geniş hikâye görseli → Türkçe ana mesaj → tek güçlü CTA → hesap kartı → kompakt İngilizce açıklama → güvenli yedek bağlantı sırasını izler.
- Metinler tamamen yenilendi. Doğrulama `FlyFam'e hoş geldiniz`, şifre e-postası `Yeni şifrenizi belirleyin` başlığını kullanır; teknik jargon ve gereksiz tekrar azaltıldı.
- `scripts/upload-email-brand-assets.mjs` logo ile birlikte iki hero görselini de `admin-static/brand/` altına yükleyecek şekilde genişletildi.
- Görseller e-posta için 1200 px genişliğe ve yaklaşık 73–93 KB dosya boyutuna optimize edildi. Yerel doğrulama ve şifre yenileme önizlemeleri başarıyla render edildi.

## 2026-09-22 — Doğrulama ve şifre sıfırlama e-postaları production'a kaydedildi

- `flyfam-email-confirmation-hero.jpg` ve `flyfam-email-recovery-hero.jpg` üretim Supabase Storage alanına yüklendi; public HTTPS erişimleri HTTP 200 ile doğrulandı.
- Confirm signup şablonu `FlyFam — Hesabınızı doğrulayın / Confirm your account` konusu ve yeni FlyFam tasarımıyla production Supabase Auth Email Templates alanına kaydedildi. Sayfa yenileme sonrası konu ve yeni içerik kalıcı olarak doğrulandı.
- Reset password şablonu `FlyFam — Şifrenizi güvenle yenileyin / Secure password reset` konusu ve yeni FlyFam tasarımıyla production'a kaydedildi. Sayfa yenileme sonrası konu ve `Yeni şifrenizi belirleyin` içeriği kalıcı olarak doğrulandı.
- Her iki canlı şablon `https://app.flyfamapp.com/auth-callback.html` hedefini kullanıyor. Cursor bu adresleri eski kişisel GitHub Pages callback'ine geri çevirmemeli.
- Kalan e-posta işleri: invite, magic link ve email change şablonlarını aynı sisteme geçirmek; markalı host ve Supabase redirect izinleri canlı olduktan sonra gerçek Gmail, Apple Mail ve Outlook teslim/CTA testleri yapmak.
- Production Supabase Storage yüklemesi ve Email Templates kaydı henüz yapılmadı. Cursor, kullanıcı son tasarımı onaylamadan canlı şablonları değiştirmemeli.

## 2026-09-22 — Kalan Auth e-postaları aynı tasarıma geçirildi

- `scripts/build-auth-email-templates.py` artık doğrulama ve şifre sıfırlamaya ek olarak `invite.html`, `magic-link.html` ve `change-email.html` üretir. Oluşturulmuş HTML yerine her zaman önce üretici script değiştirilmelidir.
- Yeni şablonlar aynı beyaz FlyFam marka başlığını, TR/EN metin sistemini, tek ana CTA'yı ve Supabase Storage üzerindeki mevcut hero görsellerini kullanır.
- Bağlantı türleri sırasıyla `invite`, `magiclink` ve `email_change`; hedef `https://app.flyfamapp.com/auth-callback.html` olarak sabittir.
- `mobile/lib/authRedirect.ts` ile `mobile/lib/authSessionFromUrl.ts` bu üç token türünü tanıyacak şekilde genişletildi. Mevcut signup/recovery davranışı korunmalıdır.
- `supabase/config.toml` ve `supabase/templates/README.md` üç yeni şablon/konu ile güncellendi.
- Dosyalar yerelde hazır, fakat bu üç yeni şablon henüz production Supabase Email Templates alanına kaydedilmedi. Canlı kayıt öncesinde kullanıcı onayı alınmalıdır.
- Python üretici derleme kontrolü ve `git diff --check` geçti. Proje geneli TypeScript kontrolü bu değişikliklerden bağımsız mevcut Expo Router ve eski tip hataları nedeniyle hâlen temiz değil.

## 2026-09-24 — Kalan Auth e-postaları production'a kaydedildi

- Kullanıcı onayıyla Invite user, Magic link ve Change email address şablonları production Supabase Auth yapılandırmasına Management API üzerinden kaydedildi.
- Canlı yapılandırma yeniden okunarak üç şablonun konusu, yeni FlyFam HTML içeriği ve `app.flyfamapp.com/auth-callback.html` hedefi ayrı ayrı `VERIFIED` sonucu verdi.
- Tekrarlanabilir ve kontrollü yayın/doğrulama için `scripts/configure-supabase-auth-email-templates.mjs` eklendi. Varsayılan olarak confirmation/recovery alanlarına dokunmaz; yalnız invite, magic link ve email change alanlarını yönetir.
- Sıradaki e-posta işi gerçek Gmail, Apple Mail ve Outlook teslim/görsel/CTA testleridir. Davet testi yeni kullanıcı oluşturabileceği, e-posta değişikliği testi de hesap bilgisini değiştirebileceği için hedef hesap belirlenmeden otomatik çalıştırılmamalıdır.

## 2026-09-24 — Production magic-link Gmail testi başlatıldı

- Kullanıcı onayıyla özel test posta kutusu için production Supabase `/auth/v1/otp` akışı `create_user:false` ve `https://app.flyfamapp.com/auth-callback.html` dönüş adresiyle çağrıldı.
- Supabase isteği HTTP 200 ile kabul etti. Bu yalnız sunucunun e-postayı kabul ettiğini kanıtlar; gerçek teslim, e-posta istemcisindeki görsel görünüm ve CTA/deep-link sonucu kullanıcı teyidi bekliyor.

## 2026-09-24 — Markalı Auth callback alan adı canlıya alındı

- Magic-link e-postasındaki CTA'nın uygulamayı açmamasının kök nedeni bulundu: `app.flyfamapp.com` için DNS kaydı yoktu; istek uygulama köprüsüne hiç ulaşmıyordu.
- Kullanıcı onayıyla Cloudflare DNS'e markalı `app` CNAME kaydı `DNS only`, `TTL Auto` olarak eklendi ve dış DNS çözümlemesinde doğrulandı.
- Kullanıcı onayıyla GitHub Pages özel alan adı `app.flyfamapp.com` olarak ayarlandı. GitHub sertifikası `approved` durumuna ulaştı.
- `https://app.flyfamapp.com/auth-callback.html` dış ağdan HTTP 200 döndürdü. E-posta şablonlarındaki markalı callback artık erişilebilir.
- GitHub Pages `https_enforced` henüz false. Sertifika çalışıyor; sıradaki güvenlik adımı HTTPS zorlamasını etkinleştirmek ve ardından gerçek CTA/deep-link testini tekrarlamaktır.

## 2026-09-24 — Markalı magic-link akışı uçtan uca doğrulandı

- DNS ve sertifika düzeltmesinden sonra production magic-link e-postası yeniden gönderildi; Supabase isteği HTTP 200 ile kabul etti.
- Kullanıcı, son e-postadaki CTA'nın telefonda FlyFam uygulamasını başarıyla açtığını doğruladı.
- Böylece Gmail teslimi, `app.flyfamapp.com` HTTPS köprüsü ve mobil deep-link zinciri magic-link akışı için uçtan uca çalışıyor.
- Confirmation ve recovery daha önce production'a kaydedilmiş olsa da markalı alan adı üzerinden telefon CTA testi ayrıca tamamlanmalı. Invite ve email-change testleri hedef hesapta yan etki oluşturabileceği için kontrollü yapılmalı.

## 2026-09-24 — GitHub Pages HTTPS zorlaması etkinleştirildi

- Kullanıcı onayıyla GitHub Pages `https_enforced` değeri `true` yapıldı.
- API tekrar okumasında custom domain `app.flyfamapp.com`, sertifika `approved` ve `https_enforced:true` doğrulandı.
- `http://app.flyfamapp.com/auth-callback.html` dış isteği `301` ile aynı adresin HTTPS sürümüne yönleniyor. Cursor bu ayarı kapatmamalı veya callback'i HTTP'ye çevirmemelidir.

## 2026-09-24 — Supabase Site URL ve redirect izinleri markalı alana taşındı

- Production Auth yapılandırmasında Site URL'nin hâlâ kişisel GitHub Pages adresini kullandığı ve yeni markalı adresin allowlist'te olmadığı tespit edildi.
- Kullanıcı onayıyla `site_url` değeri `https://app.flyfamapp.com/auth-callback.html` olarak değiştirildi.
- `uri_allow_list` içindeki eski kişisel GitHub Pages callback'i kaldırıldı; markalı callback eklendi. `flyfam://auth/callback`, `flyfam://**`, `com.flyfam.app://**` ve `com.flyfam.app://auth/callback` korundu.
- Management API tekrar okuması `verified:true` verdi. Route to Live içindeki auth callback alan adı taşıma maddesi OK yapıldı.

## 2026-09-24 — Production recovery akışı uçtan uca doğrulandı

- Kullanıcı isteğiyle özel test posta kutusuna production `/auth/v1/recover` üzerinden markalı callback kullanan yeni şifre sıfırlama e-postası gönderildi; istek HTTP 200 ile kabul edildi.
- Kullanıcı, e-postadaki CTA'nın FlyFam uygulamasını açtığını ve doğru yeni şifre belirleme ekranına yönlendirdiğini doğruladı.
- Recovery e-posta teslimi + markalı HTTPS köprü + mobil recovery deep-link zinciri çalışıyor. Bu akış eski giriş ekranı davranışına geri döndürülmemelidir.

## 2026-09-24 — Production signup confirmation akışı doğrulandı

- Kullanıcı onayıyla özel bir plus-address üzerinde rastgele, kaydedilmeyen güçlü parolayla geçici production crew hesabı oluşturuldu. Supabase signup isteği HTTP 200 döndü ve confirmation-required sonucu verdi.
- Kullanıcı, yeni tasarımlı doğrulama e-postasındaki CTA'nın FlyFam uygulamasını açtığını doğruladı. Signup confirmation → markalı HTTPS callback → mobil deep-link zinciri çalışıyor.
- Ara sayfanın İngilizce görünmesi bildirildi; uygulama başarıyla açıldığı için doğrulama zincirini engellemiyor. Köprü sayfasının dil deneyimi ileride cihaz/uygulama diline göre iyileştirilebilir.
- Geçici test hesabı daha sonra kullanıcı açık onayıyla production'dan kalıcı olarak silindi; aşağıdaki silme kaydı güncel durumdur.

## 2026-09-24 — Geçici signup test hesabı temizlendi

- Kullanıcının açık onayıyla yalnız geçici test e-postasının tam eşleşmesi olan Auth hesabı çözümlendi; eşleşme sayısı silme öncesinde tam olarak bir olarak doğrulandı.
- Hesabın doğrudan `flight_crew`, `crew_profiles` ve `profiles` kayıtları temizlendi; ardından Supabase Auth kullanıcısı kalıcı olarak silindi.
- Silme sonrasında aynı tam e-posta yeniden arandı ve sıfır eşleşme doğrulandı. Başka kullanıcı hedeflenmedi.
- Aynı kontrollü işlem için `scripts/delete-exact-test-user.mjs` eklendi. Script varsayılan çalışmada yalnız doğrulama yapar; kalıcı silme ancak açık `--confirm` parametresiyle gerçekleşir.

## 2026-09-24 — Kamusal marka alanı geçişi tamamlandı

- Aktif kaynaklar kişisel GitHub Pages adresi, kişisel e-posta ve bilinen şahsi ad varyasyonları için yeniden tarandı; çalışma kaynaklarında eşleşme bulunmadı.
- `https://app.flyfamapp.com/`, `privacy-policy.html`, `terms-of-use.html` ve `auth-callback.html` dış ağdan ayrı ayrı HTTP 200 döndürdü.
- Destek sayfası ayrı bir `support.html` değil, markalı alanın kök `/` sayfasıdır. Cursor mağaza veya uygulama desteği için var olmayan `/support.html` yolunu kullanmamalıdır.
- Route to Live içindeki `public-domain` maddesi OK yapıldı. Markalı URL'ler kişisel GitHub adresine geri çevrilmemelidir.

## 2026-09-24 — Auth e-postalarının Gmail CTA kapsamı tamamlandı

- Kullanıcının önceki canlı denemelerinde davet ve e-posta değişikliği CTA'larının da FlyFam uygulamasını açtığı doğrulandı. Böylece Gmail üzerinde signup, recovery, invite, magic-link ve email-change akışlarının tamamı markalı callback ile çalışıyor.
- Üretilen beş HTML şablonu tablo tabanlı yerleşim, inline stiller, 600 px içerik sınırı, açık HTTPS görselleri ve CTA çalışmazsa kullanılabilen yedek bağlantı içeriyor.
- Kullanıcı, istemci bazında Apple Mail/Outlook kontrolünü zorunlu yayın koşulu olarak sürdürmemeyi seçti. Gmail canlı testleri ve istemci uyumlu HTML yapısı yeterli kabul edilerek `email-template-refresh` Route to Live maddesi OK yapıldı. Cursor canlı HTML'leri veya üretici scripti eski tasarıma çevirmemelidir.

## 2026-09-24 — Mağaza medyası kişisel veri denetimi tamamlandı

- `docs/app-store-screenshots/marketing-v3/iphone-6.9-tr` altındaki 12 final iPhone adayı ve `docs/app-store-screenshots/ipad-13-tr` altındaki 3 iPad adayı toplu ve yakın görünümde incelendi.
- Final adaylarda görünür kişi adı, yüz veya e-posta bulunmuyor. Aile roster ve bildirim görsellerindeki kullanıcı adı bulanıklaştırılmıştır; uçuş verileri tanıtım örneği niteliğindedir.
- Route to Live `media-privacy` maddesi OK yapıldı. Store yüklemesinde yalnız bu anonim final klasörleri kullanılmalı; `source`, `raw`, `marketing-v1` ve `marketing-v2` içerikleri yeniden denetlenmeden yüklenmemelidir.

## 2026-09-24 — Markalı destek e-postası etkinleştirildi

- Cloudflare Email Routing `flyfamapp.com` için etkinleştirildi. `support@flyfamapp.com` adresi aktif olarak özel yönetim posta kutusuna yönleniyor; genel catch-all kapalı bırakıldı.
- Kamusal sayfalar, gizlilik/kullanım şartları, mobil roster destek bağlantıları, zorunlu güncelleme metinleri ve yayın scripti markalı destek adresine taşındı. Özel hedef adres kullanıcıya açık yüzeylerde gösterilmemelidir.
- Uygulanmış tarihsel migration geriye dönük değiştirilmedi. `20260924170000_brand_support_email.sql`, production `app_release_policy` satırını ve sütun varsayılanını ileri yönlü olarak günceller.
- Production `app_release_policy` satırındaki `android_invite_email`, Türkçe gövde ve İngilizce gövde yalnız bu kayıt hedeflenerek doğrudan güncellendi; eski Gmail adresinin canlı politikada kalmadığı yanıt üzerinden doğrulandı. Diğer bekleyen migrationlar bu işlem için topluca gönderilmedi.
- `support/` değişiklikleri yalnız ilgili dört dosyayı içeren `d0a0aee` commit'iyle `main` dalına gönderildi. GitHub Pages `Deploy support site` çalışması başarıyla tamamlandı; canlı ana sayfa, gizlilik politikası ve kullanım şartlarında `support@flyfamapp.com` ayrı ayrı doğrulandı.
- Cursor markalı destek adresini eski veya doğrulanmamış adreslere geri çevirmemeli; yeni kullanıcıya açık iletişim noktalarında `support@flyfamapp.com` kullanılmalıdır.

## 2026-09-26 — Aktif mobil TypeScript kapsamı temizlendi

- Gerçek production giriş zinciri `index.js → App.tsx` olarak doğrulandı. Paket tarafından kullanılmayan eski `app/` Expo Router ağacı ve bağımsız `scripts/` araçları mobil uygulamanın strict TypeScript kapsamından ayrıldı; bu dosyalar silinmedi.
- `allowImportingTsExtensions` etkinleştirilerek mobilin doğrudan kullandığı ortak Supabase/Deno roster parser modülleri doğru biçimde denetlenmeye devam ediyor.
- Supabase ilişki sonuçlarının dizi/tekil farkları `Connect` ve `Dashboard` ekranlarında normalize edildi. Havaalanı cache istemci tipi, auth hata kodları, root navigation fallback'i, native-stack header seçenekleri, paralel flight update thenable'ı, roster Supabase istemci tipleri/home-base dizisi/parked durumu ve Freebird görev saati null güvenliği düzeltildi.
- `npx tsc --noEmit --pretty false` sıfır hatayla tamamlandı. `npm run test:capacity`, `npm run verify:android:icon` ve ilgili dosyalarda `git diff --check` başarılı.
- Cursor `app/` ağacını yeniden production router olarak etkinleştirmeden TypeScript kapsamına geri eklememeli. CLI scriptleri için ileride ayrı Node/tsx tsconfig veya script bazlı test kapısı kullanılmalıdır.

## 2026-09-26 — Birikmiş çalışma ağacı düzenli checkpoint commitlerine ayrıldı

- Değişiklikler silinmeden önce `docs/WORKTREE_RELEASE_INVENTORY.md` oluşturuldu; mobil/native, backend/migration ve yayın dokümanı/anonim medya olarak üç ana grup tanımlandı.
- `4b23081 Stabilize mobile release candidate`: aktif mobil kod, native projeler, notification extension, üretim ses/ikonları ve TypeScript temizliği.
- `f012557 Checkpoint backend release changes`: Edge Functions, parserlar, migrationlar, admin backend ve Auth e-posta şablonları. Bu commit migration deploy edildiği anlamına gelmez.
- `a09ed4e Organize release documentation and assets`: Route to Live, Cursor handoff, yayın scriptleri ve yalnız anonimliği onaylanmış mağaza görselleri.
- `069663d Ignore local release preview artifacts`: ham/kişisel medya, simülatör kanıtı, yerel yedek, installer, ses denemesi ve Supabase CLI geçici dosyaları için ignore koruması.
- Her staged grup Gitleaks taramasında sıfır bulgu verdi. Format kontrolleri temizlendi ve işlem sonunda `git status --short` boş döndü.
- Cursor bu checkpointleri yeniden tek dev diff'e dönüştürmemeli; sonraki değişiklikleri aynı işlevsel sınırlar içinde küçük commitlerle sürdürmelidir.

## 2026-09-26 — Tek komutluk yayın doğrulama kapısı eklendi

- Kök `package.json` içine `npm run verify:release` komutu ve `scripts/verify-release.mjs` denetleyicisi eklendi.
- Kapı Expo config, Xcode project ve Gradle içindeki sürüm/build değerlerini karşılaştırır; aktif strict TypeScript, aile kapasitesi, Android ikon, `git diff --check`, son commit + bekleyen değişiklik Gitleaks kontrollerini çalıştırır.
- Ardından iOS ve Android için production Expo exportu üretir; çıktı yalnız sistem geçici klasöründe tutulur ve başarı/hata sonunda temizlenir. Hızlı yerel tur gerekirse script doğrudan `--skip-export` kabul eder; gerçek release öncesinde export atlanmamalıdır.
- Tam kapı 1.3.0 (49) için çalıştırıldı: bütün kontroller, iOS Hermes bundle ve Android Hermes bundle başarıyla tamamlandı.
- Route to Live sürüm eşleme maddesi 45'ten güncel 49'a düzeltildi. Eski 45 EAS build kaydı tarihsel kanıt olarak korundu ancak güncel 49 store build alınmadığı için `eas-builds` maddesi yeniden açık duruma getirildi.

## 2026-09-26 — Production migration ön denetimi ve kimlik temizliği

- `supabase db push --dry-run --include-all` production migration ledgerında 8 bekleyen migration gösterdi: `20260916150000`, `20260916160000`, `20260916170000`, `20260916210000`, `20260920193000`, `20260920194500`, `20260924160000`, `20260924170000`.
- Salt-okunur production denetiminde arşiv toplamı 569, silme adayı 0 ve geri yükleme adayı 0 bulundu. İlgili dört fonksiyon, erken durum koruma triggerı, phase health ve markalı destek adresi zaten canlı. `occupation_catalog` anonim okuma politikası ise production'da eksik.
- `20260920194500_protect_premature_landed_trigger.sql` içindeki tek kullanıcı/uçuşa özel düzeltme kaldırıldı; migration artık yalnız genel şema davranışını değiştiriyor. Daha önce uygulanmış `20260824111000_crew_home_base_fields.sql` içindeki kişisel test hesabı seed'i, yeni ortamların kişisel kimlik üretmemesi için kaldırıldı.
- Dokümanlarda kalan kişisel ad, özel posta kutusu ve kişisel yayın URL kayıtları anonimleştirildi. Bilinen kişisel kimlik dizileri için kaynak taraması sıfır eşleşme verdi.
- Production'a henüz migration uygulanmadı. Sıradaki işlem, kullanıcıdan açık production onayı alındıktan sonra önce public şema yedeği almak ve ardından `--include-all` ile 8 migrationı uygulamaktır. Cursor bu onay olmadan production push yapmamalıdır.

## 2026-09-26 — Bekleyen production migrationlar uygulandı

- Kullanıcının açık production onayı alındı. Supabase CLI yedeği Docker bulunmadığı için başlayamadı; migration uygulanmadan duruldu. Bunun üzerine yalnız PostgreSQL istemci araçları kuruldu ve production `public` şeması `/tmp/flyfam-pre-migration-20260926.sql` dosyasına alındı.
- Yedek 217092 bayt ve SHA-256 `8248a6f34daee8dbea763ea36e29b32578bfe140d02873cbbe2f242e635df423` olarak doğrulandı. `/tmp` geçici alandır; kalıcı felaket kurtarma kopyası olarak kabul edilmemelidir.
- Önceden denetlenen 8 migration `supabase db push --include-all` ile başarıyla uygulandı. `supabase migration list` çıktısında sekiz sürümün tamamı Local/Remote eşleşiyor.
- Yeni `roster_occupation_catalog_meta_select_anon` davranışı, mobil uygulamanın gerçek anonim Supabase yapılandırmasıyla REST üzerinden test edildi; HTTP 200 ve bir katalog satırı döndü.
- Ön denetimde silme ve geri yükleme adayı sıfırdı. Push sırasında hata oluşmadı; arşiv üzerinde beklenmeyen veri işlemi raporlanmadı. Route to Live `migrations-prod` maddesi OK yapıldı.

## 2026-09-27 — Güncel Edge Functionlar production'a deploy edildi

- Production fonksiyon envanteri yerel kaynaklarla karşılaştırıldı. Ortak modül veya doğrudan kaynak değişikliği bulunan sekiz fonksiyon kullanıcı açık onayıyla deploy edildi: `admin-dashboard`, `admin-panel-login`, `check-flight-status-and-notify`, `flight-lookup`, `notify-family`, `parse-roster-pdf`, `sync-fr24-usage-metrics`, `sync-hub-airport-boards`.
- Deployların tamamı hatasız sonuçlandı. Son production envanterinde sırasıyla sürümler 75, 8, 127, 97, 109, 134, 32 ve 47; sekizinin de durumu `ACTIVE`, güncelleme tarihi 2026-09-27.
- `subscription-status`, `validate-apple-subscription` ve `validate-google-subscription` yerelde dosya içermeyen eski klasörlerdir; deploy edilmedi. Aktif satın alma doğrulama fonksiyonu `verify-store-purchase` production'da mevcuttur.
- Docker'ın çalışmıyor uyarısı deployu engellemedi; Supabase CLI varlıkları doğrudan paketleyip production'a yükledi. Route to Live `functions-prod` maddesi OK yapıldı.

## 2026-09-27 — Crew peer "kaldır" sunucuda takibi iptal ediyor

- Sorun: Family ekranındaki crew peer "kaldır" işlemi yalnız `dismissDemoPeer` ile cihazda gizliyordu; `crew_peer_links` satırı `approved` kaldığı için `notify-family` takip edilen crew'un uçuş bildirimlerini göndermeye devam ediyordu.
- `supabase/migrations/20260927210000_unfollow_crew_peer.sql`: `unfollow_crew_peer(p_peer_crew_id)` security definer RPC; yalnız `auth.uid()` takipçisinin satırını `revoked` yapar. anon=false, authenticated=true. Production'a `db query -f` ile uygulandı ve `migration repair` ile geçmişe işlendi (başka oturumun `20260927200000_restore_…` dosyasıyla sürüm çakışmasın diye 210000 kullanıldı).
- `mobile/lib/crewPeerDemo.ts`: `unfollowCrewPeer(userId, peer)` RPC'yi çağırır; başarısızlık/offline durumda yerel dismiss'e düşer. `hydrateCrewPeersFromServer`, daha önce yerelde gizlenmiş ama sunucuda hâlâ approved olan bağlantıları otomatik revoke eder (eski build'lerde kaldırılanlar yeni JS ile temizlenir). `hydrateDismissedPeers` memoize edildi.
- `mobile/screens/Family.tsx`: `unlinkCrewPeer(peer)` artık `unfollowCrewPeer` çağırıyor.
- Veri: kullanıcı talebiyle ilgili tek takip bağlantısı (`d0c1343c…`) production'da `revoked` yapıldı; o peer için bu takipçiden approved kayıt kalmadı.
- Doğrulama: rollback transaction içinde takipçi JWT'siyle RPC 1 satır revoke etti (OK); `npx tsc --noEmit` OK.
- Korunacak davranış: `request_crew_peer_follow` revoked→pending yeniden takip akışı değişmedi; peer tarafı onayı yine gerekli. Store build 49'daki "kaldır" hâlâ yalnız yerel; yeni JS/build gelene kadar sunucu revoke olmaz.

## 2026-09-27 — Şifre yenileme ve Kurulumu tamamla ekranları yeni temaya taşındı

- `mobile/screens/ResetPassword.tsx`: eski düz input/buton yerine `ScreenPageHeader` (başlık + alt başlık, geri yok), kilit ikonlu hero, `FormField` (göz toggle, `newPassword` autofill), `PrimaryButton` ve iOS `FormKeyboardAccessory`. Doğrulama/`updateUser`/`clearPasswordRecovery` mantığı aynı.
- `mobile/screens/CompleteProfile.tsx`: `EditProfile` ile aynı `FormCard` satır düzeni (havayolu seçici, Base, ICAO), tema modal, alt sabit `PrimaryButton`. Kayıt mantığı (`crew_profiles` update / `create_crew_profile` RPC, ICAO 12, base 4 karakter) aynı; havayolu listesi EditProfile gibi alfabetik.
- `mobile/components/ScreenPageHeader.tsx`: opsiyonel `showBack` (varsayılan `true`); mevcut çağıranlar değişmedi.
- `mobile/App.tsx`: iki ekranın eski mavi stack header'ı `headerShown: false` ile kapatıldı (auth ekranlarıyla aynı).
- Doğrulama: `npx tsc --noEmit` OK. Cihazda görsel kontrol yapılmadı (ekranlar recovery linki / crew profili olmayan hesap gerektiriyor).

## 2026-09-27 — Roster "indi" kartında kaydırınca şeffaflık düzeltildi

- Sorun: `RosterFlightCard` landed arka planı yarı saydam yeşil (`rgba(…,0.06)`), geçmiş kartlar `opacity 0.72`. Swipeable aksiyon panelleri (Sil/Senkronize) kartın arkasında olduğundan kaydırırken kart şeffaf görünüyor, kırmızı panel içinden karışık görünüyordu.
- `mobile/screens/Roster.tsx`: Swipeable içindeki kart sarmalayıcısına sayfa arka planıyla aynı opak zemin (`swipeCardBase`, `radius.card`) eklendi. Dinlenme hâlindeki görünüm aynı (renk sayfa arka planı), kaydırmada panel kartın içinden görünmüyor. Swipe yükseklik ölçümü (`swipeCardHeights`) aynı View'da korunuyor.
- Doğrulama: `npx tsc --noEmit` OK. Cihazda görsel kontrol kullanıcıya bırakıldı (Metro reload yeterli).

## 2026-09-27 — Roster boş gün (OFF) kartı yükseltildi

- `mobile/components/roster/RosterFlightCard.tsx`: tek satırlı OFF kompakt kartına `compactBodyOff` (`minHeight: 60`, dikey ortalama) eklendi; iki satırlı nöbet/eğitim kartlarına yakın yükseklik. Yatı ve diğer kompakt kartlar değişmedi; büyük font ölçeğinde kart doğal olarak uzamaya devam eder.
- Liste konumlandırma ölçülen yükseklikleri kullandığı için `estimateListItemHeight` değiştirilmedi.
- Doğrulama: `npx tsc --noEmit` OK. Cihazda görsel kontrol kullanıcıya bırakıldı.

## 2026-09-27 — Roster kompakt kartlarında yazı ve yükseklik birleştirildi

- `mobile/components/roster/RosterFlightCard.tsx` (önceki OFF-only `compactBodyOff` kaydının yerini alır): tüm kompakt kartlar (Boş gün, Yatı, Nöbet, Eğitim) için rozet 12→13 (padding 9/3), ana satır `fs(15)`→`fs(17)`, saat satırı `fs(14)`→`fs(15)`; `compactBody` ortak `minHeight: 66` ve dikey ortalama. Uçuş kartları değişmedi.
- `fs` hâlâ `scaleListBodyText` ile kullanıcı yazı ölçeğine bağlı; büyük ölçekte kartlar uzamaya devam eder.
- Kart yalnız `Roster.tsx` içinde kullanılıyor. Doğrulama: `npx tsc --noEmit` OK. Cihazda görsel kontrol kullanıcıya bırakıldı.

## 2026-09-27 — Roster'da istemeden bugüne dönüş düzeltildi

- Sorun 1: Roster `useFocusEffect` her odakta listeyi bugüne sıfırlayıp FlatList'i remount ediyordu; karta basıp EditFlight/EditDuty/AdminFlightApiDebug'dan geri dönmek de odak sayıldığı için kullanıcı gezdiği günden bugüne atılıyordu.
- Sorun 2: Aynı callback `route.params.addedFlightDate` dep'ine bağlıydı; anchor effect paramı `setParams(undefined)` ile temizleyince callback odaktayken yeniden çalışıp uçuş eklenen günden bugüne atıyordu.
- `mobile/screens/Roster.tsx`: `preserveListOnNextFocusRef` kart `onCardPress`'te set edilir; sonraki odakta (addedFlightDate yoksa) reset atlanır. `addedFlightDate` ref'ten okunur, focus callback dep'i `[]`.
- Korunacak davranış: sekme dönüşü ve Bugün FAB bugüne hizalar; AddFlight dönüşü eklenen güne hizalar; veri yükleme focus effect'i değişmedi.
- Doğrulama: `npx tsc --noEmit` OK. Cihazda davranış testi kullanıcıya bırakıldı.

## 2026-09-27 — Roster'da kaydırırken kendiliğinden bugüne atlama düzeltildi

- Kök neden: açılış anchor effect'i `scrollTargetDateRef = today` değerini hemen yazıp pin'i `InteractionManager` ile erteliyordu. Geçiş sırasında `listData` değişince effect cleanup handle'ı iptal ediyor, pin hiç çalışmıyor ama hedef takılı kalıyordu (`pendingRosterAnchorRef` de tüketilmiş). Sonra her `listData` değişiminde (3 dk API poll, realtime) "boş gün başlığı" effect'i ve `recordListItemHeight` listeyi bugüne çekiyor; `onViewableItemsChanged` takvim senkronunu da engelliyordu.
- `mobile/screens/Roster.tsx`:
  - Anchor effect: pin çalışmadan iptal edilirse hedef temizlenir ve `pendingRosterAnchorRef` geri konur (bir sonraki çalıştırmada tek sefer pin).
  - `onListScrollBeginDrag`: kullanıcı sürüklemeye başlayınca `listUserDragEpochRef` artar; `scrollTargetDateRef`, `pendingListScrollDateRef`, `pendingRosterAnchorRef`, pin süresi ve bekleyen timer'lar temizlenir. Bekleyen anchor pin'leri epoch değiştiyse çalışmaz. Swipe kapatma aynı handler'da korunuyor.
- Korunacak davranış: açılış/sekme dönüşü, Bugün FAB, takvim gününe basma ve AddFlight dönüşü hizalamaları; kullanıcı sürüklemesi her zaman önceliklidir.
- Doğrulama: `npx tsc --noEmit` OK. Cihazda davranış testi kullanıcıya bırakıldı.

## 2026-09-27 — Store 1.3.0 (50) build + submit (iOS + Android)

- **Dosyalar:** `mobile/app.config.js` (buildNumber/versionCode 50), `mobile/android/app/build.gradle` (versionCode 50), `mobile/ios/FlyFam.xcodeproj/project.pbxproj` (CURRENT_PROJECT_VERSION 50 ×6). Marketing 1.3.0 değişmedi.
- **İçerik:** peer unfollow sunucu revoke, ResetPassword/CompleteProfile yeni tema, landed kart swipe şeffaflık düzeltmesi, kompakt kart yazı/yükseklik, roster'da istemeden bugüne dönüş düzeltmeleri, swipe/clear/import race düzeltmeleri.
- **Ön kontrol:** `npx tsc --noEmit` OK, `verify:android:icon` OK, `test:capacity` OK, `git diff --check` OK.
- **Komut:** `eas build --platform all --profile production --auto-submit --non-interactive` (exit 0).
  - Android build `40a87375…` FINISHED 1.3.0/50 — submission `92e0132a…` tamamlandı (Play internal).
  - iOS build `0471a8d6…` FINISHED 1.3.0/50 — submission `8a795857…` App Store Connect'e yüklendi (Apple işliyor).
- **Not:** Fingerprint ExpoConfigLoader uyarısı yine non-fatal. EAS build kredisinin %80'i kullanıldı uyarısı görüldü.
- **Koruma:** Marketing 1.3.0 / build 50; sonraki yükleme ≥51 olmalı.

## 2026-09-29 — Admin Ops Console ui=58 yayınlandı (yalnız admin commit)

- Kullanıcı kararı: yerel `main`'deki 15 push edilmemiş commit (RLS, StoreKit trial, demo hesaplar, release dokümanları, `support/CNAME` vb.) **yerelde bırakıldı**; yalnız ui=58 dosyaları push edildi.
- Yöntem: `origin/main` üzerinde geçici worktree; `docs/ADMIN_STATUS_DASHBOARD.html`, `support/admin/index.html`, `support/index.html`, `supabase/functions/admin-panel-ui/index.ts` çalışma ağacından; `supabase/functions/admin-dashboard/index.ts` için yalnız «Peer review» hunk'ı (yerel `f012557`'deki e-posta/check_access/occupation değişiklikleri dahil edilmedi). Commit `132a47b` → `origin/main` (fast-forward).
- Doğrulama: `git diff --check` OK; "Deploy support site" run `36523683860` success; `app.flyfamapp.com/admin/` 200 ve `var UI = '58'`, `runBulkAction`/`Peer review` mevcut; destek sayfası `adminUi = '58'`; `admin-panel-ui` 302 → `app.flyfamapp.com/admin/?ui=58`.
- Not: Yerel `main` artık `origin/main` ile ayrıştı (yerel 15 commit, uzak 1 commit). Sonraki push öncesi `git pull --rebase` gerekir; ui=58 yaması çalışma ağacındakiyle aynı olduğu için çakışma beklenmez. Toplu aksiyonlar gerçek veriyle canlıda henüz denenmedi.

## 2026-09-29 — Roster: Rezerv rozeti + CFR rezerv gibi gösteriliyor

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/components/roster/RosterFlightCard.tsx`, `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Sorun:** RSV/RZV/RZVM kartı «Nöbet» rozetiyle çıkıyordu (hesaplanan «Rezerve» etiketi nöbet kartında kullanılmıyordu). THY `CFR` (Potansiyel Görev) hiçbir gruba girmediği için gri «Boş» kartı olarak, saatsiz ve takvimde boş gün rengiyle görünüyordu.
- **Uygulama:**
  - Kart modeline opsiyonel `standbyBadgeLabel`; nöbet kompakt kartında rozet metni onu kullanır, yoksa «Nöbet» (mevcut davranış).
  - Rezerv kodları `/^RSV\d*$/`, `RZV`, `RZVM` → rozet `roster.statusReserve` («Rezerv» / «Reserve»).
  - `CFR` (`duty_off`) → rezervle aynı nöbet kartı (turuncu şerit, üs istasyonu, tarih · saat aralığı, crew için «Uçuşa dönüştür»), rozet «CFR». Takvimde `standby` (turuncu çizgi); yatı arası günlerde isimli görev olarak gizlenmez.
  - Paylaşılan `isStandbyOccupationCode` değiştirilmedi (PDF import / duty-window mantığı etkilenmesin); CFR yalnız Roster görünümünde `isCfrDutyCode` ile ele alınıyor.
- **Doğrulama:** `npx tsc --noEmit` OK; locale JSON parse OK; `git diff --check` OK. Cihazda görsel kontrol yapılmadı (CFR satırı olan THY roster gerekiyor).
- **Koruma:** HSBY/SBY/STBY vb. nöbet kartları «Nöbet» rozetiyle aynı; COTD «Görev» rozeti aynı; CFR'den «Uçuşa dönüştür» mevcut standby atama akışını (AddFlight `replaceStandbyFlightId` + aileye nöbetten görev bildirimi) kullanır.

## 2026-09-29 — Roster: CFR tüm gün + netleşme notu

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/components/roster/RosterFlightCard.tsx`, `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Ürün kuralı (kullanıcı):** CFR tüm günü kapsar; bir önceki gün 01:00Z'de uçuşa veya boş güne döner.
- **Uygulama:** CFR kartında saat aralığı yerine `{gün ay} · Tüm gün`. Kart modeline opsiyonel `standbyNoteLine` (nöbet kartında saat satırı altında soluk tek satır). CFR günü geçmemişse: netleşme anı `(flight_date − 1)T01:00Z` gelecekteyse «Netleşme: 29 Eylül 04:00 · uçuş veya boş gün» (üs TZ; UTC görünümünde `01:00Z`), geçmişse «Netleşti · roster'ı güncelle». Geçmiş CFR kartında not yok.
- **Doğrulama:** `npx tsc --noEmit` OK; locale JSON OK; Node'da `2026-09-29T01:00Z` → İstanbul `2026-09-29 04:00` OK; `git diff --check` OK. Cihazda görsel kontrol yapılmadı.
- **Koruma:** Diğer nöbet/rezerv kartları saat aralığıyla aynı; `standbyNoteLine` yoksa kart düzeni değişmez. Veri/import tarafına dokunulmadı.

## 2026-09-29 — Roster: CFR kartına «Boş gün yap»

- **Dosyalar:** `mobile/screens/Roster.tsx` (`runCfrToOffDay`, `openCfrToOffDay`), `mobile/components/roster/RosterFlightCard.tsx` (`onOffDayAction`, `standbyActions`, `offDayBtn`), `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Kullanıcı kararı:** CFR boş güne dönünce kartta «Uçuşa dönüştür» yanında «Boş gün yap» olsun.
- **Uygulama:** Yalnız crew, geçmemiş CFR kartında gri ay ikonlu ikinci buton. Onay sonrası: `add_me_to_flight('OFF', flight_date, …, CFR saatleri, 'duty_off')` → başarılıysa `remove_me_from_flight(cfrId)` → `refreshCrewListFromDb()`. CFR satırı doğrudan güncellenmez çünkü `flights` numara+tarihle ekipler arasında paylaşımlı (aynı gün CFR'si olan diğer ekip etkilenirdi); `remove_me_from_flight` son ekip çıkınca satırı siler. Aileye bildirim gönderilmez. Not satırı iki satıra çıkabilir (buton genişliği için).
- **Doğrulama:** `npx tsc --noEmit` OK; locale JSON OK; `git diff --check` OK. RPC imzası/parametre adları PDF import çağrısıyla aynı. Canlı DB'de ve cihazda denenmedi.
- **Bilinen etki:** Aynı gün mevcut paylaşımlı `OFF` satırı varsa `add_me_to_flight` onun `scheduled_*` alanlarını CFR saatleriyle günceller (PDF import davranışıyla aynı).
- **Koruma:** «Uçuşa dönüştür» akışı, diğer nöbet/rezerv kartları (tek buton) ve import aynı.

## 2026-09-29 — Roster: Rezerv de CFR gibi (netleşme notu + «Boş gün yap»); aile bildirimi kuralı

- **Dosyalar:** `mobile/screens/Roster.tsx`, `mobile/components/roster/RosterFlightCard.tsx`, `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Ürün kuralı (kullanıcı):** Rezerv, görev başlangıcından 10 saat önce uçuşa veya boş güne döner. CFR ve rezervde uçuş çıkarsa aileye bildirim gider; boş gün olursa gitmez.
- **Uygulama:**
  - Ortak `canConvertToOffDay` (CFR veya `/^RSV\d*$/`/RZV/RZVM nöbet kartı). Netleşme anı: CFR `(flight_date − 1)T01:00Z`; rezerv `scheduled_departure − 10 saat`. Rezerv kartı saat aralığını göstermeye devam eder, altına aynı not satırı gelir.
  - `runCfrToOffDay`/`openCfrToOffDay` → `runStandbyToOffDay`/`openStandbyToOffDay(item, dutyLabel)`; `roster.cfr*` anahtarları `roster.standby*` olarak yeniden adlandırıldı (yalnız bu oturumda eklenmişti). Onay metninde «Aileye bildirim gönderilmez».
  - Aile bildirimi: «Uçuşa dönüştür» zaten AddFlight `replaceStandbyFlightId` → `notifyFamilyStandbyAssigned` (Edge `standby_assigned`) yolunu kullanıyor; CFR ve rezervde bildirim gidiyor. «Boş gün yap» yalnız `add_me_to_flight` + `remove_me_from_flight` çağırır, `notify-family` çağrılmaz (bu RPC'lerde push tetikleyen trigger yok).
  - AddFlight'taki `remove_me_from_flight` sonrası `.delete()` paylaşımlı satırı başkalarından silemez: RLS «Allow delete when no crew on flight».
- **Doğrulama:** `npx tsc --noEmit` OK; locale JSON OK; eski `cfr*` anahtar referansı kalmadı; `git diff --check` OK. Canlı DB'de ve cihazda denenmedi.
- **Açık:** Aile push metni «…nöbetten uçuş verildi» — rezerv/CFR için de aynı metin gider (Edge değişikliği yapılmadı).
- **Ek (aynı gün):** `RosterFlightCard.tsx` buton sırası: «Boş gün yap» solda, «Uçuşa dönüştür» en sağda (`assignBtnInRow`). Tek butonlu nöbet kartlarında «Uçuşa dönüştür» yine en sağda. `tsc` + `git diff --check` OK.
- **Ek (kullanıcı kararı):** Netleşme notu kaldırıldı (bkz. aşağıda tebliğ hatırlatması) — `standbyNoteLine` prop/render, Roster'daki netleşme hesabı ve `roster.standbyDecisionAt`/`standbyDecisionPassed` anahtarları silindi. Yukarıdaki «CFR tüm gün + netleşme notu» kaydındaki not kısmı artık geçersiz; CFR «Tüm gün» satırı, rezerv/CFR «Boş gün yap» ve aile bildirimi kuralı aynı. `tsc`, locale JSON, `git diff --check` OK.

## 2026-09-29 — Crew: CFR / rezerv tebliğ saati yerel hatırlatması

- **Dosyalar:** yeni `mobile/lib/standbyDecisionReminders.ts`; `mobile/screens/Roster.tsx` (sync effect), `mobile/contexts/SessionContext.tsx` (çıkışta iptal), `mobile/locales/tr.json`, `mobile/locales/en.json`
- **Ürün kuralı (kullanıcı):** CFR → görev gününden bir önceki gün **02:00Z**; rezerv (`/^RSV\d*$/`, RZV, RZVM) → `scheduled_departure − 10 saat`. Yalnız crew kullanıcısına: «CFR (Rezerv) görevin için tebliğ saati geldi. Kontrol ettin mi?»
- **Uygulama:** Cihazda `expo-notifications` DATE trigger (sunucu/cron/migration yok). Kimlik `standby-decision:<flightId>`; `data.atMs/kind` + metin aynıysa korunur, değilse iptal/yeniden kurulur; roster'dan kalkan (uçuşa/boş güne çevrilen) görevin hatırlatması iptal edilir. Yalnız `duty_off` satırları, gelecek 45 gün, en fazla 30 bekleyen (iOS 64 sınırı). İzin istemez; izin yoksa zamanlamaz. Roster'da yalnız kendi roster'ı (`isCrew`, `!loading`, 1,5 sn debounce); peer sekmesi hiçbir şey iptal etmez. `signOut` ve `SIGNED_OUT` olayında hepsi iptal. Android kanal `default`.
- **Doğrulama:** `npx tsc --noEmit` OK; locale JSON OK; `git diff --check` OK. esbuild + sahte `expo-notifications` ile: CFR (D) → (D−1)T02:00Z, RSV1 03:00Z → önceki gün 17:00Z; HSBY / geçmiş CFR / `flight` türü atlandı; listeden kalkınca iptal; `cancelStandbyDecisionReminders` 0 bırakıyor. Cihazda gerçek bildirim denenmedi.
- **Sınırlar:** Yerel olduğu için yalnız roster'ı en son yükleyen cihazda çalar; uygulama açılmadan sunucuda değişen roster (ör. başka cihazda dönüştürme) bir sonraki açılışa kadar eski hatırlatmayı tutabilir. Aynı hesap birden fazla cihazda → her cihazda çalar.
- **Koruma:** Aile push'ları, `scheduleLocalTestNotification`, bildirim handler'ı ve kanallar aynı.

## 2026-10-01 — Cursor değişiklikleri commit + main rebase + push

- Commit `89c98b7` (rebase öncesi `b5da737`): roster scroll/swipe/clear-import düzeltmeleri, kompakt kartlar, ResetPassword/CompleteProfile tema, peer unfollow, Pegasus gece yarısı parser/import, `20260927180000` + `20260927210000` migration'ları, build 50 (`build.gradle`, `pbxproj` yalnız sürüm satırları), ilgili handoff kayıtları. Hunk düzeyinde stage edildi; `App.tsx` Consent başlığı, `pbxproj` RevenueCat bundle satırları, admin HTML (origin ile aynı) ve diğer oturumların handoff kayıtları dahil edilmedi.
- Kullanıcı kararı: commit tek başına `origin/main`'e uygulanamadığı için (bağımlı dosyalar push edilmemiş yerel commit'lerdeydi) yerel 17 commit `origin/main` (13 Aile planı commit'i) üzerine ayrı worktree'de rebase edildi. Tek çakışma `supabase/config.toml` (admin-panel-login/admin-panel-ui + family-planner blokları ikisi de korundu). Rebase ağacında `npx tsc --noEmit` OK; `origin/main` `d220073..89c98b7` fast-forward push.
- Yerel `main` `git reset --mixed 89c98b7` ile senkron; çalışma ağacı dosyalarına dokunulmadı. Kalan değişiklikler diğer oturumların (RevenueCat, Consent, handoff kayıtları; `config.toml`'da yalnız blok sırası farkı).
- Doğrulama: "Deploy support site" success; `app.flyfamapp.com/`, `/admin/` (ui=59), `/aile/`, `/auth-callback.html` 200.

## 2026-10-01 — "Phase Refresh Health" GitHub zamanlaması kapatıldı

- Sorun: `.github/workflows/phase-refresh-health.yml` her çalıştırmada `Missing env: SUPABASE_URL/SERVICE_KEY` ile düşüyordu (repo'da hiç Actions secret yok; listedeki 200 çalıştırmanın tamamı failure). GitHub `*/5` zamanlamasını pratikte 4–6 saatte bir çalıştırdığı için 6 dk eşikli kontrol zaten güvenilir değildi; her hata kullanıcıya e-posta gönderiyordu.
- Asıl sistem sağlıklı: pg_cron `refresh-flight-api-phases` (`*/2`) aktif; `system_health_pings.phase_refresh` son başarı 0.5 dk önce, 204 satır.
- Kullanıcı kararıyla `schedule` kaldırıldı, yalnız `workflow_dispatch` kaldı (secret'lar eklenirse elle çalıştırılabilir). Commit `5022808` → `origin/main`.
- Doğrulama: push OK; uzak workflow dosyasında schedule yok.

## 2026-10-01 — Görev kodu önerisi onayı: `special_notes` NOT NULL hatası

- Sorun: Admin panelde öneri onayı `500: null value in column "special_notes" … violates not-null constraint`. `admin-dashboard` onay upsert'i not boşken `special_notes: null` yazıyordu; kolon `NOT NULL default ''`.
- `supabase/functions/admin-dashboard/index.ts`: `special_notes: noteText` (boş not → `''`). `description_tr/en` boş olmayan değer kuralı aynı.
- `admin-dashboard` production'a deploy edildi; OPTIONS 200, yetkisiz POST 401.
- Doğrulama: bekleyen öneri `ROFP` (PGT, not boş) ile aynı satır rollback transaction içinde `roster_occupation_codes`'a hatasız upsert edildi (`special_notes = ''`). Panelden onay kullanıcıya bırakıldı.
- Not: Deploy edildi; commit bir sonraki kayıtla (admin ui=60) birlikte.

## 2026-10-01 — Görev kodu önerisi: onay öncesi inceleme/düzenleme + öneren kişiye teşekkür bildirimi (admin ui=60)

- **Dosyalar:** `supabase/functions/admin-dashboard/index.ts` (`review_occupation_suggestion`), `docs/ADMIN_STATUS_DASHBOARD.html` → `support/admin/index.html` (kopya), `support/index.html` (`adminUi` 59 → 60).
- **Panel:** «Onayla + yayınla» artık `confirm()` yerine `#occSugEditBackdrop` penceresini açar: kod, havayolu ICAO, kategori, sıra, TR/EN etiket, TR/EN açıklama, kart rengi, takvim işareti, özel not — öneriden dolu gelir (renk/takvim backend ile aynı kategori eşlemesi; kategori değişince ikisi yeniden önerilir, elle değiştirilebilir). Öneren kişi + not gösterilir; aynı kod+havayolu katalogda varsa «üzerine yazar» uyarısı (`occDraftRows`). Gönderimde `overrides` ile onaylanır. Reddet akışı değişmedi.
- **Backend:** İsteğe bağlı `body.overrides`; kod/kategori/renk/takvim `save_roster_occupation_codes` ile aynı kümelerle doğrulanır (geçersizse 400). Metinler hiçbir zaman null değil (etiket boşsa kod). `overrides` yoksa eski davranış birebir. Yanıttaki `code` düzenlenmiş kod.
- **Teşekkür bildirimi:** Onay + yayın + öneri `approved` işaretlendikten sonra öneren kullanıcının `device_tokens`'ına Expo push (`profiles.locale` en → İngilizce, aksi Türkçe): «Öneriniz için teşekkürler! — Önerdiğiniz KOD (etiket) görev kodu onaylandı. Görev kodları güncellendi; roster'ınızda artık doğru görünecek.» `data.type = occupation_suggestion_approved` (mobil yalnız `data.url` açar; bu alan yok sayılır). Gönderilirse `user_activity_events` `admin_push` / `source: occupation_suggestion_approved`. Push hatası onayı geri almaz; yanıtta `notified` ve panel durum satırı bunu gösterir. Mobil, ön plana gelince `refreshOccupationCatalog()` ile yeni yayını çeker.
- **Doğrulama:** `esbuild` OK, panel inline script'leri derleme kontrolü OK, `admin-dashboard` deploy; OPTIONS 200, yetkisiz POST 401. Bekleyen öneriler `ROFP` ve `PTV`: öneren kullanıcıların 1'er push token'ı var (locale tr). Gerçek onay + bildirim uçtan uca henüz denenmedi (panelden ilk onayda görülecek). Panel `app.flyfamapp.com`'a ancak `support/**` main'e push edilince çıkar — henüz push edilmedi; o zamana kadar canlı panel eski `confirm()` akışıyla çalışır (backend geriye uyumlu, eski panelden onayda da teşekkür bildirimi gider).
- **Koruma:** Katalog editörü, yayın (published_version+1), red akışı, diğer admin push aksiyonları değişmedi.
- **Yayın:** Kullanıcı onayıyla commit `17642ec` → `origin/main` (ayrı worktree; yalnız bu işin dosyaları + handoff'taki kendi kayıtlarım). "Deploy support site" success; canlı `app.flyfamapp.com/admin/` `UI = '60'` ve `#occSugEditBackdrop` içeriyor, `/` `adminUi = '60'`. Yerel önizlemede sahte öneriyle pencere açıldı: alanlar dolu, kategoriye göre renk/takvim, mevcut kod uyarısı görünüyor. Yerel `main` HEAD'i bilerek ilerletilmedi (`support/aile/index.html`, `family-planner/index.ts` başka oturumda origin'den farklı).
- **Gerçek kullanım:** ROFP ve PTV 2026-10-01 12:15'te panelden onaylandı; ikisi için de `admin_push` / `source: occupation_suggestion_approved`, `sent: 1` kaydı var (uçtan uca OK).

## 2026-10-01 — Admin ui=61: katalog kaydetme çubuğu + «Son olaylar» bildirim filtresi

- **Dosyalar:** `docs/ADMIN_STATUS_DASHBOARD.html` → `support/admin/index.html`, `support/index.html` (`adminUi` 61), `supabase/functions/admin-dashboard/index.ts` (`list_user_activity`).
- **Görev kodları → Katalog:** `setOccDirty()` tek kaynak. Değişiklik olunca tablonun altında yapışkan `#occSaveBar` («Vazgeç», «Kaydet (taslak)», «Kaydet + yayınla»); üstteki «Kaydet» vurgulanır. Hücreler artık `input` olayında da senkronlanır. `syncOccRowFromDom` yalnız değer gerçekten değiştiyse kirli işaretler (arama/filtre artık kirli yapmaz); `loadOccupationCodes` satırları tablo biçimine normalize eder (null → '', boş TR açıklama → EN). Kayıp koruması: kirliyken «Yenile» ve öneri onayı onay ister (onay öncesi taslak kaydedilir; iptal = onaylama), sayfadan çıkışta `beforeunload` uyarısı.
- **Aktivite → Son olaylar:** «Olay türü» filtresi (Tümü son 120 / Yalnız bildirimler son 150 / Admin push / Aile push). Backend yanıtına `recent_pushes` (dönem içi son 150 `admin_push` + `family_push`, rol filtresine uyar). Detayda `meta.title`, `meta.body` (90 karakter), `meta.source` etiketi (`occupation_suggestion_approved` → «öneri teşekkürü», `admin_single` → «tekil admin push»). Aile push kayıtları gönderen crew adına tutulur (alıcı listesi yok — mevcut veri modeli).
- **Doğrulama:** `esbuild` OK, inline script derleme OK, `admin-dashboard` deploy; OPTIONS 200, yetkisiz POST 401. Yerel önizleme (sahte API): arama kirli yapmıyor, düzenleme çubuğu açıyor; «Kaydet + yayınla» sırası save → list → deploy → list, sonunda çubuk gizli; bildirim filtresi 120 ekran olayı arasında 3 push satırını başlık/mesajla gösterdi.
- **Koruma:** Kaydet/Yayınla toolbar butonları, `save_/deploy_roster_occupation_codes` API'leri, `recent` alanı ve mevcut aktivite tabloları değişmedi.

## 2026-10-02 — «Aile planı» Finans: günlük kaynak (Tolga) her an girilebilir + elle aylık toplam

- **Kullanıcı kararı:** Günlük kutular her zaman açık (gelecek günler dahil); diğer klinikler gibi bir aylık toplam kutusu; elle girilen aylık rakam o ay için günlüklerin toplamının yerine geçer. Açılır ciro sorusu eskisi gibi iş bitince.
- **`support/aile/index.html`:** Günlük grupta `future` kilidi kaldırıldı; grubun sonuna `autoSum` satırı («<Yer> · <Ay> · aylık toplam», değer = elle girilen ?? günlüklerin toplamı). `onCiroClick`: aylık satırda değer günlüklerin toplamına eşitse kayıt silinir (saklanmaz → toplam günlüklerle güncellenmeye devam eder); ✕ elle toplamı kaldırır. `ciroOf`/özet tablosu/son 6 ay: günlük kaynakta `YYYY-MM` satırı varsa o geçerli; not «aylık toplam elle girildi · günlüklerin toplamı X». `pendingCiro`: aylık toplam girilmiş ayda günlük soru çıkmaz.
- **`supabase/functions/family-planner/index.ts`:** `finance_set` günlük kaynakta `YYYY-MM` de kabul eder (aylık kaynak yalnız `YYYY-MM`). **`notify.ts`:** akşam günlük ciro push'u, o ay için aylık toplam varsa gönderilmez.
- **Doğrulama:** inline script derleme OK; fonksiyon `esbuild --bundle` OK. Deploy öncesi canlı kaynak indirildi = yerel (index/notify/webpush birebir), deploy sonrası yine birebir; OPTIONS 200, yetkisiz `push_key`/`finance_set` 401. Yerel önizleme (sahte API/config): gelecek günlerde input var; aylık 150.000 → `finance_set 2026-10 150000`, alt toplam «elle girildi», tolga için bekleyen soru 0; 12.000'e (günlük toplam) dönünce `finance_set … null`, elle kayıt silindi.
- **Durum:** Fonksiyon deploy edildi (geriye uyumlu). Terminal repo klasöründe takıldığı için push bir süre bekledi; kullanıcı onayıyla uzak sayfanın `759d109`'dan beri değişmediği doğrulandı, `git diff --check` OK, sayfa + bu kayıt ayrı worktree'den commit + push.
- **Not:** Fonksiyon dosyaları (`index.ts` debt/finans eki, `notify.ts`, `webpush.ts`) ve finans/debt migration'ları diğer oturumdan commit edilmemiş; bu değişiklik de yalnız deploy edildi, commit edilmedi.

## 2026-10-02 — Aile planı: Acıbadem Salı 10:00–16:00 ve kesikli yol çubukları

- Veri: `admin_planner_state.config.partnerFixed[0]` ("Acıbadem Altunizade (Salı)") başlangıcı 11:00 → 10:00 yapıldı (SQL `jsonb_set`, `updated_at` güncellendi). 2. Cumartesi kaydı zaten 10:00–16:00.
- `support/aile/index.html`: gün timeline'ında yol süreleri ayrı `kind:'travel'` segmentleri olarak kesikli (`.seg.travel`, `--c` rengi) çiziliyor — crew ev↔havalimanı (görev aralığının `pre`/`post` kısmı), çocuk okula gidiş/dönüş, eşin sabit/planlı işlerine ev↔iş yeri. 3 dk altı yol çizilmez. Lejanta "Yol (kesikli)" eklendi; crew lejantı "görev" oldu.
- Korunacak davranış: crew `intervals` uzunluğu (s/e) aynı kaldı, yalnız `pre`/`post` alanı eklendi; çakışma, `workNeeds`, `schoolRun`, `rate` hesapları değişmedi. Tatil uçuş günü sayımı crew `travel` segmentini de sayar (eski davranış korunur).
- Doğrulama: inline script `node --check` OK; gerçek config ile yerel önizlemede 6 Ekim Salı günü crew/okul/Altunizade yol çubukları ve "Altunizade 10:00–16:00" görüldü.
