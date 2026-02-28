// Supported airlines – Pegasus, Turkish Airlines, SunExpress, AJet
export type Airline = {
  icao: string;
  iata: string;
  name: string;
  logoUrl: string;
};

// Logo base: avs.io (reliable in RN). Format: https://pics.avs.io/64/64/IATA.png
const logoUrl = (iata: string) => `https://pics.avs.io/64/64/${iata}.png`;

export const AIRLINES: Airline[] = [
  { icao: 'PGT', iata: 'PC', name: 'Pegasus Airlines', logoUrl: logoUrl('PC') },
  { icao: 'THY', iata: 'TK', name: 'Turkish Airlines', logoUrl: logoUrl('TK') },
  { icao: 'SXS', iata: 'XQ', name: 'SunExpress', logoUrl: logoUrl('XQ') },
  { icao: 'TKJ', iata: 'VF', name: 'AJet', logoUrl: logoUrl('VF') },
];
