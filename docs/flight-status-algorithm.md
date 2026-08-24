# FlyFam — Flight Status Algorithm Spec
> Bu dosya Cursor'da referans alınmak üzere hazırlanmıştır.
> Tüm implementation kararları bu spec'e göre alınmalıdır.

---

## 1. Enum Tanımları

```typescript
// Kullanıcıya gösterilebilir statüler
// DELAYED artık yok — gecikme ayrı delay_minutes alanıyla gösterilir
export type FlightStatus =
  | 'SCHEDULED'
  | 'TAXI_OUT'
  | 'EN_ROUTE'
  | 'LANDED'
  | 'CANCELLED';

// Internal-only (DB'de tutulur, kullanıcıya gösterilmez)
export type InternalStatus = FlightStatus | 'LANDED_CANDIDATE';

export type FlightPhase =
  | 'PASSIVE_FUTURE'
  | 'SEMI_ACTIVE'
  | 'ACTIVE'
  | 'PASSIVE_PAST';

export type ActiveSubWindow =
  | 'PRE_DEPARTURE_WATCH'
  | 'DEPARTURE_CRITICAL'
  | 'CRUISE'
  | 'ARRIVAL_CRITICAL'
  | 'POST_LANDING_RECONCILE';

export type DelayPhase = 'departure' | 'arrival';
```

---

## 2. Delay Modeli

### Temel Kural
`DELAYED` statüsü kaldırıldı. Gecikme bilgisi her zaman `status` ile birlikte ayrı alanda taşınır.

```
dep_delay_minutes = estimated_dep - scheduled_dep
arr_delay_minutes = estimated_arr - scheduled_arr
```

- Pozitif → gecikme
- Negatif → erken
- `null` → henüz estimated bilgi yok (zamanında sayılır)

### Kullanıcıya Gösterim Mantığı

| Status | dep_delay_minutes | arr_delay_minutes | Kullanıcı Görür |
|---|---|---|---|
| `SCHEDULED` | null | null | "Planlandı" |
| `SCHEDULED` | +47 | — | "Planlandı · +47 dk gecikme bekleniyor" |
| `TAXI_OUT` | +23 | — | "Taxide · +23 dk gecikmeli kalkış" |
| `EN_ROUTE` | — | null | "Havada" |
| `EN_ROUTE` | — | +31 | "Havada · +31 dk gecikmeli iniş" |
| `LANDED` | — | -5 | "İndi · 5 dk erken" |
| `CANCELLED` | — | — | "İptal edildi" |

### Threshold — Ne Zaman Gösterilir?
- `|delay_minutes| >= 5` → göster
- `|delay_minutes| < 5` → gösterme (zamanında say)

### Provider Kaynakları

| Alan | Airlabs | FR24 | ADB |
|---|---|---|---|
| `estimated_dep` | ✅ `dep_estimated` | ✅ | ✅ |
| `estimated_arr` | ✅ `arr_estimated` | ✅ | ✅ |
| `dep_delayed` (hazır dakika) | ✅ cross-check için | ❌ | ❌ |
| `arr_delayed` (hazır dakika) | ✅ cross-check için | ❌ | ❌ |

> Airlabs'ın `dep_delayed` / `arr_delayed` alanları cross-check için kullanılır.
> Asıl hesap her zaman `estimated - scheduled` üzerinden yapılır.

---

## 3. Faz Tanımları

| Faz | Koşul | Poll Sıklığı | Provider |
|---|---|---|---|
| `PASSIVE_FUTURE` | `now < STD - 3h` | ❌ API yok | — |
| `SEMI_ACTIVE` | `STD - 3h ≤ now < STD - 20min` | 1 saatte bir | Airlabs → ADB fallback |
| `ACTIVE` | `STD - 20min ≤ now ≤ landed + 2min` | Sub-window'a göre | FR24 primary, Airlabs support |
| `PASSIVE_PAST` | Uçuş tamamlandı | ❌ API yok | — |

### Faz Geçiş Kuralları
- `PASSIVE_FUTURE → SEMI_ACTIVE`: `now >= STD - 3h`
- `SEMI_ACTIVE → ACTIVE`: `now >= STD - 20min`
- `ACTIVE → PASSIVE_PAST`: status `LANDED` confirmed + `review_flag = false`
- **Force-close**: `now > STA + 3h` ve hâlâ ACTIVE → Section 6'daki kural çalışır

