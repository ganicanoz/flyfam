// Supported airlines – loaded from FlyFam pro airline dataset (all major airlines).
// Dataset kopyası mobile/docs içine taşındı ki Metro bundler doğrudan erişebilsin.
import rawAirlines from '../docs/flyfam_airlines_pro_dataset.json';
import { Image } from 'react-native';
export type Airline = {
  icao: string;
  iata: string;
  name: string;
  logoUrl: string;
};

// Logo base fallback: avs.io (reliable in RN). Format: https://pics.avs.io/64/64/IATA.png
const logoUrl = (iata: string) => `https://pics.avs.io/64/64/${iata}.png`;

type AirlineDatasetItem = {
  name: string;
  iata?: string;
  icao?: string;
  domain?: string;
  logo?: string;
};

function toAirline(item: AirlineDatasetItem): Airline | null {
  const iata = item.iata?.trim().toUpperCase();
  const icao = item.icao?.trim().toUpperCase();
  if (!iata || !icao || !item.name) return null;

  return {
    icao,
    iata,
    name: item.name,
    // Clearbit logo URL'leri genelde .ico formatında olduğu için React Native'de düzgün görünmüyor.
    // Tüm havayolları için avs.io üzerinden 64x64 PNG logo kullanıyoruz.
    logoUrl: logoUrl(iata),
  };
}

export const AIRLINES: Airline[] = (rawAirlines as AirlineDatasetItem[])
  .map(toAirline)
  .filter((a): a is Airline => a !== null);

// Air ACT (ACT Airlines) için özel logo (Wikipedia kaynağından üretilen asset).
try {
  const airActIndex = AIRLINES.findIndex(
    (a) => a.icao.toUpperCase() === 'RUN' || a.iata.toUpperCase() === '9T'
  );
  if (airActIndex !== -1) {
    const resolved = Image.resolveAssetSource(
      require('../assets/airlines/air-act.png')
    );
    if (resolved?.uri) {
      AIRLINES[airActIndex] = {
        ...AIRLINES[airActIndex],
        logoUrl: resolved.uri,
      };
    }
  }
} catch {
  // Asset bulunamazsa sessizce avs.io fallback kullanılmaya devam edilir.
}

