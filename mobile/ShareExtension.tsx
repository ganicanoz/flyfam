import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator } from 'react-native';
import { openHostApp, InitialProps, View, Text } from 'expo-share-extension';

function pathLooksPdf(p: string): boolean {
  const lower = p.toLowerCase().split('?')[0] ?? '';
  return lower.endsWith('.pdf');
}

/** Mail / Dosyalar: bazen uzantı yok (Inbox); app group kopyası `sharedData` altında. */
function pathLikelySharedPdfFileUrl(p: string): boolean {
  const lower = p.toLowerCase();
  if (!lower.startsWith('file://')) return false;
  if (pathLooksPdf(p)) return true;
  if (lower.includes('/inbox/')) return true;
  if (lower.includes('shareddata')) return true;
  return false;
}

/**
 * Paylaşımdan tek bir PDF URI seç: `files`, yoksa `url` (file://), yoksa tek elemanlı dosya listesi.
 */
function resolveSharedPdfUri(props: InitialProps): string | null {
  const files = props.files ?? [];
  const fromFiles =
    files.find((f) => pathLooksPdf(f)) ?? files.find((f) => f.toLowerCase().includes('.pdf'));
  if (fromFiles) return fromFiles;
  if (files.length === 1) return files[0]!;

  const u = props.url?.trim();
  if (u && pathLikelySharedPdfFileUrl(u)) return u;

  if (files.length > 0) return files[0]!;
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * iOS Paylaşım / Dışa aktar sayfası — PDF dosyası seçilince ana uygulamayı
 * `flyfam:///import-pdf?uri=...` ile açar (`PdfImportLinkingListener` → AddFlight).
 *
 * Hızlı tekrar paylaşımda native taraf attachments’ı biraz gecikmeli verir;
 * hemen “PDF bulunamadı” göstermemek için kısa retry yapılır.
 */
export default function ShareExtension(props: InitialProps) {
  const [msg, setMsg] = useState<string | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    openedRef.current = false;

    const run = async () => {
      const deadlines = [0, 200, 500, 1000, 1800, 2800];
      let pdf: string | null = null;
      for (const waitMs of deadlines) {
        if (waitMs > 0) await sleep(waitMs);
        if (cancelled) return;
        pdf = resolveSharedPdfUri(props);
        if (pdf) break;
      }
      if (cancelled) return;
      if (!pdf) {
        setMsg(
          'PDF bulunamadı. Aynı dosyayı peş peşe çok hızlı paylaşıyorsanız bir iki saniye bekleyip tekrar deneyin. FlyFam roster PDF’lerini içe aktarır.',
        );
        return;
      }
      if (openedRef.current) return;
      openedRef.current = true;
      openHostApp(`import-pdf?uri=${encodeURIComponent(pdf)}`);
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [props.files, props.url]);

  if (msg) {
    return (
      <View style={{ flex: 1, padding: 16, justifyContent: 'center' }}>
        <Text allowFontScaling={false}>{msg}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
      <ActivityIndicator size="large" />
      <Text allowFontScaling={false} style={{ marginTop: 12 }}>
        FlyFam’a aktarılıyor…
      </Text>
    </View>
  );
}
