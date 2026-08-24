# App Store Connect — Kademeli abonelik paketleri (adım adım)

Hedef: **aylık otomatik yenilenen** paketler (Duo → Circle). Consumable **ek aile add-on (`03`) kalkar**.

Kaynak kod ürün ID’leri: [`mobile/constants/iapProducts.ts`](../mobile/constants/iapProducts.ts)

---

## 0) Önkoşullar

1. App Store Connect’te FlyFam app kaydı açık.
2. Paid Applications Agreement / banking / tax tamam.
3. Bu repoda migration uygulandı: `20260815120000_subscription_tier_packages.sql`  
   (`supabase db push` veya Dashboard SQL).

---

## 1) Abonelik grubu

1. **App Store Connect** → FlyFam → **Subscriptions**.
2. Mevcut grup **`flyfam_base`** varsa onu kullan; yoksa oluştur (Reference Name: `FlyFam Base`).
3. Grupta **tek bir hiyerarşi** olacak (upgrade/downgrade için).

---

## 2) Yedi abonelik seviyesi (aylık + yıllık)

Her seviye için **iki** auto-renewable ürün (Monthly + Yearly).  
**Product ID’ler birebir şöyle olmalı** (sonradan değiştirilemez):

| Seviye (yüksek = üst paket) | Display Name (öneri) | Monthly Product ID | Yearly Product ID | Aile koltuğu |
|----------------------------:|----------------------|--------------------|-------------------|-------------:|
| 1 | FlyFam Duo | `flyfam.duo.monthly` | `flyfam.duo.yearly` | 1 |
| 2 | FlyFam Trio | `flyfam.trio.monthly` | `flyfam.trio.yearly` | 2 |
| 3 | FlyFam Family | `flyfam.family.monthly` | `flyfam.family.yearly` | 3 |
| 4 | FlyFam Family Plus | `flyfam.family_plus.monthly` | `flyfam.family_plus.yearly` | 4 |
| 5 | FlyFam Extended | `flyfam.extended.monthly` | `flyfam.extended.yearly` | 5 |
| 6 | FlyFam Clan | `flyfam.clan.monthly` | `flyfam.clan.yearly` | 6 |
| 7 | FlyFam Circle | `flyfam.circle.monthly` | `flyfam.circle.yearly` | 7 |

Her ürün için:

1. **Subscription Duration:** 1 Month veya 1 Year.
2. **Subscription Prices:** bölgesel fiyat ekle (ör. TR, US, EU). Öneri merdiven: Duo en düşük → Circle en yüksek.
3. **Localizations:** EN + TR isim/açıklama (ör. “1 crew + N family members”).
4. **Review screenshot** / not: “Crew selects package on Plans screen; family seat limit enforced server-side.”
5. Grup içinde **Level / Ranking**: Duo = 1 … Circle = 7 (Apple UI’da “higher service level” = daha yüksek numara).

### Eski ürünler (`01` / `02`)

- Varsa Duo monthly/yearly olarak **tut** veya yeni ID’lere geçiş sonrası yeni aboneleri yeni ID’lere yönlendir.
- Backend hâlâ `01`/`02` → `duo` map ediyor (mevcut aboneler bozulmasın).

### Promosyonel teklif (opsiyonel)

- Sadece **Duo monthly** (`flyfam.duo.monthly` veya eski `01`) üzerinde 1 haftalık intro / promotional offer.
- `EXPO_PUBLIC_IOS_MONTHLY_PROMO_OFFER_ID` = ASC’deki offer reference name.

---

## 3) Add-on’u kapat

1. Consumable **`03`** / `flyfam_extra_user_slot` → **Remove from Sale** veya Cleared for Sale = No.
2. Uygulama artık add-on satmıyor; satın alınırsa backend hata döner.

---

## 4) Uygulama sürümü

1. In-App Purchases bölümünde **yeni 14 abonelik ürününü** (7×2) bu version’a ekle.
2. Review notes’a paket tablosunu yapıştır.
3. TestFlight build al (native IAP için).

---

## 5) Sandbox test

Sandbox Apple ID ile sırayla dene:

1. Duo satın al → Plans’ta Duo, aile limiti 1.
2. Trio’ya yükselt → limit 2; Apple proration / upgrade.
3. Restore Purchases.
4. Add-on `03` satın alınmaya çalışılmamalı (UI yok).

---

## 6) Backend / repo (sen veya CI)

```bash
cd /path/to/FLYFAM
npx supabase db push   # migration
# gerekirse verify-store-purchase edge zaten apply_verified_store_purchase RPC kullanıyor
```

Kontrol:

```sql
select code, max_family_members, ios_product_id_monthly, active, sort_order
from app_subscription_plans
order by sort_order;
```

---

## 7) Fiyat önerisi (başlangıç — sen bölgeselleştir)

| Paket | Aile | Örnek aylık (USD list) |
|-------|-----:|------------------------|
          <tr><td>Çift</td><td>1</td><td>2.99</td><td>~10× aylık (2 ay hediye)</td></tr>
          <tr><td>Üçlü</td><td>2</td><td>3.99</td><td>aynı mantık</td></tr>
          <tr><td>Aile</td><td>3</td><td>4.99</td><td></td></tr>
          <tr><td>Geniş Aile</td><td>4</td><td>5.99</td><td></td></tr>
          <tr><td>Büyük Aile</td><td>5</td><td>6.99</td><td></td></tr>
          <tr><td>Sülale</td><td>6</td><td>7.99</td><td></td></tr>
          <tr><td>Geniş Sülale</td><td>7</td><td>8.99</td><td></td></tr>

Yıllık ≈ 10× aylık (2 ay hediye) gibi kurgulanabilir.

---

## İsimler (profesyonel)

Kullanıcı önerisindeki “Mahalle / Sülale” yerine mağaza ve UI’da:

- **Duo / Trio / Family / Family Plus / Extended / Clan / Circle**

TR açıklamalarda hâlâ “1 ekip + N aile” net yazılır.
