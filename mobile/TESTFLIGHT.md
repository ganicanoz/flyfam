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

## Adım 6: TestFlight’ta testçi davet etme

1. [App Store Connect](https://appstoreconnect.apple.com) → **My Apps** → **FlyFam**.
2. Sol menüden **TestFlight** sekmesine gir.
3. İlk yüklemeden sonra build “Processing” görünür; işlem bitince (birkaç dakika–yarım saat) **TestFlight** bölümünde görünür.
4. **Internal Testing** veya **External Testing**:
   - **Internal:** Aynı App Store Connect ekibindeki kullanıcılar (en hızlı, onay beklemez).
   - **External:** Dış test kullanıcıları; ilk seferde Apple incelemesi olabilir.
5. **+** ile testçi ekle, e-posta adreslerini gir; davet e-postası gider. Testçi **TestFlight** uygulamasını indirir, daveti kabul eder ve FlyFam’ı yükler.

---

## Özet komutlar

```bash
cd /Users/mineoz/Desktop/FlyFam/mobile
eas login
eas build --platform ios --profile production
# Build bittikten sonra:
eas submit --platform ios --latest --profile production
```

Bundle ID projede **com.flyfam.app** olarak ayarlı; `eas.json` içinde production profili TestFlight/App Store için hazır. Takıldığın yerde hata mesajını paylaşırsan bir sonraki adımı birlikte netleştirebiliriz.
