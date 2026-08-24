# Pegasus roster PDF

Crew duty roster: `DD.MM.YY` + DUTY/FSF/FOF/STBY/SIM, slash tabloları, `PC ####` + dört satır (kalkış IATA, saat, varış IATA, saat).

- `lineScan.ts` — satır bazlı Pegasus (duty PDF’inde çoğunlukla `parseFlightsFromPdfText` tarafından kapatılır)
- `dutyTable.ts` — ana layout (çekirdek + tek-satır yedek)
