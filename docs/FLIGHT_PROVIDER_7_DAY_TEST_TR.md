# FlyFam — 7 günlük uçuş API sağlayıcı testi

## Amaç

Pegasus, Türk Hava Yolları, SunExpress ve Freebird uçuşlarında sağlayıcıları iki ayrı konuda ölçmek:

1. **Gelecek programı:** Uçuştan 7, 4, 3 ve 1 gün önce rota ve plan saatleri bulunuyor mu?
2. **Canlı operasyon:** Kalkış, iniş, gecikme, iptal/divert ve kuyruk kodu ne kadar doğru ve hızlı geliyor?

## Test seti

- Her havayolundan en az 10 uçuş, toplam en az 40 uçuş.
- İç ve dış hat, gece yarısını geçen uçuş ve charter örnekleri bulunmalı.
- Referans değer olarak roster PDF kullanılır; gerçek kalkış ve iniş sonradan havayolu/airport kaydıyla doğrulanır.

## Ölçümler

- Uçuşu bulma oranı
- Doğru tarih ve rota oranı
- STD/STA farkı (dakika)
- ETD/ETA bulunma oranı ve farkı
- Gerçek kalkış/iniş gecikmesi
- Kuyruk kodu bulunma oranı
- İptal ve divert yakalama oranı
- HTTP hata/429 oranı
- Uçuş başına tüketilen sorgu/kredi

## Çalıştırma

Belirli bir tarih ve uçuş grubu için:

```bash
cd /Users/mineoz/gani-apps/FLYFAM
npm run flight-provider-snapshot -- --date 2026-09-17 PC271 TK2410 XQ118 FH1303
```

Raporlar:

- `docs/FLIGHT_PROVIDER_SNAPSHOT.html`
- `docs/FLIGHT_PROVIDER_PARAMETERS_SNAPSHOT.html`

Anahtarlar rapora yazılmaz; yalnızca sağlayıcının yapılandırılmış olup olmadığı gösterilir.

## Değerlendirme ağırlığı

- Gelecek programını bulma ve saat doğruluğu: **%35**
- Gerçek kalkış/iniş doğruluğu: **%25**
- Kuyruk kodu: **%15**
- İptal/divert/gecikme: **%10**
- Maliyet: **%10**
- Hata ve rate-limit dayanıklılığı: **%5**

## Beklenen rol dağılımı

- **AeroDataBox:** Gelecek programı ve operasyonel metadata adayı.
- **AirLabs:** Gelecek programı için ikinci aday/fallback.
- **FR24:** Gelecek programında değerlendirme dışı; canlı kalkış, iniş ve kuyruk doğrulayıcısı.
- **AeroAPI:** Kalite karşılaştırması ve son fallback; ticari minimum maliyeti ayrıca değerlendirilir.
- **FlightAPI:** Düşük maliyetli son fallback adayı.

## Karar eşiği

Bir sağlayıcının gelecek programında ana kaynak olabilmesi için 3–4 gün öncesinde:

- uçuşu bulma oranı en az **%95**,
- doğru rota oranı en az **%98**,
- STD/STA medyan farkı en fazla **5 dakika**,
- 429/5xx oranı en fazla **%1** olmalıdır.
