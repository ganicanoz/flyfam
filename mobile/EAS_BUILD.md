# EAS Build ve Hata Ayıklama (iOS/Android)

## Terminal takılıyorsa / cevap vermiyorsa

- **EAS build** bazen “Configure project?” gibi soru sorar; cevap vermezsen takılmış gibi görünür.  
  **Çözüm:** Build’i **non-interactive** çalıştır:
  ```bash
  npx eas build --profile preview --platform android --non-interactive
  ```
  veya `npm run build:android` (script’e `--non-interactive` eklendi).

- **npm install** uzun sürüyorsa veya takılıyorsa:
  - İnternet bağlantısını kontrol et.
  - Tekrar dene: `npm install --no-audit --no-fund` (daha az işlem).
  - Bazen 2–3 dakika sürebilir; ilk kurulumda bekleyip Ctrl+C ile kesme.

- **expo-doctor** takılıyorsa: `npx expo-doctor --verbose` ile hangi adımda kaldığını görebilirsin; gerekirse Ctrl+C ile çık.

---

## Build hakkı / kredi tasarrufu (başarısız build’ten sonra)

- **Retry (tekrar dene):** Başarısız build’i **yeni kredi harcamadan** tekrar denemek için: [expo.dev](https://expo.dev) → Projen → **Builds** → başarısız build’e tıkla → sayfada **Retry** / **Rebuild** butonuna bas. Aynı commit ile yeniden build alınır; birçok durumda ek build hakkı sayılmaz.
- **Cache temizleyip tekrar almak:** EAS cache’i değiştirip “temiz” build almak için `eas.json` içinde `preview.android.cache.key` değerini değiştir (örn. `flyfam-android-v1` → `flyfam-android-v2`). Sonra `npm run build:android` çalıştır. Retry ile yetinmek istemezsen bunu kullan.
- **Önce yerel kontrol (kredi harcamaz):** Android tarafında Gradle’ın geçip geçmediğini yerelde görmek için (Java/Android SDK kurulu olmalı):  
  `npm run check:android:local`  
  Bu komut prebuild + `assembleRelease` çalıştırır; başarılı olursa EAS’a gönderdiğinde de büyük ihtimalle geçer. Böylece hata varsa EAS hakkı harcamadan yakalayabilirsin.

---

## EAS build neden renkli/hata ekranı gösteriyor?

EAS build **sunucuda** yapılır; bilgisayarındaki `.env` dosyası build’e **gönderilmez**. Bu yüzden uygulama içinde `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` vb. **tanımsız** kalır ve uygulama açılışta (ör. Supabase client) hata fırlatıp kırmızı ekran gösterebilir.

**Çözüm:** Bu değişkenleri EAS **Secrets** olarak tanımla; build sırasında env olarak enjekte edilir.

---

## 1. EAS Secrets ekleme (mutlaka yap)

1. [expo.dev](https://expo.dev) → Projeni seç → **Secrets** (veya Project settings → Environment variables).
2. Aşağıdaki her biri için **Secret** ekle (isim tam aynı olsun, değeri kendi `.env`’indeki ile doldur):

| Secret adı | Açıklama |
|------------|----------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase proje URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `GOOGLE_SERVICES_JSON` | **Android build için gerekli.** `mobile/google-services.json` dosyasının **tüm içeriği** (tek satır veya pretty JSON). Firebase Console → Proje ayarları → google-services.json indir, içeriği kopyala yapıştır. |
| `EXPO_PUBLIC_AVIATION_EDGE_API_KEY` | İsteğe bağlı |
| `EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN` | İsteğe bağlı |
| `EXPO_PUBLIC_AVIATION_STACK_API_KEY` | İsteğe bağlı |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Expo proje UUID (genelde gerekli) |

En azından **Supabase URL ve anon key** olmadan uygulama açılışta düşer. **Android** build için `GOOGLE_SERVICES_JSON` olmadan `google-services.json is missing` hatası alırsın.

**EAS GitHub/Git ile build alıyorsa:** Repoda `mobile/google-services.json` ve `mobile/android/app/google-services.json` **commit edilmiş ve push edilmiş** olmalı. Push yapılmazsa EAS sunucusu bu dosyaları görmez ve Android build yine `google-services.json is missing` ile düşer. Bu yüzden bu dosyaları ekleyen commit'i mutlaka push et.

3. Secrets’ları ekledikten sonra **yeni bir EAS build** al:
   ```bash
   cd mobile
   eas build --profile preview --platform ios
   ```
4. Yeni build’i (iTunes/TestFlight ile) yükleyip tekrar dene.

---

## 2. Hatayı kendin görmek (hata mesajını okumak)

EAS ile yüklediğin build’de Metro çalışmadığı için kırmızı ekrandaki mesajı cihazda kalıcı göremeyebilirsin. Hatayı net görmek için:

### Yöntem A: Development build + Metro (önerilen)

1. **Development** profili ile build al (simulator veya gerçek cihaz):
   ```bash
   eas build --profile development --platform ios
   ```
2. Build bitince .ipa’yı yükle (veya simulator için .app).
3. **Aynı bilgisayarda** Metro’yu başlat:
   ```bash
   cd mobile
   npx expo start --dev-client
   ```
4. Telefondan uygulamayı aç; Metro’ya bağlansın. Hata olursa **hem cihazda kırmızı ekranda hem terminalde** tam hata mesajı ve stack trace görünür.

### Yöntem B: Preview build + konsol

- Mac’e iPhone’u kablo ile bağla.
- **Xcode** → Window → Devices and Simulators → cihazı seç → **Open Console**.
- Uygulamayı aç; konsolda çıkan (kırmızı) logları oku.

### Yöntem C: Sentry / crash raporu

- İleride production için Sentry (veya benzeri) ekleyebilirsin; release build’deki hatalar rapora düşer.

---

## 2b. Yüklü uygulamanın loglarını görme (preview build telefonda)

Telefona yüklediğin build’de (Metro yok) yaptığın işlemlerin loglarını görmek için:

### Seçenek 1: Mac + iPhone kablo (yerel)

1. iPhone’u **kablo ile** Mac’e bağla, güvenilir olarak işaretle.
2. **Xcode** aç → **Window** → **Devices and Simulators** → soldan cihazını seç → **Open Console**.
3. Uygulamayı telefonda aç ve kullan; konsolda çıkan tüm sistem + uygulama logları burada görünür.  
   Arama kutusuna `FlyFam` veya `Expo` yazarak sadece uygulama loglarını filtreleyebilirsin.

**Alternatif:** macOS **Console.app** (Programlar → Yardımcı Programlar) → soldan bağlı iPhone’u seç → sağda loglar. Filtre: process adı veya “FlyFam”.

### Seçenek 2: Development build + Metro (tüm console.log’lar)

En net log için: **development** build al, yükle, sonra bilgisayarda `npx expo start --dev-client` çalıştırıp telefonda uygulamayı aç. Tüm `console.log` ve hatalar **terminalde** görünür; kablo gerekmez (aynı Wi‑Fi).

### Seçenek 3: Uzaktan log (Sentry / log servisi)

Hata ve logları **internetten bir panelden** görmek istersen projeye Sentry (veya benzeri) eklenir. Böylece telefonda yaptığın işlemlerin hata/crash ve isteğe bağlı logları Sentry dashboard’da toplanır; kablo veya Metro gerekmez.

---

## 3. Test cihazı ekleme (internal / preview build)

Preview build’i **gerçek cihaza** yükleyebilmek için cihazın UDID’si EAS’a kayıtlı olmalı.

1. Cihazda UDID’yi al: [udid.tech](https://udid.tech) aç, **UDID** değerini kopyala.
2. Proje klasöründe:
   ```bash
   cd mobile
   npx eas device:create
   ```
3. İstenirse **device name** gir (örn. "Eşimin iPhone") ve **UDID**’yi yapıştır.
4. Kayıt sonrası yeni bir **preview** iOS build al; bu build artık o cihaza yüklenebilir.

Birden fazla cihaz ekleyebilirsin; her biri için `npx eas device:create` tekrarla veya Expo dashboard → Project → Devices üzerinden de yönetebilirsin.

---

## 3b. Preview build’i telefona yükleme

Build bittikten sonra .ipa’yı cihaza kurmak için:

1. **Expo dashboard:** [expo.dev](https://expo.dev) → projen → **Builds** → az önce biten **iOS preview** build’e tıkla.
2. Sayfada **Install** / **QR code** veya **Download** görünecek:
   - **Telefonda yükle (en kolay):** Build sayfasındaki **Install** linkini iPhone’da aç (Safari). Veya QR kodu iPhone kamerasıyla tara; çıkan linke gir. Cihazın UDID’si bu build’e kayıtlıysa kurulum başlar. Gerekirse “Güvenilir değil” uyarısı çıkarsa: Ayarlar → Genel → VPN ve Cihaz Yönetimi → geliştirici uygulamasına “Güven” de.
   - **.ipa indirip Mac’ten yükle:** Build sayfasından **Download** ile .ipa’yı indir. iPhone’u kablo ile Mac’e bağla. **Apple Configurator 2** ([Mac App Store](https://apps.apple.com/app/apple-configurator-2/id1037126344)) aç → cihazı seç → **Add** → **Apps** → indirdiğin .ipa’yı seç. Alternatif: **Xcode** → Window → Devices and Simulators → cihazı seç → alttaki **+** ile .ipa ekle.

3. İlk açılışta “Unverified Developer” uyarısı çıkarsa: iPhone’da **Ayarlar** → **Genel** → **VPN ve Cihaz Yönetimi** → ilgili geliştiriciyi seç → **Güven** de.

---

## 4. Aile bildirimleri (took_off / landed) – crew online olmadan

**Cron ile çalışan Edge Function:** `check-flight-status-and-notify` her çalıştığında bugünkü uçuşları FR24’ten sorgular, DB’yi günceller ve henüz gönderilmemiş “kalktı”/“indi” bildirimlerini aileye yollar. Böylece crew uygulaması açık olmasa da aile bildirim alır.

### Adım adım kurulum

#### 4.1. Supabase’de secret’ları ekleme

1. Tarayıcıda [supabase.com](https://supabase.com) → giriş yap → projeni seç.
2. Sol menüden **Project Settings** (dişli simgesi) → **Edge Functions** sekmesi.
3. **Edge Function Secrets** bölümünde **Add new secret** (veya **Manage secrets**) tıkla.
4. İki secret ekle:

   | Name (tam yaz) | Value (senin değerin) |
   |----------------|------------------------|
   | `FR24_API_TOKEN` | Mobil projedeki `mobile/.env` içindeki `EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN` değerini kopyala yapıştır (tırnak varsa kaldır). |
   | `CRON_SECRET` | Kendi uydurduğun uzun bir parola (örn. 32 karakter rastgele). Bunu cron isteğinde `x-cron-secret` header’ında kullanacaksın; kimseyle paylaşma. |

5. Her biri için **Save** / **Add** ile kaydet.

#### 4.2. Edge Function’ları deploy etme

1. Terminalde Supabase’e giriş yap (henüz yapmadıysan):
   ```bash
   supabase login
   ```
   Tarayıcı açılır; giriş yap, terminale dön.

2. Proje klasörüne git (FlyFam kökü, `supabase` klasörünün olduğu yer):
   ```bash
   cd /Users/mineoz/Desktop/FlyFam
   ```

3. Projeyi Supabase’e bağla (sadece ilk seferde; zaten link’lediysen atla):
   - Dashboard → **Project Settings** → **General** → **Reference ID** (örn. `slmgmcpluanezvkgkozw`) kopyala.
   ```bash
   supabase link --project-ref BURAYA_REFERENCE_ID_YAPIŞTIR
   ```

4. İki function’ı sırayla deploy et:
   ```bash
   supabase functions deploy notify-family
   supabase functions deploy check-flight-status-and-notify
   ```
   Her ikisinde de “Deployed successfully” benzeri çıktı gelmeli.

#### 4.3. Cron’u tanımlama (her 2 dakikada çalışsın – bildirimler için)

**Seçenek A – Harici cron (herhangi bir sunucu / bilgisayar):**

- Cron’un çalışacağı yerde (cPanel, GitHub Actions, kendi sunucun vb.) her 2 dakikada şu isteği at:
  ```bash
  curl -X POST "https://BURAYA_PROJECT_REF_YAZ.supabase.co/functions/v1/check-flight-status-and-notify" \
    -H "Content-Type: application/json" \
    -H "x-cron-secret: BURAYA_CRON_SECRET_DEĞERINI_YAZ"
  ```
- `BURAYA_PROJECT_REF_YAZ`: Supabase **Reference ID** (Project Settings → General).
- `BURAYA_CRON_SECRET_DEĞERINI_YAZ`: 4.1’de tanımladığın `CRON_SECRET` secret’ının değeri.

**Örnek (Reference ID = abc123, CRON_SECRET = mySecretKey):**
  ```bash
  curl -X POST "https://abc123.supabase.co/functions/v1/check-flight-status-and-notify" \
    -H "Content-Type: application/json" \
    -H "x-cron-secret: mySecretKey"
  ```

**Seçenek B – Supabase pg_cron (Pro plan):**

- Database → **Extensions** → `pg_cron` etkinleştir.
- SQL ile periyodik çağrı tanımlamak için Supabase dokümantasyonundaki “pg_cron + Edge Function” örneğine bak; URL ve `x-cron-secret` header’ını yukarıdaki gibi kullan.

Kurulum sonrası cron her 2–3 dakikada çalışır; bugünkü uçuşlar FR24’ten güncellenir ve aile “kalktı”/“indi” bildirimini crew uygulaması kapalı olsa da alır. Crew’in yapması gereken sadece uçuşları ekleyip “Uçuşları aileme gönder” demek.

**“Send flights to my family” (bugünkü uçuşlar):** Bu buton crew’in oturum açtığı cihazdan çağrılır; aile o an kayıtlı cihazlara bildirim alır.

---

## 5. Güvenlik notu

- **SUPABASE_SERVICE_ROLE_KEY** mobil uygulamada kullanılmaz ve EAS Secrets’a **eklenmemeli**. Sadece backend / Edge Functions ortamında kullan.
- `.env` dosyası git’e commit edilmemeli (`.gitignore`’da olmalı). Gerçek değerler sadece yerel `.env` ve EAS Secrets’ta durur.