---

## 4. ACTIVE Faz — Sub-Windows

| Sub-Window | Zaman Aralığı | Poll | FR24 Parametreleri | Provider |
|---|---|---|---|---|
| `PRE_DEPARTURE_WATCH` | `STD-20min → STD` | 5 dk | `first_seen`, `datetime_takeoff` | FR24 full + Airlabs fallback |
| `DEPARTURE_CRITICAL` | `STD → actual_dep+10min` | 5 dk | `first_seen`, `datetime_takeoff` | FR24 full + Airlabs fallback |
| `CRUISE` | `actual_dep+10min → ETA-30min` | 15 dk | `datetime_takeoff`, `last_seen`, `datetime_landed` | FR24 lite |
| `ARRIVAL_CRITICAL` | `ETA-30min → actual_arr+2min` | 5 dk | `datetime_landed`, `last_seen` | FR24 full + Airlabs fallback |
| `POST_LANDING_RECONCILE` | İniş sonrası | 1 kez | `last_seen` teyit, actual zamanları yaz | ADB opsiyonel |

> `ETA` = `estimated_arr` varsa kullan, yoksa `scheduled_arr`

---

## 5. FR24 Parametre Referansı

| Parametre | Anlamı | Kullanım |
|---|---|---|
| `first_seen` | ADS-B sinyalinin ilk görüldüğü zaman | TAXI_OUT sinyali — tek başına hassas, timeout gerektirir |
| `datetime_takeoff` | Gerçek kalkış zamanı | EN_ROUTE için kesin kanıt; `actual_dep` olarak yaz |
| `datetime_landed` | Gerçek iniş zamanı | LANDED için en güçlü sinyal; `actual_arr` olarak yaz |
| `last_seen` | ADS-B sinyalinin son görüldüğü zaman | LANDED teyidi — uçuşun başladığı kanıtlıysa kullanılır |
| `flight_ended` | FR24'ün uçuşu kapattığı flag | ⚠️ TEK BAŞINA KULLANILMAZ — henüz başlamamış uçuşlarda da `true` gelebilir |

---

## 6. Master Karar Motoru (Status Derivation)

### 6a. FR24 Bulundu — Kalkış Tarafı

```
first_seen = null AND datetime_takeoff = null
  → status: SCHEDULED
  → estimated_dep güncelle → dep_delay_minutes hesapla

first_seen var, datetime_takeoff yok, now < STD + 30min
  → status: TAXI_OUT
  → dep_delay_minutes güncelle

first_seen var, datetime_takeoff yok, STD+30min ≤ now < STD+90min
  → status: TAXI_OUT  (hâlâ taxide olabilir)
  → dep_delay_minutes güncelle

first_seen var, datetime_takeoff yok, now ≥ STD+90min
  → status: TAXI_OUT + review_flag = true
  → dep_delay_minutes güncelle

datetime_takeoff var, datetime_landed yok
  → status: EN_ROUTE
  → actual_dep = datetime_takeoff yaz
  → arr_delay_minutes güncelle (estimated_arr varsa)
```

### 6b. FR24 Bulundu — İniş Tarafı

```
datetime_landed var
  → status: LANDED ✅ (güçlü sinyal)
  → actual_arr = datetime_landed yaz
  → arr_delay_minutes = actual_arr - scheduled_arr

datetime_landed yok, last_seen var
  AND (first_seen VEYA datetime_takeoff daha önce görülmüş)
  AND now - last_seen ≥ 20min
  → status: LANDED ✅ (medium confidence)
  → actual_arr = last_seen yaz (approximate)
  → arr_delay_minutes hesapla

Sadece flight_ended = true var
  → Destekleyici sinyal say, tek başına karar verme
  → Diğer kanıtlarla birleştir
```

### 6c. FR24 Bulunamadı — Airlabs Fallback

