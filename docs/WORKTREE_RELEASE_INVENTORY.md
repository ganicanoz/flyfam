# FlyFam çalışma ağacı yayın envanteri

Son güncelleme: 26 Eylül 2026

Bu belge, uzun süredir biriken yerel değişiklikleri kaybetmeden yayınlanabilir ve
incelenebilir commit gruplarına ayırmak için oluşturuldu. Dosyalar otomatik olarak
silinmez; yalnız geçici veya kişisel veri içerebilecek çıktılar Git ignore kapsamına
alınır.

## Commit grupları

### 1. Mobil uygulama ve native yapı

- `mobile/App.tsx`, aktif `mobile/screens/`, `mobile/components/`, `mobile/lib/`
- iOS/Android native proje, bildirim uzantısı, ikon, splash ve ses dosyaları
- `mobile/package.json`, lockfile, Expo/EAS ve Metro yapılandırmaları
- Doğrulama: strict TypeScript, kapasite testi, Android ikon kontrolü, Expo export

### 2. Backend, migration ve admin paneli

- `supabase/functions/`, `supabase/migrations/`, `supabase/config.toml`
- Auth e-posta şablonları ve markalı e-posta varlıkları
- Migrationlar commit edilebilir; production'a gönderim ayrı bir operasyon ve ayrıca
  doğrulanmalıdır. Bekleyen migrationlar toplu olarak körlemesine push edilmemelidir.

### 3. Yayın dokümanları ve güvenli araçlar

- `docs/ROUTE_TO_LIVE.html`, `docs/CURSOR_CHANGE_HANDOFF.md`
- Kurulum, Play Console, Resend ve test dokümanları
- Release, e-posta, ekran görüntüsü ve tanı scriptleri
- Yalnız anonimleştirilmiş final mağaza görselleri

## Git dışında kalacak yerel çıktılar

- `node-v*.pkg` kurulum paketleri
- `*.eas-root-bak`, `*.bak-<numara>` yerel yedekleri
- `docs/sim-*.png` simülatör kanıtları
- `docs/app-store-screenshots/source/` ham ekran görüntüleri
- Eski `marketing-v1/` ve `marketing-v2/` denemeleri
- `.env`, anahtar, sertifika, servis hesabı ve signing dosyaları

## Koruma kuralları

1. Kullanıcı değişiklikleri silinmez veya resetlenmez.
2. Commit öncesinde staged secret taraması ve `git diff --check` çalıştırılır.
3. Migration commit'i production deploy anlamına gelmez.
4. Public store medyasında yalnız daha önce anonimlik kontrolünden geçen final klasörleri kullanılır.
5. Her commit bir önceki çalışan durum üzerine kurulur; TypeScript/export kapıları yeniden çalıştırılır.
