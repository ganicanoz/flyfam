#!/usr/bin/env python3
"""Regenerate supabase/templates/confirmation.html and recovery.html with FlyFam logo + brand colors."""

from __future__ import annotations

import argparse
import base64
import io
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "supabase" / "templates"
EMAIL_ASSET = ROOT / "supabase" / "email-assets" / "flyfam-email-logo.png"
LOGO_SRC = ROOT / "docs" / "Görseller" / "flyfam_icons_transparent" / "ios_transparent_120.png"
LOGO_FALLBACK = ROOT / "mobile" / "assets" / "icon-final-iOS-Default-1024x1024@1x.png"
EMAIL_ASSETS_BUCKET = os.environ.get("EMAIL_ASSETS_BUCKET", "admin-static").strip()

BRAND = {
    "bg_outer": "#EEF3F9",
    "bg_card": "#FFFFFF",
    "bg_footer": "#F1F6FF",
    "bg_account": "#F1F6FF",
    "border_card": "#E1EAF5",
    "border_account": "#D6E4F7",
    "text": "#0B1220",
    "text_body": "#22324C",
    "text_muted": "#6B7A90",
    "accent": "#1D4FA3",
    "primary": "#5AA6FF",
    "gradient": "linear-gradient(165deg,#D8E8FD 0%,#B4CCFB 38%,#9BB8F5 68%,#7BA8EE 100%)",
    "btn_shadow": "0 4px 16px rgba(29,79,163,0.32)",
}


def build_email_logo_png() -> bytes:
    """Opaque 176px logo for mail clients (Gmail blocks data: URIs)."""
    from PIL import Image, ImageDraw

    src = LOGO_SRC if LOGO_SRC.exists() else LOGO_FALLBACK
    icon = Image.open(src).convert("RGBA")
    size = 176
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=36, fill=(255, 255, 255, 255))
    icon.thumbnail((120, 120), Image.Resampling.LANCZOS)
    ox = (size - icon.width) // 2
    oy = (size - icon.height) // 2
    canvas.paste(icon, (ox, oy), icon)
    buf = io.BytesIO()
    canvas.convert("RGB").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_email_logo_asset() -> Path:
    EMAIL_ASSET.parent.mkdir(parents=True, exist_ok=True)
    EMAIL_ASSET.write_bytes(build_email_logo_png())
    return EMAIL_ASSET


def logo_public_url() -> str:
    explicit = os.environ.get("SUPABASE_EMAIL_LOGO_URL", "").strip()
    if explicit:
        return explicit
    base = (
        os.environ.get("SUPABASE_URL", "").strip()
        or os.environ.get("EXPO_PUBLIC_SUPABASE_URL", "").strip()
    ).rstrip("/")
    if not base:
        return ""
    return f"{base}/storage/v1/object/public/{EMAIL_ASSETS_BUCKET}/brand/flyfam-email-logo.png"