```
Airlabs status = "en-route"
  → status: EN_ROUTE
  → estimated_arr güncelle → arr_delay_minutes hesapla

Airlabs status = "landed"
  → internal: LANDED_CANDIDATE
  → kullanıcıya: önceki status'u koru, bildirim gönderme
  → actual_arr = arr_estimated yaz (tentative)

Airlabs status = "scheduled" AND now > STD + 30min
  → status: SCHEDULED (değiştirme)
  → estimated_dep güncelle → dep_delay_minutes hesapla
  → dep_delay_minutes > 0 ise kullanıcıya gecikme göster

Airlabs status = "scheduled" AND now ≤ STD + 30min
  → Zamanları güncelle, status değiştirme
  → dep_delay_minutes hesapla

Airlabs da yok
  → Önceki güvenli status'u koru
  → delay_minutes değiştirme
  → Log at, cooldown/retry uygula
```

### 6d. LANDED Teyit Zinciri

```
Güçlü   → datetime_landed var VEYA actual_arr var
            → status: LANDED ✅
            → arr_delay_minutes = actual_arr - scheduled_arr
            → bildirim gönder

Orta    → last_seen var
          AND uçuşun başladığı kanıtlı (first_seen veya datetime_takeoff görülmüş)
          AND now - last_seen ≥ 20min
            → status: LANDED ✅
            → actual_arr ≈ last_seen (approximate, log at)
            → arr_delay_minutes hesapla
            → bildirim gönder

Zayıf   → Sadece Airlabs "landed" VEYA sadece flight_ended = true
            → internal: LANDED_CANDIDATE
            → Kullanıcıya önceki status'u göster
            → Bildirim gönderme
            → Bir sonraki tick'te tekrar kontrol et
```

---

## 7. Force-Close Kuralı

`now > STA + 3h` ve uçuş hâlâ ACTIVE ise:

```
1. datetime_landed var?                          → LANDED ✅
2. actual_arr var?                               → LANDED ✅
3. last_seen var
   AND uçuş başladı kanıtı var
   AND now - last_seen ≥ 20min?                  → LANDED ✅ (medium confidence)
4. Airlabs status = "landed"?                    → LANDED (low confidence, log at)
5. ADB'ye bir kez sor → actual_arr var?          → LANDED ✅
6. Hiçbiri yok?
   → status: SCHEDULED (değiştirme)
   → dep_delay_minutes güncelle (estimated_dep varsa)
   → review_flag = true (internal)
   → flight_ended = true bu zincirde tek başına kullanılmaz
```

---

## 8. Bildirim Kuralları

| Geçiş | Bildirim |
|---|---|
| `SCHEDULED → TAXI_OUT` | ⚡ Opsiyonel |
| `TAXI_OUT → EN_ROUTE` | ✅ Gönder |
| `SCHEDULED → EN_ROUTE` | ✅ Gönder |
| `EN_ROUTE → LANDED` | ✅ Gönder |
| `herhangi → CANCELLED` | ✅ Gönder |
| `dep_delay_minutes` ilk kez ≥ 5 dk oldu | ✅ Gönder ("X dk gecikme bekleniyor") |
| `dep_delay_minutes` önemli ölçüde değişti (±15 dk) | ✅ Gönder |
| `arr_delay_minutes` ilk kez ≥ 5 dk oldu | ✅ Gönder ("İniş X dk gecikmeli") |
| `arr_delay_minutes` önemli ölçüde değişti (±15 dk) | ✅ Gönder |
| Status değişmedi, sadece delay güncellendi (< 15 dk fark) | ❌ Gönderme |

### Güvenlik Kuralları
- **Idempotency**: dedupe key = `flight_id + new_status` — daha önce gönderildiyse atla
- **Delay bildirimi dedupe**: `flight_id + 'delay_dep' + delay_bucket` (bucket = 15 dk aralıklar)
- **LANDED only once**: landed bildirimi gönderildikten sonra bir daha gönderilmez
- **LANDED_CANDIDATE**: teyit gelmeden bildirim gönderilmez

---

## 9. Roster Import Kuralları

### Lock (PASSIVE_FUTURE)
- `source = ROSTER_IMPORT` ve faz = `PASSIVE_FUTURE` ise hiçbir API çağrısı yapılmaz
- `scheduled_dep` / `scheduled_arr` değiştirilmez
- `estimated_dep` / `estimated_arr` null kalır
- `is_roster_verified = false` olarak kalır

