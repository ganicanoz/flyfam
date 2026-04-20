import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

const TR_TEXT = `KULLANIM KOSULLARI VE SORUMLULUK REDDI

1) Hizmetin kapsamı
FlyFam, ucus verilerini ve aile-baglanti odakli bilgilendirme ozelliklerini sunar. Sunulan bilgiler, ucuncu taraf veri saglayicilarindan alinabilir.

2) Dogruluk ve sureklilik
Veriler gecikmeli, eksik veya hatali olabilir. FlyFam, tum verilerin her zaman kesintisiz ve hatasiz olacagini garanti etmez.

3) Operasyonel kararlar
Uygulamadaki veriler; operasyonel, emniyet, resmi veya ticari kritik kararlar icin tek basina dayanak olmamalidir. Nihai kararlar icin resmi kaynaklar kullanilmalidir.

4) Kullanici yukumlulugu
Kullanici; hesabinin guvenligini saglamak, sifresini korumak ve uygulamayi hukuka uygun kullanmakla yukumludur.

5) Ucuncu taraf servisler
Uygulama, harici API ve servislerden veri alabilir. Bu servislerdeki kesinti veya hata, uygulama icerigini etkileyebilir.

6) Bildirimler
Anlik bildirimlerin zamaninda ulasmasi cihaz, ag ve servis kosullarina baglidir; kesin teslimat garantisi yoktur.

7) Sorumlulugun siniri
Mevzuatin izin verdigi olcude FlyFam; veri gecikmesi, eksikligi veya uygulama erisilebilirliginden kaynaklanan dolayli zararlardan sorumlu tutulamaz.

8) Degisiklik
Kosullar zaman zaman guncellenebilir. Onemli guncellemelerde uygulama ici bilgilendirme ve gerekirse yeniden onay alinabilir.
`;

const EN_TEXT = `TERMS OF USE AND DISCLAIMER

1) Scope of service
FlyFam provides flight information and family-connection oriented features. Data may come from third-party providers.

2) Accuracy and availability
Data may be delayed, incomplete, or inaccurate. FlyFam does not guarantee uninterrupted or error-free data at all times.

3) Operational decisions
Information shown in the app must not be used as the sole source for operational, safety-critical, official, or commercial decisions. Always rely on official sources for final decisions.

4) User responsibilities
Users are responsible for account security, password protection, and lawful use of the app.

5) Third-party services
The app may consume data from external APIs/services. Interruptions or errors in those services may affect app content.

6) Notifications
Real-time notification delivery depends on device, network, and service conditions; timely delivery is not guaranteed.

7) Limitation of liability
To the extent permitted by law, FlyFam is not liable for indirect damages arising from delays, missing data, or service unavailability.

8) Changes
These terms may be updated. For material updates, in-app notice and re-consent may be required.
`;

export default function TermsDisclaimerScreen() {
  const { i18n } = useTranslation();
  const isTr = i18n.language?.toLowerCase().startsWith('tr');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{isTr ? 'Kullanim ve Sorumluluk Reddi' : 'Terms and Disclaimer'}</Text>
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

