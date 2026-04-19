# Destek sayfasını canlıya alma

Tek dosya: `index.html`. Aşağıdaki yollardan birini kullan.

---

## 1) Netlify Drop (en kolay – Git yok)

1. [app.netlify.com/drop](https://app.netlify.com/drop) sayfasını aç.
2. `support` klasörünü **sürükle bırak** (veya içindeki `index.html`’i zip’leyip zip’i bırak).
3. Netlify anında bir URL verir (örn. `https://rastgele-isim.netlify.app`).  
   Hesap açmak zorunlu değil; kalıcı link için giriş yapıp site adını değiştirebilirsin.

---

## 2) GitHub Pages (repo zaten GitHub’daysa)

1. Repo → **Settings** → **Pages** → **Source**: **GitHub Actions**.
2. `support/` ve workflow’u push et. Push sonrası sayfa otomatik yayına girer.  
   URL: `https://<kullanici>.github.io/<repo-adi>/`

---

## 3) Vercel

1. [vercel.com](https://vercel.com) → **Add New** → **Project** → Repo’yu seç.
2. **Root Directory**: `support` yap.
3. **Deploy** tıkla.

---

E-posta adresini değiştirmek için `index.html` içinde `support@flyfam.app` metnini düzenle.

---

## Admin: splash + video önizlemesi

Deploy sırasında workflow, `docs/admin/` içeriğini `support/admin/` altına kopyalar. Canlı sitede:

`https://<kullanici>.github.io/<repo>/admin/splash-preview.html`

Ana destek sayfasındaki **Yönetici** linki de buraya gider. Kaynak tek doğruluk: `docs/admin/` (bkz. `docs/admin/README.md`).
