/**
 * Ortak satır tipleri — tüm roster PDF airline modülleri bunu kullanır.
 */

export type PdfFlightRow = {
  flight_number: string;
  flight_date: string;
  /** flight | sim | duty_off — sim DB’ye yazılmaz; duty_off = FSF/FOF (görev penceresi) */
  roster_entry_kind?: 'flight' | 'sim' | 'duty_off';
  /** HH:MM — uçuşta kalkış/iniş **istasyon** lokal saati; duty’de genelde home base lokal */
  dep_time_local?: string | null;
  arr_time_local?: string | null;
  /**
   * THY crew PDF “Kalkış/GMT · İniş/GMT” veya Pegasus tabloda `(Z)` ile işaretli saatler: değerler UTC;
   * doluysa `rowToScheduleIso` atlanır. THY LOKAL SAATLI tabloda boş bırakılır (istasyon lokal → import’ta UTC).
   */
  dep_schedule_utc_iso?: string | null;
  arr_schedule_utc_iso?: string | null;
  origin_iata?: string | null;
  destination_iata?: string | null;
  /** PDF duty satırı: DUTY, FSF, FOF, STBY, STBYA2, OPC3-SIM… */
  duty_occupation_code?: string | null;
  duty_occupation_label_tr?: string | null;
  duty_occupation_label_en?: string | null;
  /** Bitişik duty satırındaki başlangıç saati (DD.MM.YYHH:MM…) */
  duty_start_time_local?: string | null;
  /** Uçuş tablosu: ilk slash çifti = duty end; SIM tablosu: ilk çift = PDF “duty start” sütunu */
  duty_slash_start_date_iso?: string | null;
  duty_slash_start_time_local?: string | null;
  /** Duty end (slash DD/MM/YYYY + saat) */
  duty_end_date_iso?: string | null;
  duty_end_time_local?: string | null;
  /** Uçuş görevi: resting end (ikinci slash çifti); SIM’de genelde yok */
  duty_rest_end_date_iso?: string | null;
  duty_rest_end_time_local?: string | null;
  /**
   * Duty / nöbet / dinlenme saatlerinin PDF’deki anlamı.
   * Pegasus `Active Plan : … (Z)` → `utc` (duvar saati Zulu).
   * `(L)` / THY LOKAL / bilinmiyor → `local` (home base IANA ile UTC’ye çevrilir).
   */
  duty_clock_basis?: 'local' | 'utc' | null;
  /**
   * IndiGo PDF "Training Details" — eşleşen 6E satırına kurs adı (yalnızca IGO import).
   * Diğer havayollarında set edilmez.
   */
  indigo_roster_detail_en?: string | null;
};

/** `rowToScheduleIso` için kalkış / varış IANA (örn. public.airports.timezone_iana). */
export type RowScheduleZones = {
  originTz?: string | null;
  destTz?: string | null;
};
