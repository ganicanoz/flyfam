# FlyFam — TestFlight’a Yükleme

Bu rehber, uygulamayı iOS için build alıp TestFlight’a göndermeni adım adım anlatır.

## Ön koşullar

1. **Apple Developer Program** üyeliği (yıllık ücretli): [developer.apple.com](https://developer.apple.com)
2. **Expo hesabı** (ücretsiz): [expo.dev](https://expo.dev) — EAS Build için gerekli.

---

## Adım 1: EAS CLI ve giriş

Terminalde (proje klasörü: `mobile`):

```bash
cd /Users/mineoz/Desktop/FlyFam/mobile
npm install -g eas-cli
eas login
```

Expo hesabınla giriş yap (yoksa önce expo.dev’den oluştur).

---

## Adım 2: Apple hesabını EAS’a bağla

İlk kez iOS build alıyorsan EAS, Apple Developer hesabını isteyecek:

```bash
eas credentials
```

- **Platform:** iOS seç.
- Apple ID (e-posta) ve şifreni gir; gerekirse “App-specific password” oluştur: [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security → App-Specific Passwords.
- Distribution certificate ve provisioning profile’ı EAS kendisi oluşturabilir (otomatik önerilir).

---

## Adım 3: App Store Connect’te uygulama kaydı

1. [App Store Connect](https://appstoreconnect.apple.com) → **My Apps** → **+** → **New App**.
2. **Platform:** iOS.  
3. **Name:** FlyFam.  
4. **Primary Language:** Türkçe (veya İngilizce).  
5. **Bundle ID:** Listeden **com.flyfam.app** seç (yoksa önce [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list) → Identifiers’dan bu bundle id’yi oluştur).  
6. **SKU:** Örn. `flyfam-ios`.  
7. **Create** de.

Bu adımı build’den önce veya sonra yapabilirsin; TestFlight’a yüklerken bu uygulama kaydı gerekir.

---

## Adım 4: iOS build al

```bash
cd /Users/mineoz/Desktop/FlyFam/mobile
eas build --platform ios --profile production
```

- İlk seferde bazı sorular çıkabilir (Apple hesabı, bundle id onayı vb.); ekrandaki yönlendirmeleri izle.
- Build Expo sunucularında çalışır; tamamlanınca bir **build URL** verir (Expo dashboard’da da görünür).

Build bitene kadar bekleyebilir veya `eas build:list` ile durumu kontrol edebilirsin.

---

## Adım 5: Build’i TestFlight’a gönder

Build başarıyla bittikten sonra:

```bash
eas submit --platform ios --latest --profile production
```

- **Latest:** En son alınan production build kullanılır.
- İlk submit’te Apple ID ve gerekirse App-Specific Password, Team ve App Store Connect’teki uygulama (App) seçilir.
- EAS, build’i doğrudan TestFlight’a yükler.

Alternatif: [expo.dev](https://expo.dev) → projen → **Builds** → ilgili iOS build → **Submit to App Store Connect**.

---

## Adım 6: Test kullanımı için e‑posta ile davet (TestFlight)

Uygulama henüz mağazada yayında değil; sadece **TestFlight** üzerinden e‑posta ile davet ettiğin kişiler test edebilir.

1. [App Store Connect](https://appstoreconnect.apple.com) → **My Apps** → **FlyFam**.
2. Sol menüden **TestFlight** sekmesine gir.
3. Build ilk yüklendikten sonra bir süre “Processing” görünür; bittiğinde (birkaç dakika–yarım saat) TestFlight’ta kullanılabilir olur.
4. **Internal Testing** veya **External Testing** grubu seç:
   - **Internal:** Sadece App Store Connect’te “App Manager” / “Developer” rolündeki ekip üyeleri. Davet anında gelir, Apple onayı yok.
   - **External:** İstediğin e‑posta adreslerine davet (eş, arkadaş, müşteri vb.). İlk kez dış testçi eklediğinde build için kısa bir Apple incelemesi olabilir (genelde 24–48 saat).
5. **E‑posta ile davet:**
   - **External Testing** → bir **Test Group** oluştur (veya mevcut grubu kullan) → **Add Testers** (Testçi Ekle).
   - Testçi e‑posta adreslerini gir (virgül veya her satıra bir adres). **Add** de.
   - Apple, bu e‑postalara davet gönderir. Testçi davetteki bağlantıya tıklar, **TestFlight** uygulamasını (App Store’dan) indirir, daveti kabul eder ve FlyFam’ı TestFlight üzerinden yükler.
6. İstediğin zaman aynı sayfadan yeni e‑posta adresleri ekleyebilir veya test grubunu güncelleyebilirsin.

### Davet kodu / herkese açık link (Public Link)

E‑posta girmeden, link paylaşarak davet etmek istersen:

1. **TestFlight** → **External Testing** → kullanacağın **Test Group**’u seç (yoksa yeni grup oluştur, build’i bu gruba ekle).
2. Sayfada **Enable Public Link** (veya **Public Link** / **Herkese Açık Bağlantı**) seçeneğini aç.
3. Apple bir **TestFlight davet linki** üretir (örn. `https://testflight.apple.com/join/XXXXXX`). Bu linki veya kodu (ör. `XXXXXX`) kime verirsen, o kişi linke tıklayıp TestFlight uygulaması üzerinden FlyFam’ı yükleyebilir.
4. İstersen **Copy Link** ile kopyalayıp mesaj / e‑posta / Slack ile paylaş.  
**Not:** Public link ilk kez açıldığında build için Apple incelemesi (24–48 saat) gerekebilir.

---

## Özet komutlar

```bash
cd /Users/mineoz/Desktop/FlyFam/mobile
npx eas-cli@latest login
# 1) App Store / TestFlight için build:
npm run build:ios:store
# 2) Build bittikten sonra TestFlight'a gönder:
npm run submit:ios
```

Veya doğrudan EAS komutları:  
`npx eas-cli@latest build --platform ios --profile production` → ardından  
`npx eas-cli@latest submit --platform ios --latest --profile production`

Bundle ID projede **com.flyfam.app** olarak ayarlı; `eas.json` içinde production profili TestFlight/App Store için hazır. Takıldığın yerde hata mesajını paylaşırsan bir sonraki adımı birlikte netleştirebiliriz.
