# Base44 Admin Panel Setup

Files:

- `docs/ADMIN_STATUS_DASHBOARD.html` — main admin panel  
- `docs/BASE44_ADMIN_EMBED.html` — wrapper (iframe + `dashboardUrl` query)

## Why Supabase Storage shows `text/plain` for your HTML

For **public** Storage objects, Supabase (and the CDN in front) often serves **`.html` as `text/plain`** on purpose so the browser does not treat it as a normal web page. Upload metadata / `curl` headers usually **do not fix** that for the public GET response.

Supabase Edge Functions also **rewrite** `text/html` → `text/plain` on GET ([Development tips](https://supabase.com/docs/guides/functions/development-tips)).

So: **do not host these two HTML files on Supabase Storage or Edge Functions** if you need them to render in Chrome / Base44.

## Recommended: GitHub Pages (free, HTTPS)

1. Push this repo to GitHub (if it is not there yet).
2. Repo **Settings → Pages**
3. **Build and deployment → Source:** “Deploy from a branch”
4. **Branch:** `main` (or your default branch), **Folder:** `/docs`
5. After deploy, your site root is the contents of the `docs/` folder.

Your URLs will look like:

`https://<github-username>.github.io/<repo-name>/BASE44_ADMIN_EMBED.html`

Base44 final link (same host for embed + dashboard):

`https://<github-username>.github.io/<repo-name>/BASE44_ADMIN_EMBED.html?dashboardUrl=https%3A%2F%2F<github-username>.github.io%2F<repo-name>%2FADMIN_STATUS_DASHBOARD.html`

Replace `<github-username>` and `<repo-name>` with yours (path segments URL-encoded in `dashboardUrl` as above).

Logo: keep `docs/Görseller/image.png` in the repo; `./Görseller/image.png` in the dashboard still works when Pages serves from `/docs`.

**Splash / intro video mockup (admin):** `https://<github-username>.github.io/<repo-name>/admin/splash-preview.html` — Admin panel sol menüde **Splash · video önizleme** linkiyle de açılır. Asset’ler `docs/admin/mobile-assets/` içinde tutulur; güncellerken `docs/admin/README.md` komutuna bakın.

### Cache / `304 Not Modified`

If you change HTML and the browser still shows an old version, append a version query once:

`.../BASE44_ADMIN_EMBED.html?v=2&dashboardUrl=...`

## Other static hosts

Netlify Drop, Cloudflare Pages, Vercel static — upload the same files; Base44 only needs a stable **HTTPS** URL pair.

## Optional: logo on Supabase Storage

If you still want the logo in Storage (e.g. for other tools), from repo root:

```bash
export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_SECRET"

npm install
npm run admin:upload-static
```

This uploads `docs/Görseller/image.png` → `Görseller/image.png` in bucket `admin-static` (PNG is fine on Storage).

## Base44

Add a menu / page whose URL is the **GitHub Pages** (or other host) final link from above — not the `*.supabase.co/storage/...` HTML URL.

## Password change (backend)

- UI: **Change password** in the user table  
- Edge: `action: "update_user_password"` in `supabase/functions/admin-dashboard/index.ts`

Deploy:

```bash
supabase functions deploy admin-dashboard
```

## `localStorage` on the embed page

`BASE44_ADMIN_EMBED.html` caches the last `dashboardUrl` under `flyfam_admin_embed_url_v2`. If the iframe points at a wrong URL, clear site data for that host or use a private window once.
