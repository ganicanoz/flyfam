# FlyFam - Görev Öncesi Alkol Emniyet Hatırlatıcısı

## 1. Amaç

Crew kullanıcısına bir sonraki uçuş görevi veya standby başlangıcından önce alkolsüz dönemin ne zaman başladığını hatırlatmak.

Bu özellik:

- tüketilebilecek içki miktarını hesaplamaz,
- kişisel promil tahmini yapmaz,
- kullanıcıya uçuşa elverişli olduğunu söylemez,
- şirket prosedürünün veya tıbbi değerlendirmenin yerine geçmez.

## 2. Dayanak

- SHGM uygulamasında uçuş ve kabin ekipleri için kan alkol sınırı 0,20 promildir. Uçuş görevi ve standby sırasında alkol tüketilemez.
- EASA AMC1 CAT.GEN.MPA.100(c)(1), belirlenmiş report veya standby başlangıcından önceki en az 8 saatte alkol tüketilmemesini ve görev başlangıcında kan alkol düzeyinin ulusal sınır veya 0,2 promilden düşük olanını aşmamasını öngörür.
- FAA, 8 saatin yalnızca asgari süre olduğunu; kişinin yasal sınırın altında veya uçuşa uygun olduğunu garanti etmediğini belirtir. Daha muhafazakâr yaklaşım olarak 24 saat önerilir.
- Sistematik derlemelerde, kandaki alkol sıfıra yaklaşmış olsa bile hangover sırasında sürekli dikkat, bellek, psikomotor hız ve sürüş performansında bozulma bulunmuştur.

Kaynaklar:

- SHGM: https://web.shgm.gov.tr/tr/s/5999-shgm-yeni-duzenleme-kapsaminda-alkol-tarama-testlerine-basladi
- EASA Easy Access Rules for Air Operations: https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-air-operations
- FAA Alcohol and Flying: https://www.faa.gov/pilots/safety/pilotsafetybrochures/media/alcohol.pdf
- Gunn ve ark., 2018 sistematik derleme: https://pubmed.ncbi.nlm.nih.gov/30144191/

## 3. Ürün adı

- Türkçe: Görev Öncesi Alkol Hatırlatıcısı
- İngilizce: Pre-duty Alcohol Reminder

Arayüzde kısa ad olarak "Alkol Emniyet Hatırlatıcısı" kullanılabilir.

## 4. Temel zaman kuralı

Sistem bir sonraki uygun görevin report zamanını bulur.

`alkolsüz dönem başlangıcı = report zamanı - seçilen emniyet süresi`

Uygun görevler:

- uçuş görevi,
- deadhead içeren görev,
- standby / nöbet,
- şirket tarafından uçuşa hazır bulunmayı gerektiren diğer görevler.

OFF, izin, toplantı ve simülatör varsayılan olarak hesaplamaya dahil edilmez. Şirket politikası gerektiriyorsa ileride yönetilebilir kural olarak eklenebilir.

## 5. Emniyet süresi seçenekleri

### Standart - varsayılan

12 saat. FlyFam'in önerilen varsayılanıdır. FAA'nın 12-24 saatlik muhafazakâr yaklaşımıyla uyumludur.

### Yüksek emniyet

24 saat. Kullanıcı özellikle uzun uçuş, gece görevi veya kendi şirket prosedürü için seçebilir.

### Şirket prosedürü

Kullanıcı 8 saatten az olmamak üzere şirketinin belirlediği süreyi girer. Seçim ekranında bunun kullanıcı tarafından girilen şirket kuralı olduğu açıkça gösterilir.

### Yasal asgari

8 saat yalnızca bilgilendirme amacıyla gösterilir. Varsayılan yapılmaz ve "asgari sınır; uçuşa uygunluğu garanti etmez" uyarısı taşır.

## 6. Bildirim akışı

### A. Ön bilgilendirme

Alkolsüz dönem başlamadan 2 saat önce:

**Başlık:** Alkolsüz döneminiz yaklaşıyor

**Metin:** Yarın 08.30 reportlu göreviniz için alkolsüz döneminiz bugün 20.30'da başlayacak.

### B. Dönem başlangıcı

Tam başlangıç zamanında:

**Başlık:** Görev öncesi alkolsüz dönem başladı

**Metin:** 08.30 reportlu göreviniz için seçtiğiniz 12 saatlik emniyet dönemi başladı. Şirket prosedürünüz daha kısıtlayıcıysa onu uygulayın.

### C. Yaklaşan görev

Reporttan 8 saat önce yalnızca seçilen süre 12 veya 24 saat ise:

**Başlık:** Görevinize 8 saat kaldı

**Metin:** Uçuş görevi veya standby öncesindeki asgari alkolsüz süre içindesiniz. Kendinizi uygun hissetmiyorsanız göreve başlamayın ve şirket prosedürünü uygulayın.

### D. Roster erkene alınırsa

Yeni report zamanı nedeniyle alkolsüz dönem geçmişte başlamış oluyorsa hemen bildirim:

