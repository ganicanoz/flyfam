# FlyFam — Geliştirme ortamı

## iOS Simulator (Mac’te)

Simulator’da “request timed out” alıyorsan Metro’yu **localhost** ile başlat:

```bash
cd /Users/mineoz/Desktop/FlyFam/mobile
npm run ios:sim
```

Bu komut `REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1` ile Expo’yu açar ve Simulator’ı kendisi açar; bağlantı `exp://127.0.0.1:8081` üzerinden gider.

**Hâlâ timeout alıyorsan:**

1. Cache’i temizle, sonra tekrar dene:
   ```bash
   npm run clean
   npm run ios:sim
   ```
2. Watchman varsa yeniden başlat:
   ```bash
   watchman watch-del-all
   ```
3. Xcode’un en güncel Command Line Tools’u kullanıldığından emin ol:
   ```bash
   xcode-select -p
   ```

---

## Fiziksel cihaz (aynı Wi‑Fi)

1. **Tunnel kullanma** (ngrok sorun çıkarıyor).
2. Bilgisayarda:
   ```bash
   npm start
   ```
   veya `npx expo start --clear`
3. Telefon ve Mac **aynı Wi‑Fi**’de olsun; Expo Go ile terminaldeki **QR kodu** tara.
4. “Request timed out” alırsan Mac **güvenlik duvarı**nda Node’a izin ver veya test için kapat.

---

## Komutlar özeti

| Amaç              | Komut           |
|-------------------|-----------------|
| Simulator (localhost) | `npm run ios:sim` |
| Genel başlat      | `npm start` veya `npm run ios` |
| Cache temizle     | `npm run clean` |
