# iOS Simülatörde FlyFam denemek

PDF içe aktarma (`expo-pdf-text-extract`) **Expo Go’da yok**; simülatörde **yerel derlenmiş** uygulama gerekir.

## 1. Gereksinimler

- Mac + **Xcode** (App Store) — bir kez açıp lisansı kabul et
- Node 18+
- `mobile/.env` içinde `EXPO_PUBLIC_SUPABASE_URL` ve `EXPO_PUBLIC_SUPABASE_ANON_KEY` (kopya: `cp .env.example .env`, değerleri doldur)

## 2. Bağımlılıklar

```bash
cd mobile
npm install
```

## 3. Simülatörde çalıştır (önerilen tek komut)

```bash
cd mobile
npm run ios:run
```

veya:

```bash
npx expo run:ios
```

- İlk derleme **birkaç dakika** sürebilir (Xcode + CocoaPods).
- iOS Simulator açılır, **FlyFam** dev client olarak yüklenir.
- Metro çoğu zaman otomatik başlar; bağlantı koparsa aşağıdaki adıma geç.

## 4. Sadece Metro’yu dev client ile başlat

Yeni terminal:

```bash
cd mobile
npm run start:devclient
```

Sonra Simulator’da uygulamayı yeniden aç veya `r` ile reload.

## 5. PDF / Script JSON

| Özellik | Simülatörde |
|--------|-------------|
| **Script JSON** (Uçuş Ekle → «Script JSON») | Çalışır; PDF modülü gerekmez. |
| **PDF seç** | `expo run:ios` ile kurulu build gerekir (bu rehber). |
| Script ile **aynı PDF parse** | Supabase’te `parse-roster-pdf` edge function deploy: `supabase functions deploy parse-roster-pdf` |

## 6. Sorun giderme

| Durum | Ne yap |
|--------|--------|
| `pod` hataları | `cd ios && pod install` sonra tekrar `npm run ios:run` |
| Metro bulunamıyor | `npm run start:devclient` — Simulator’da uygulama aynı makinede olduğundan `localhost` genelde yeterli |
| Beyaz ekran | Xcode’dan Simulator → Device → Erase All Content… nadiren gerekir |
| `.env` okunmuyor | Metro’yu kapatıp `npm run start:devclient` ile yeniden başlat |

## 7. EAS Simulator .tar (alternatif)

Bulutta derlemek için: `npm run build:ios:sim` — çıkan `.tar.gz`’i Simulator’a sürükle. Yerel `ios:run` genelde daha hızlı iterasyon için yeterli.
