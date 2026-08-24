# Subscription Roadmap (Deferred)

Bu doküman, abonelik sistemini kapalı test sonrası devreye almak için hafıza notudur.

## Karar (Nisan 2026)

- Yaklaşık 1 ay kapalı test süresince gerçek App Store / Google Play abonelik akışı devreye alınmayacak.
- Bu sürede premium özellikler ürün testine odaklı olarak manuel/operasyonel yönetilecek.
- Store tabanlı satın alma + restore akışı kapalı test sonrası açılacak.

## Neden Ertelendi

- Kapalı testte ana hedef: ürün doğrulama, stabilite ve UX.
- Store abonelik akışı (satın alma, restore, grace period, iptal, refund) ek karmaşıklık yaratır.
- Bu karmaşıklık ürün geri bildirim hızını düşürür.

## Şu Anda Hazır Olan Altyapı

Aşağıdaki parçalar repoda hazırlandı ve sonradan aktive edilebilir:

- DB migration:
  - `supabase/migrations/20260406120000_create_subscriptions.sql`
- Edge functions:
  - `supabase/functions/validate-apple-subscription/index.ts`
  - `supabase/functions/validate-google-subscription/index.ts`
  - `supabase/functions/subscription-status/index.ts`
- Mobile helper:
  - `mobile/lib/subscriptionApi.ts`
- Session profile desteği:
  - `mobile/contexts/SessionContext.tsx` (`profile.is_premium`)
- Kurulum notları:
  - `docs/SUBSCRIPTION_SETUP.md`

## Kapalı Test Sürecinde Uygulanacak Yaklaşım

- Store purchase/restore butonları kapalı veya pasif tutulur.
- Premium erişim gerekirse manuel olarak `profiles.is_premium` güncellenir.
- Ürün davranışı premium flag’e göre test edilir.

## Sonradan Devreye Alma Planı (Checklist)

1. **Store hazırlığı**
   - Apple App Store Connect abonelik ürünü aktif
   - Google Play Console subscription ürünü aktif
   - Test kullanıcıları ve test track’ler doğrulandı

2. **Secrets**
   - Apple:
     - `APPLE_ISSUER_ID`
     - `APPLE_KEY_ID`
     - `APPLE_PRIVATE_KEY_P8`
     - `APPLE_BUNDLE_ID`
   - Google:
     - `GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL`
     - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`

3. **Supabase deploy**
   - Migration push
   - Edge deploy:
     - `validate-apple-subscription`
     - `validate-google-subscription`
     - `subscription-status`

4. **Mobil entegrasyon**
   - Purchase + Restore UI bağlama
   - Satın alma sonrası:
     - iOS -> `validate-apple-subscription`
     - Android -> `validate-google-subscription`
   - Uygulama açılışında `subscription-status` ile entitlement sync

5. **Webhooklar (production için önerilen)**
   - App Store Server Notifications V2
   - Google RTDN
   - İptal/grace/refund durumlarını sunucuda anlık işleme

6. **QA senaryoları**
   - Aynı hesapla birden fazla cihazda premium erişim
   - Restore purchases
   - İptal + dönem sonuna kadar erişim
   - Grace period / payment retry

## Operasyon Notu

Hedef model: **abonelik cihaz bazlı değil, hesap bazlı entitlement**.
Bu sayede kullanıcı aynı FlyFam hesabıyla birden fazla cihazda premium özellikleri kullanabilir.
