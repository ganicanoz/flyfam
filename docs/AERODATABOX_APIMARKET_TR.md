# AeroDataBox — API.Market (RapidAPI dışı)

RapidAPI aylık kota dolduğunda uçuş ve havalimanı tahtası için **API.Market** kaynağı kullanılır.

## Kayıt

1. [apimarket.aerodatabox.com](https://apimarket.aerodatabox.com/) üzerinden plan seçin.
2. Dashboard’dan **API key** (`x-magicapi-key`) kopyalayın.

Resmi gateway (OpenAPI):

`https://prod.api.market/api/v1/aedbx/aerodatabox`

Dokümantasyon: [doc.aerodatabox.com — API.Market](https://doc.aerodatabox.com/apimarket.html)

## Supabase Edge secrets

```bash
cd /path/to/FLYFAM
npx supabase secrets set \
  AERODATABOX_APIMARKET_KEY="YOUR_X_MAGICAPI_KEY" \
  AERODATABOX_APIMARKET_BASE="https://prod.api.market/api/v1/aedbx/aerodatabox" \
  AERODATABOX_SKIP_RAPIDAPI=true
```

Ardından ilgili fonksiyonları deploy edin:

```bash
npx supabase functions deploy check-flight-status-and-notify
npx supabase functions deploy sync-hub-airport-boards
```

## Mobil (`mobile/.env`)

```env
EXPO_PUBLIC_AERODATABOX_APIMARKET_KEY=YOUR_X_MAGICAPI_KEY
EXPO_PUBLIC_AERODATABOX_SKIP_RAPIDAPI=true
```

## Öncelik

Kod varsayılanı: **API.Market önce**, RapidAPI yedek (`AERODATABOX_SKIP_RAPIDAPI=true` ile RapidAPI tamamen kapatılır).

Hub tahta cron: `sync-hub-airport-boards` — ADB, ESB, SAW, IST, AYT, ECN.
