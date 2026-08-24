/**
 * PDF roster → flight_number, flight_date, optional local times (TR wall clock), optional route IATA.
 * Import uses `add_me_to_flight` RPC (flight_crew + RLS).
 *
 * **Modül ağacı:** `roster-pdf/` — şu an **Pegasus** PDF (`airlines/pegasus/`); THY vb. `airlines/<kod>/`.
 * Bu dosya yalnızca geriye dönük import yolu için ince barrel’dır.
 *
 * Paylaşılan kaynak: mobil + script + Edge (`parse-roster-pdf` bu barrel’ı import eder).
 * Edge bundler göreli yollar için `.ts` uzantısı ister — `public.ts` açık yazılır.
 */

export * from './roster-pdf/public.ts';