**Başlık:** Görev saatiniz değişti

**Metin:** Yeni report saatiniz 06.00. Seçtiğiniz alkolsüz dönem başlamış durumda. Güncel programınızı ve şirket prosedürünüzü kontrol edin.

### E. Görev sonrasında

Uygulama "alkol tüketebilirsiniz" demez. Yalnızca sıradaki görevi bildirir:

**Başlık:** Sonraki görev planı

**Metin:** Sonraki report saatiniz yarın 18.20. Seçtiğiniz 12 saatlik alkolsüz dönem yarın 06.20'de başlayacak.

## 7. Uygulama ekranı

Profil > Emniyet Hatırlatıcıları altında:

1. Aç/kapat anahtarı
2. Emniyet süresi: 12 saat / 24 saat / şirket prosedürü
3. Başlamadan önce ek uyarı: Kapalı / 1 saat / 2 saat
4. Standby görevlerini dahil et: açık ve değiştirilemez
5. Saat dilimi açıklaması: report meydanının yerel saati
6. Sonraki hesaplanan alkolsüz dönem kartı

Kart örneği:

> Sonraki report: 12 Eylül 08.30 - AYT<br>
> Alkolsüz dönem başlangıcı: 11 Eylül 20.30<br>
> Kural: Standart - 12 saat

## 8. İlk kullanım onayı

Özellik açılırken kullanıcı şu metni kabul eder:

> FlyFam yalnızca programınıza göre hatırlatma oluşturur. Alkol düzeyinizi ölçmez veya tahmin etmez ve uçuşa elverişli olduğunuzu doğrulamaz. Yasal kurallar, şirket prosedürünüz, sağlık durumunuz ve kaptan/işletici talimatları her zaman önceliklidir. Alkol etkisi veya hangover şüpheniz varsa göreve başlamayın.

## 9. Emniyet kuralları

- Mesajlarda "güvenli", "içebilirsiniz", "promiliniz sıfırdır" veya benzeri kesin ifadeler kullanılmaz.
- İçecek türü, miktarı, kilo veya cinsiyet üzerinden kişisel eliminasyon hesabı yapılmaz.
- Kahve, duş, uyku veya egzersizin eliminasyonu hızlandırdığı yönünde öneri verilmez.
- Bildirim kaçırılmış veya telefon çevrimdışı olsa bile uygulama uygunluk kararı üretmez.
- Kullanıcı kendisini uygun hissetmediğini işaretlerse yalnızca şirket prosedürünü izleme ve operasyon birimiyle iletişim kurma yönlendirmesi gösterilir.

## 10. Teknik hesaplama kuralları

- Ana kaynak roster içindeki `report` zamanıdır.
- Report yoksa planlı ilk kalkıştan şirketçe tanımlanan report payı geri hesaplanmaz; kartta "Report saati eksik" gösterilir.
- Tüm hesaplar görevin başladığı meydanın yerel saat diliminde yapılır.
- Roster değiştiğinde mevcut planlanan bildirimler iptal edilip yeniden oluşturulur.
- Aynı duty içindeki uçuşlar ayrı bildirim üretmez.
- Standby, görev başlangıcı olarak kabul edilir.
- Cihaz saat dilimi değişse bile mutlak zaman korunur; gösterim görev meydanının yerel saatiyle yapılır.

## 11. Gizlilik

- Kullanıcının içki tüketip tüketmediği sorulmaz ve kaydedilmez.
- Sunucuda yalnızca özelliğin açık olması, seçilen süre ve bildirim tercihi tutulur.
- Sağlık verisi veya tahmini promil oluşturulmaz.
- Aile üyeleri bu ayarı ve bildirimleri göremez.

## 12. Başarı ölçümü

Yalnızca anonim ürün olayları ölçülür:

- özellik açıldı,
- emniyet süresi seçildi,
- bildirim planlandı,
- bildirim açıldı,
- roster değişikliği nedeniyle bildirim yeniden planlandı.

Alkol tüketimine ilişkin olay veya kullanıcı beyanı kaydedilmez.

## 13. Kabul kriterleri

- Varsayılan süre 12 saattir.
- Sistem 8 saatten kısa seçim kabul etmez.
- Standby hesaplamaya dahildir.
- Report değişince bildirimler en geç bir dakika içinde yeniden planlanır.
- Geçmiş zamana kayan başlangıç için anlık uyarı oluşur.
- Hiçbir ekranda tüketilebilir alkol miktarı veya uçuşa uygunluk sonucu gösterilmez.
- Türkçe ve İngilizce metinler aynı emniyet anlamını taşır.

## 14. Önerilen ilk sürüm kapsamı

İlk sürümde yalnızca 12 saat ve 24 saat seçenekleri sunulmalıdır. Şirket prosedürü seçeneği, havayolu bazlı doğrulanmış kurallar yönetilebildiğinde ikinci sürüme bırakılmalıdır. Böylece kullanıcı yanlış şirket süresi girerek hatalı güven hissine kapılmaz.
