# Gani Logbook v1
- SHGM SHT-FCL, revision 11.06.2025, Madde 4(1)(r): night = sunset+30min to sunrise-30min. Official PDF https://web.shgm.gov.tr/documents/sivilhavacilik/files/mevzuat/sektorel/talimatlar/karma/SHT-FCL11.06.2025.pdf (download and text verified 2026-10-31).
- SunCalc 1.9.0: https://github.com/mourner/suncalc/tree/v1.9.0 ; BSD-2-Clause. Solar event estimate uses standard apparent horizon -0.833 degrees; fixed 30 minute offsets, not civil twilight -6 degrees.
- Airport coordinates: https://github.com/datasets/airport-codes/blob/master/data/airport-codes.csv , OurAirports public-domain source. large_airport / medium_airport only. Snapshot 2026-10-31. Code aliases IATA, GPS, ident.
- Aircraft type rules provided by user: TCRxx=A321; TCNxx/TCDxx=A320.
- UTC time basis explicitly confirmed by user. Actual Off/On Block used; planned subject times excluded.
- PF→PIC explicitly requested by user, separately editable; this mapping is not proof of legally acting as PIC.
- Night time is a route estimate: great-circle constant-speed interpolation between actual takeoff and landing, endpoints for taxi; minute midpoint classification, sum rounded to nearest minute. No actual track or speed history available. No result for missing airport/times or polar absent solar events. Manual override retained.
- No user flight data, authentication secrets or mail access tokens are included in public site. Gmail ingest currently by report paste, not unattended Gmail synchronization.
- Browser-local data, JSON merge by date/flight/registration/from/to; existing records win. No automatic cross-device synchronization.