### Unlock (SEMI_ACTIVE)
- Faz `SEMI_ACTIVE` olduğunda Airlabs ile ilk external validation yapılır
- Başarılıysa `is_roster_verified = true`, `estimated_*` alanları güncellenir
- `scheduled_*` alanları hâlâ değişmez — delay hesabı için baseline bunlar
- **Strict date match zorunlu** — exact local departure date olmadan flight match yapma

### Timezone Uyarısı
- Roster PDF'leri local / UTC / base time karışık gelebilir
- `roster_raw_dep_text` ham haliyle sakla
- `departure_date_local_origin` explicit olarak yaz
- Faz geçişlerini unverified timezone'a göre tetikleme

---

## 10. Önerilen DB Alanları

```typescript
interface Flight {
  // Kimlik
  id: string;
  flight_number: string;
  departure_date_local_origin: string; // 'YYYY-MM-DD' — origin timezone'da

  // Schedule — bir kez yazılır, değişmez (delay hesabı için baseline)
  scheduled_dep: string;   // ISO UTC
  scheduled_arr: string;   // ISO UTC

  // Estimated — her API çağrısında güncellenir
  estimated_dep?: string;  // ISO UTC
  estimated_arr?: string;  // ISO UTC

  // Actual — gerçekleşince yazılır
  actual_dep?: string;     // ISO UTC — FR24 datetime_takeoff
  actual_arr?: string;     // ISO UTC — FR24 datetime_landed veya last_seen (approximate)

  // Delay — estimated - scheduled üzerinden hesaplanır, DB'ye yazılır
  dep_delay_minutes?: number;  // pozitif = gecikme, negatif = erken
  arr_delay_minutes?: number;

  // FR24 raw signals
  fr24_first_seen?: string;
  fr24_datetime_takeoff?: string;
  fr24_datetime_landed?: string;
  fr24_last_seen?: string;
  fr24_flight_ended?: boolean;  // ⚠️ destekleyici sinyal, tek başına kullanılmaz

  // Status
  phase: FlightPhase;
  status: FlightStatus;            // kullanıcıya gösterilen
  internal_status: InternalStatus; // LANDED_CANDIDATE dahil
  review_flag: boolean;            // internal, kullanıcıya gösterilmez

  // Roster
  source: 'ROSTER_IMPORT' | 'MANUAL';
  is_roster_verified: boolean;
  roster_raw_dep_text?: string;

  // Provider health
  fr24_cooldown_until?: string;
  airlabs_cooldown_until?: string;

  // Notification tracking
  last_checked_at?: string;
  landed_notified_at?: string;
  dep_delay_notified_bucket?: number; // son bildirim gönderilen delay bucket
  arr_delay_notified_bucket?: number;
}
```

---

## 11. Non-Negotiables

1. **`DELAYED` statüsü yok** — gecikme her zaman `dep_delay_minutes` / `arr_delay_minutes` ile gösterilir; status uçuşun nerede olduğunu söyler
2. **`scheduled_*` alanları değişmez** — delay hesabı için baseline bunlar; provider güncellemesi sadece `estimated_*` alanlarını değiştirir
3. **Kullanıcıya `UNKNOWN` gösterme** — emin değilsen status'u değiştirme, `review_flag = true` yap
4. **`flight_ended = true` tek başına iniş kanıtı sayma** — henüz başlamamış uçuşlarda da gelebilir
5. **ACTIVE fazda Airlabs `scheduled` diyorsa körü körüne güvenme** — `estimated_dep` güncelle, `dep_delay_minutes` hesapla, status değiştirme
6. **Sadece `first_seen` ile sonsuza kadar `TAXI_OUT`'ta kalma** — STD+90min'de `review_flag = true`
7. **Onaysız `LANDED` bildirimi gönderme** — strong/medium confirmation şart
8. **Exact local-origin departure date olmadan flight match yapma**
9. **Rate-limit / 429 alan provider'ı her cron tick'te tekrar deneme** — cooldown uygula
10. **Roster-imported schedule'ı `SEMI_ACTIVE`'den önce dış API ile değiştirme**
