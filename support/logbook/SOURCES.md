# Gani Logbook v1
- SHGM SHT-FCL, revision 11.06.2025, Madde 4(1)(r): night = sunset+30min to sunrise-30min. Official PDF https://web.shgm.gov.tr/documents/sivilhavacilik/files/mevzuat/sektorel/talimatlar/karma/SHT-FCL11.06.2025.pdf (download and text verified 2026-10-31).
- SunCalc 1.9.0: https://github.com/mourner/suncalc/tree/v1.9.0 ; BSD-2-Clause. Solar event estimate uses standard apparent horizon -0.833 degrees; fixed 30 minute offsets, not civil twilight -6 degrees.
- Airport coordinates: https://github.com/datasets/airport-codes/blob/master/data/airport-codes.csv , OurAirports public-domain source. large_airport / medium_airport only. Snapshot 2026-10-31. Code aliases IATA, GPS, ident.
- Aircraft type rules provided by user: TCRxx=A321; TCNxx/TCDxx=A320.
- UTC time basis explicitly confirmed by user. Actual Off/On Block used; planned subject times excluded.
- PF→PIC explicitly requested by user, separately editable; this mapping is not proof of legally acting as PIC.
- Night time is a route estimate: great-circle constant-speed interpolation between actual takeoff and landing, endpoints for taxi; minute midpoint classification, sum rounded to nearest minute. No actual track or speed history available. No result for missing airport/times or polar absent solar events. Manual override retained.
- No user flight data, authentication secrets or mail access tokens are included in public site. Gmail sync uses Google Identity Services token model with gmail.readonly scope. On-demand user gesture; only Flight Logbook label is requested by the app. OAuth public client ID has not yet been configured. Tokens are never persisted. Token model: https://developers.google.com/identity/oauth2/web/guides/use-token-model . Gmail list/get/attachment APIs: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list .
- Browser-local data, JSON merge by date/flight/registration/from/to; existing records win. No automatic cross-device synchronization.

## v1.1
Navy, white, black theme. PF/PM review queue for newly imported records; pending functions are uncredited. Full paginated label scan; existing selections and manual edits preserved. Conflicting changed fields reported without overwriting. Plain text/HTML and attached RFC822 (.eml) decoding; summary table support. Source summary aggregate discrepancies surfaced. UI and offline tested; live OAuth connection requires owner-approved Google Cloud setup and consent.

## v1.2 user layout (31 October 2026)
- Reference: JAR-FCL 1.080 / IEM logbook columns, official ANAC archived JAR-FCL: https://www.anac.pt/SiteCollectionDocuments/Pessoal_Aeronautico/Licencas/JARFCL1_Emenda3.pdf and Hellenic Air Force IEM https://www.haf.gr/wp-content/uploads/2015/01/JAR-FCL1_AM07_SEC2.pdf . This customized view is not a certification of regulatory compliance.
- User expressly requested PF-to-PIC mapping and duplicate block duration in an Engine Time / ME column; multi-pilot duration remains separate. PF alone does not establish legal PIC status.
- Display/import cutoff inclusive 2026-10-12; earlier existing records preserved in device backup but excluded from displayed totals. First three lines reserved; missing HEL-SAW 12 October is a clearly marked empty fourth slot, never a fabricated flight.
- Every flight counts one day/night arrival using On Block at destination, per user request; approximate and distinct from actual landing timestamp or personal PF landing credit. Night block uses equal-speed great-circle interpolation over full Off/On block.
- Sunrise/sunset times for departure and arrival dates/coordinates added to remarks in UTC.
- Each page 16 slots, page totals + prior page cumulative + carried total. Opening earlier logbook balances unknown and explicitly excluded.

## v1.2.4 correction
User corrected ME: no flight duration in SE/ME; only previous balance carried. Opening balances are independent and supplied privately via backup JSON, simulator balance in section 13 only. Airport dataset arrays corrected from longitude/latitude to latitude/longitude required by SunCalc.

## v1.3
- User requests all block time as IFR; applied to records on migration/import and report parsing.
- Report crew GANI CAN OZ / 21895 FIRSTOFFICER required when a named operating First Officer is present; other role/other FO marked pass and excluded. No FO inference from Submitted By or assigned device. All 22 local EML reports include GANI as FO; none removed from this set.
- Drive appDataFolder scope: https://developers.google.com/workspace/drive/api/guides/appdata . Online saves create immutable JSON snapshots (no overwrite/delete), verify by reading saved data, check latest snapshot ID before upload, and retain device recovery before remote replacement. Sign in on each device, load last snapshot, use explicit Online kaydet; offline remains device-only until successful online save. OAuth tokens remain closure-memory only.
