# Cron kurulumu kontrolü

## Mevcut durum

- **Migration `20260229100000_cron_check_flight_status_every_2min.sql`** sadece yorum içeriyor; **hiçbir cron job oluşturmuyor**. Yani `supabase db push` ile otomatik bir 2 dakikalık cron **gelmiyor**.
- 2 dakikalık güncelleme için cron’u **sen** tanımlamalısın: ya harici (cron-job.org vb.) ya da Supabase pg_cron ile.

---

## 1. Cron var mı nasıl kontrol edilir?

### A) Harici cron kullanıyorsan (cron-job.org, GitHub Actions vb.)

- Cron-job.org: Hesabına gir → Cronjobs → 2 dakikada bir çalışan, `check-flight-status-and-notify` URL’sine POST atan job var mı bak.
- GitHub Actions: Repoda `.github/workflows` altında bu Edge Function’ı her 2 dk çağıran workflow var mı kontrol et.

### B) Supabase pg_cron kullanıyorsan

1. **Dashboard:** Supabase projesi → **Database** → **Cron Jobs** (veya **Integrations** → **Cron**) aç.
2. Listede `check-flight-status-and-notify` veya benzeri isimde, **her 2 dakikada** çalışan bir job görüyor musun?

**SQL ile kontrol (pg_cron açıksa):**

Supabase → **SQL Editor** → New query, aşağıyı çalıştır:

```sql
-- pg_cron kurulu ve cron job'ları listelenebiliyor mu?
SELECT jobid, jobname, schedule, command
FROM cron.job
ORDER BY jobname;
```

Burada `check-flight-status-and-notify` veya 2 dakikalık periyotla çalışan bir job görünmeli.

### C) Edge Function loglarından kontrol

1. Supabase Dashboard → **Edge Functions** → **check-flight-status-and-notify** → **Logs**.
2. Son birkaç dakikada düzenli (ör. her 2 dk) **POST** istekleri ve 200/401/500 cevapları var mı bak.
3. İstekler **x-cron-secret** ile geliyorsa cron’dan çağrılıyor demektir.

---

## 2. Cron yoksa nasıl kurulur?

### Seçenek A – Harici cron (cron-job.org, ücretsiz)

1. [cron-job.org](https://cron-job.org) → hesap aç / giriş.
2. **Create cronjob**
3. **URL:**  
   `https://<PROJECT_REF>.supabase.co/functions/v1/check-flight-status-and-notify`  
   (Supabase Dashboard → Settings → API → Project URL’deki ref’i kullan.)
4. **Method:** POST  
5. **Headers:**  
   - Name: `x-cron-secret`  
   - Value: Supabase’te Edge Function secret olarak tanımlı **CRON_SECRET** değeri (aynısı).
6. **Schedule:** Every 2 minutes (veya her 2 dakika seçeneği).
7. Kaydet. İstersen “Execute now” ile bir kere tetikleyip Edge Function log’unda görünüp görünmediğini kontrol et.

### Seçenek B – Supabase pg_cron (Pro plan gerekebilir)

1. Dashboard → **Database** → **Extensions** → **pg_cron** ve **pg_net** etkinleştir.
2. Supabase dokümantasyonundaki “Scheduling Edge Functions with pg_cron” örneğine göre `net.http_post` ile yukarıdaki URL’ye, `x-cron-secret` header’ı ile POST atacak bir `cron.schedule` job’ı oluştur (her 2 dakika).
3. Gerekirse **Vault**’ta `cron_secret` ve `project_url` secret’larını tanımlayıp SQL’de kullan.

---

## 3. Özet

| Ne aranıyor? | Nerede bakılır? |
|--------------|------------------|
| Cron job tanımlı mı? | Harici: cron-job.org / Actions. Supabase: Dashboard → Cron Jobs veya `cron.job` SQL. |
| Gerçekten çağrılıyor mu? | Edge Function **check-flight-status-and-notify** → Logs (düzenli POST’lar). |
| Migration cron oluşturuyor mu? | **Hayır.** `20260229100000_...` dosyası no-op; cron’u sen kurmalısın. |

Cron kurulu değilse aile “kalktı/indi” bildirimini sadece crew uygulaması güncelleme yaptığında alır; her 2 dakikada otomatik güncelleme olmaz.