def logo_img_src() -> str:
    """Prefer HTTPS (mail clients); fall back to base64 for local HTML preview only."""
    url = logo_public_url()
    if url:
        return url
    b64 = base64.b64encode(build_email_logo_png()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def logo_img_html(src: str) -> str:
    return f"""<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto 18px;">
                <tr>
                  <td align="center" style="background:#FFFFFF;border-radius:20px;border:3px solid rgba(255,255,255,0.85);padding:6px;line-height:0;">
                    <img src="{src}" width="80" height="80" alt="FlyFam" style="display:block;border:0;border-radius:14px;outline:none;text-decoration:none;" />
                  </td>
                </tr>
              </table>"""


def render(
    title_tr: str,
    title_en: str,
    preheader: str,
    tr_body: str,
    cta_label: str,
    cta_sub: str,
    en_body: str,
    footer_tr: str,
    footer_en: str,
    logo_html: str,
    cta_href: str,
) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <title>{title_tr} / {title_en}</title>
</head>
<body style="margin:0;padding:0;background:{BRAND['bg_outer']};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:{BRAND['text']};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:{BRAND['bg_outer']};padding:36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:{BRAND['bg_card']};border-radius:22px;border:1px solid {BRAND['border_card']};box-shadow:0 10px 40px rgba(11,18,32,0.07);overflow:hidden;">
          <tr>
            <td style="background:{BRAND['gradient']};padding:40px 28px 34px;text-align:center;">
              {logo_html}
              <div style="font-size:30px;font-weight:800;letter-spacing:-0.03em;color:{BRAND['text']};line-height:1.1;">FlyFam</div>
              <motion.div lang="en" style="font-size:11px;font-weight:600;letter-spacing:0.14em;color:{BRAND['accent']};margin-top:10px;opacity:0.9;">CREW ROSTER &middot; FAMILY FLIGHT TRACKING</motion.div>
            </td>
          </tr>
          <tr>
            <td lang="tr" style="padding:32px 28px 8px;">
              <span style="display:inline-block;background:{BRAND['bg_account']};color:{BRAND['accent']};font-size:11px;font-weight:700;letter-spacing:0.06em;padding:5px 11px;border-radius:6px;border:1px solid #BFD9FF;">T&#252;rk&#231;e</span>
              <div style="font-size:22px;font-weight:700;line-height:1.3;color:{BRAND['text']};padding:18px 0 12px;">{title_tr}</div>
              <div style="font-size:16px;line-height:1.65;color:{BRAND['text_body']};padding-bottom:16px;">{tr_body}</div>
              <div style="font-size:14px;line-height:1.5;color:{BRAND['text_muted']};padding:14px 16px;background:{BRAND['bg_account']};border-radius:12px;border:1px solid {BRAND['border_account']};">
                <span style="color:#93A8C6;">Hesap / Account</span><br />
                <strong style="color:{BRAND['text']};font-size:15px;">{{{{ .Email }}}}</strong>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 28px 26px;text-align:center;">
              <a href="{cta_href}" style="display:inline-block;background:{BRAND['accent']};color:#ffffff !important;text-decoration:none;font-weight:700;font-size:16px;line-height:1.35;padding:16px 38px;border-radius:12px;box-shadow:{BRAND['btn_shadow']};">{cta_label}</a>
              <div style="font-size:12px;color:{BRAND['text_muted']};margin-top:14px;line-height:1.45;">{cta_sub}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px;"><div style="border-top:1px solid {BRAND['border_card']};height:1px;"></div></td>
          </tr>
          <tr>
            <td lang="en" style="padding:26px 28px 8px;">
              <span style="display:inline-block;background:#E8F8EF;color:#166534;font-size:11px;font-weight:700;letter-spacing:0.06em;padding:5px 11px;border-radius:6px;border:1px solid #BBF7D0;">ENGLISH</span>
              <div style="font-size:22px;font-weight:700;line-height:1.3;color:{BRAND['text']};padding:18px 0 12px;">{title_en}</div>
              <div style="font-size:16px;line-height:1.65;color:{BRAND['text_body']};">{en_body}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 30px;background:{BRAND['bg_footer']};border-top:1px solid {BRAND['border_card']};">
              <p style="margin:0 0 10px;font-size:12px;line-height:1.55;color:{BRAND['text_muted']};"><strong style="color:{BRAND['accent']};">TR:</strong> {footer_tr}</p>
              <p style="margin:0 0 14px;font-size:12px;line-height:1.55;color:{BRAND['text_muted']};"><strong style="color:{BRAND['accent']};">EN:</strong> {footer_en}</p>
              <p style="margin:22px 0 0;font-size:11px;color:#93A8C6;text-align:center;">© FlyFam</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
""".replace("{{{{", "{{").replace("}}}}", "}}").replace("motion.div", "div")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--write-logo-asset",
        action="store_true",
        help="Write supabase/email-assets/flyfam-email-logo.png only",
    )
    args = parser.parse_args()
    if args.write_logo_asset:
        path = write_email_logo_asset()
        print("Wrote", path)
        return

    write_email_logo_asset()
    logo_html = logo_img_html(logo_img_src())
    src = logo_img_src()
    if src.startswith("http"):
        print("Logo URL:", src)
    else:
        print("Warning: no SUPABASE_URL — using base64 (Gmail/Outlook may hide the logo).")
        print("  Upload: node scripts/upload-email-brand-assets.mjs")

    auth_bridge = "https://ganicanoz.github.io/flyfam/auth-callback.html"
    signup_href = f"{auth_bridge}?token_hash={{{{ .TokenHash }}}}&amp;type=signup"
    recovery_href = f"{auth_bridge}?token_hash={{{{ .TokenHash }}}}&amp;type=recovery"

    (TEMPLATES / "confirmation.html").write_text(
        render(
            "E-posta adresinizi doğrulayın",
            "Verify your email address",
            "FlyFam — E-posta doğrulama · Verify your email",
            "Merhaba,<br /><br />FlyFam'e hoş geldiniz. Hesabınızı etkinleştirmek ve uçuş programınızı yönetmeye başlamak için e-posta adresinizi onaylayın.",
            "Verify in FlyFam<br /><span style=\"font-size:13px;font-weight:500;opacity:0.92;\">FlyFam&#39;de do&#287;rula</span>",
            "Do&#287;rulama i&#231;in k&#305;sa s&#252;re taray&#305;c&#305; a&#231;&#305;labilir; ard&#305;ndan FlyFam uygulamas&#305; a&#231;&#305;l&#305;r.<br />A brief browser step is normal; then the FlyFam app opens.",
            "Welcome to FlyFam. Please confirm your email to activate your account and start managing your roster and sharing flights with your family.<br /><br />Use the button above — the <strong>FlyFam</strong> app will open after verification.",
            f'Buton çalışmazsa: <a href="{signup_href}" style="color:#1D4FA3;font-weight:600;text-decoration:underline;">doğrulama bağlantısı</a>',
            f'If the button does not work: <a href="{signup_href}" style="color:#1D4FA3;font-weight:600;text-decoration:underline;">verification link</a>',
            logo_html,
            signup_href,
        ),
        encoding="utf-8",
    )
    (TEMPLATES / "recovery.html").write_text(
        render(
            "Şifrenizi sıfırlayın",
            "Reset your password",
            "FlyFam — Şifre sıfırlama · Password reset",
            "FlyFam hesabınız için şifre sıfırlama talebi aldık. Yeni şifre belirlemek için düğmeye dokunun. Bu talebi siz yapmadıysanız bu e-postayı yok sayın.",
            "Reset password<br /><span style=\"font-size:13px;font-weight:500;opacity:0.92;\">&#350;ifremi s&#305;f&#305;rla</span>",
            "K&#305;sa s&#252;re taray&#305;c&#305; a&#231;&#305;labilir; ard&#305;ndan FlyFam a&#231;&#305;l&#305;r. Ba&#287;lant&#305; s&#305;n&#305;rl&#305; s&#252;re ge&#231;erlidir.<br />A brief browser step is normal; then FlyFam opens. Link expires soon.",
            "We received a request to reset your FlyFam password. Use the button above to set a new password. If you did not request this, ignore this email.",
            f'Buton çalışmazsa: <a href="{recovery_href}" style="color:#1D4FA3;font-weight:600;text-decoration:underline;">şifre sıfırlama bağlantısı</a>',
            f'If the button does not work: <a href="{recovery_href}" style="color:#1D4FA3;font-weight:600;text-decoration:underline;">password reset link</a>',
            logo_html,
            recovery_href,
        ),
        encoding="utf-8",
    )
    print("Updated", TEMPLATES / "confirmation.html", "and", TEMPLATES / "recovery.html")


if __name__ == "__main__":
    main()
