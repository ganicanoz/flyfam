# Takvim + Pegasus PDF İçe Aktarma Özelliği

## Özet

- **Crew:** Pegasus kurumsal uygulamasından alınan PDF’i yükleyerek önümüzdeki günlere ait uçuşları toplu kaydedebilecek.
- **Takvim sayfası:** Hem crew hem aile, uçuşları haftalık/aylık takvim üzerinde görecek.
- **Liste–takvim uyumu:** Mevcut uçuş listesi (Roster) takvimle uyumlu kalacak; crew günlük uçuşları uçuştan önce onaylayabilecek (confirm).
- **Yeni sayfa:** Alt sekmelere “Takvim” eklenebilir veya Roster içinde takvim görünümü seçeneği sunulabilir.

---

## 1. Pegasus PDF İçe Aktarma (Crew)

- Crew, “Uçuş Ekle” veya yeni “Takvim” / “İçe Aktar” akışında **PDF yükle** seçeneği ile Pegasus’tan indirdiği roster PDF’ini seçer.
- Uygulama PDF’i parse eder (metin çıkarma: `expo-document-picker` + PDF.js veya backend’de parser).
- Tarih + uçuş numarası + rota (varsa) çıkarılır; önümüzdeki günler için `flights` tablosuna kayıt atılır.
- İlk aşamada **sadece Pegasus** formatı hedeflenir; format dokümante edilir, ileride başka havayolu eklenebilir.

**Teknik not:** PDF formatı (Pegasus’un kurumsal uygulama çıktısı) bir örnek dosya ile netleştirilmeli. `docs/GANI CAN OZ - MARt26.pdf` örnek olarak kullanılabilir; yapı analiz edilip parser kuralları yazılacak.

---

## 2. Takvim Sayfası (Yeni Sekme / Görünüm)

- **Crew:** Kendi uçuşlarını haftalık veya aylık takvimde görür. Gün seçince o günün uçuş listesi (mevcut Roster kartlarına benzer) gösterilir.
- **Aile:** Bağlı crew’in uçuşlarını aynı takvim görünümünde görür (sadece okuma).
- Takvim basit tutulur: grid + günler, günde uçuş varsa işaret (nokta/badge) veya mini özet.

**Konum seçenekleri:**

- **A)** Yeni alt sekme: “Takvim” (Roster | Aile | Takvim | Profil) — takvim odaklı kullanım.
- **B)** Roster ekranında üstte “Liste / Takvim” toggle — liste varsayılan, takvim ikinci görünüm.

Öneri: Önce **B** ile Roster içinde takvim görünümü; talep artarsa ayrı **Takvim** sekmesi eklenebilir.

---

## 3. Uçuş Listesinin Takvime Göre Güncellenmesi

- Uçuşlar zaten `flight_date` ile tarih bazlı. Roster listesi bugün/yarın vb. filtrelerle gösteriliyor.
- Takvim görünümü aynı `flights` verisini `flight_date`’e göre günlere dağıtır; ek bir “senkron” gerekmez.
- İleride: Sadece “bu hafta” / “bu ay” gibi filtreler takvim ile ortak kullanılabilir.

---

## 4. Crew’in Günlük Uçuşları Onaylaması (Confirm)

- PDF veya toplu import ile giren uçuşlar “henüz crew tarafından onaylanmadı” sayılabilir.
- Mevcut `flights.schedule_unconfirmed` alanı benzer amaçla kullanılıyor; “timetable’dan doğrulanmadı” anlamında.
- İstenen davranış: **Uçuştan önce** crew o günün uçuşlarını görüp “Doğru, bu uçuşlar bugün geçerli” diye onaylasın.
- Bu için:
  - Ya `schedule_unconfirmed` / “confirmed by crew” mantığı genişletilir,
  - Ya yeni bir alan eklenir: örn. `crew_confirmed_at` (timestamptz) veya `confirmed_by_crew boolean`.
- Takvim / liste üzerinde “Onayla” butonu veya swipe ile onay akışı eklenebilir.

---

## Uygulama Adımları (Önerilen Sıra)

1. **PDF format analizi**  
   Pegasus örnek PDF’ini incele; metin yapısı, tarih ve uçuş satırı formatı çıkar.

2. **Takvim UI (sadece görüntüleme)**  
   Roster ekranına “Liste / Takvim” toggle + basit haftalık/aylık grid. Veri kaynağı: mevcut `flights` + `flight_date`.

3. **Aile tarafında takvim**  
   Aynı takvim bileşenini aile dashboard’unda veya “Bağlı crew uçuşları” ekranında kullan; veri: bağlı crew’in `flights` kayıtları.

4. **PDF import (Pegasus)**  
   PDF seçimi → backend veya client-side parse → `flights` insert (crew_id, flight_date, flight_number, vb.). İlk versiyonda sadece tarih + uçuş numarası bile yeterli olabilir.

5. **Confirm akışı**  
   DB’de onay alanı (gerekirse), UI’da “Bu günün uçuşlarını onayla” / tek uçuş onayı.

6. **İsteğe bağlı**  
   Ayrı “Takvim” sekmesi; PDF’i “Takvim” içinden açılan “İçe aktar” ile de sunabilirsin.

---

## Kısa Özet

| Özellik | Açıklama |
|--------|----------|
| Pegasus PDF | Crew PDF yükler → parse → önümüzdeki günler için uçuşlar kaydedilir |
| Takvim | Haftalık/aylık grid; crew ve aile uçuşları gün bazında görür |
| Liste | Roster listesi takvimle aynı veriyi kullanır; takvim “görünüm” olur |
| Confirm | Crew, uçuştan önce o günün uçuşlarını onaylar (DB + küçük UI) |
| Yeni sayfa | Takvim için ya yeni sekme ya da Roster içinde “Takvim” görünümü |

Bu plan senin tarif ettiğin akışla uyumlu. İstersen bir sonraki adımda Pegasus PDF’in yapısını birlikte çıkarıp parser taslağını yazabiliriz; ya da önce sadece takvim UI’ı (liste + takvim toggle) ile başlayabiliriz.
