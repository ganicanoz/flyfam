# Destek / yasal site – canlıya alma

GitHub Pages kaynağı: `support/` klasörü. Workflow: `.github/workflows/deploy-support.yml`.

Markalı canlı kök: `https://app.flyfamapp.com/`

| Yol | İçerik |
| --- | --- |
| `/` | Marketing yönlendirme → `https://flyfam.base44.app/Landing` |
| `/support/` | Destek / SSS / iletişim (`flyfamapp@gmail.com`) |
| `/privacy-policy.html` | Gizlilik |
| `/terms-of-use.html` | Kullanım koşulları |
| `/auth-callback.html` | Auth deep-link köprüsü |
| `/admin/` | Ops konsolu (noindex; admin JWT ile API) |

App Store:
- Marketing URL: `https://app.flyfamapp.com/` (kök → Base44 marketing)
- Support URL: `https://app.flyfamapp.com/support/`

Kaynak dosya: `docs/ADMIN_STATUS_DASHBOARD.html` ↔ `support/admin/index.html` (deploy öncesi senkron).

`support/CNAME` GitHub Pages özel alanını `app.flyfamapp.com` olarak sabitler.
