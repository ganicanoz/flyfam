// MVP airlines – Pegasus, Turkish Airlines, SunExpress
export type Airline = {
  icao: string;
  iata: string;
  name: string;
  logoUrl: string;
};

export const AIRLINES: Airline[] = [
  {
    icao: 'PGT',
    iata: 'PC',
    name: 'Pegasus Airlines',
    logoUrl: 'https://images.kiwi.com/airlines/64/PC.png',
  },
  {
    icao: 'THY',
    iata: 'TK',
    name: 'Turkish Airlines',
    logoUrl: 'https://images.kiwi.com/airlines/64/TK.png',
  },
  {
    icao: 'SXS',
    iata: 'XQ',
    name: 'SunExpress',
    logoUrl: 'https://images.kiwi.com/airlines/64/XQ.png',
  },
];
