import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const TR_TEXT = `FlyFam KVKK AYDINLATMA METNI

1) Veri sorumlusu
Bu uygulama kapsaminda kisisel verileriniz FlyFam tarafindan veri sorumlusu sifatiyla islenir.

2) Islenen veri kategorileri
- Kimlik ve iletisim: ad-soyad, e-posta
- Hesap ve profil: rol bilgisi, havayolu/ekip bilgileri, tercih edilen dil
- Ucus ve baglanti verileri: ucus numaralari, tarih/saat, aile-baglanti durumlari
- Teknik veriler: oturum kayitlari, uygulama hata kayitlari, cihaz bildirim tokeni

3) Isleme amaclari
- Hesap olusturma, kimlik dogrulama ve oturum yonetimi
- Ucus bilgilerinin gosterimi ve aile baglantisi ozelliklerinin calismasi
- Bildirim gonderimi, guvenlik, dolandiricilik ve kotuye kullanim onleme
- Destek taleplerinin yanitlanmasi ve hizmet kalitesinin iyilestirilmesi
- Yasal yukumluluklerin yerine getirilmesi

4) Hukuki sebepler
Verileriniz KVKK m.5 kapsaminda acik riza gerektiren hallerde acik rizaniza, diger hallerde sozlesmenin ifasi, mesru menfaat ve hukuki yukumluluk sebeplerine dayanilarak islenir.

5) Aktarim
Verileriniz; altyapi, veritabani, bildirim ve barindirma hizmeti saglayicilarina, hizmetin sunulmasi amaciyla ve gerekli teknik/idari tedbirler alinmis olarak aktarilabilir. Yasal zorunluluk halinde yetkili kurumlarla paylasim yapilabilir.

6) Saklama suresi
Kisisel veriler, isleme amacinin gerektirdigi sure boyunca ve ilgili mevzuatta ongorulen saklama sureleri kadar muhafaza edilir.

7) Haklariniz
KVKK m.11 kapsaminda; verinizin islenip islenmedigini ogrenme, duzeltme, silme/anonimlestirme, itiraz ve zarar giderimi gibi haklara sahipsiniz.

8) Basvuru
KVKK kapsamindaki taleplerinizi FlyFam destek kanallari uzerinden iletebilirsiniz.

9) Guncelleme
Bu metin gerektiğinde guncellenebilir. Onemli degisikliklerde uygulama icinden yeniden onay talep edilebilir.`;

const EN_TEXT = `FlyFam PRIVACY NOTICE

1) Data controller
Your personal data is processed by FlyFam as the data controller.

2) Categories of data
- Identity/contact: full name, email
- Account/profile: role, airline/crew data, language preference
- Flight/connection data: flight numbers, dates/times, family connection status
- Technical data: session records, app error logs, push notification token

3) Purposes of processing
- Account creation, authentication and session management
- Showing flight information and operating family connection features
- Sending notifications, security and abuse prevention
- Handling support requests and improving service quality
- Fulfilling legal obligations

4) Legal bases
Data is processed under applicable legal bases, including explicit consent where required, contract performance, legitimate interest, and legal obligations.

5) Transfers
Data may be transferred to infrastructure/database/notification/hosting providers for service delivery, with appropriate technical and administrative safeguards. It may be shared with authorized authorities when legally required.

6) Retention
Personal data is stored for as long as necessary for the processing purpose and any legally required retention periods.

7) Your rights
You may request access, correction, deletion/anonymization, objection, and compensation under applicable data protection laws.

8) Contact
You can submit your privacy-related requests via FlyFam support channels.

9) Updates
This notice may be updated when needed. For material changes, we may require re-consent in the app.`;

export default function PrivacyNoticeScreen() {
  const { i18n } = useTranslation();
  const isTr = i18n.language?.toLowerCase().startsWith('tr');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{isTr ? 'KVKK Aydinlatma Metni' : 'Privacy Notice'}</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.body}>{isTr ? TR_TEXT : EN_TEXT}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 20, paddingTop: 56 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  scroll: { flex: 1 },
  content: { paddingBottom: 28 },
  body: { color: '#d4d4d8', fontSize: 14, lineHeight: 22 },
});

