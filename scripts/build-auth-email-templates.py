#!/usr/bin/env python3
"""Regenerate FlyFam-branded Supabase authentication email templates."""

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
    "bg_outer": "#F4F6FA",
    "bg_card": "#FFFFFF",
    "bg_footer": "#F8FAFD",
    "bg_account": "#F4F7FF",
    "border_card": "#E5E9F0",
    "border_account": "#D9E4FF",
    "text": "#0F1B3D",
    "text_body": "#34405C",
    "text_muted": "#6B7280",
    "accent": "#1A5CF5",
    "primary": "#1A5CF5",
    "navy": "#0F1B3D",
    "gradient": "linear-gradient(135deg,#0F1B3D 0%,#173E91 58%,#1A5CF5 100%)",
    "btn_shadow": "0 8px 20px rgba(26,92,245,0.24)",
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


def email_asset_public_url(filename: str) -> str:
    base = (
        os.environ.get("SUPABASE_URL", "").strip()
        or os.environ.get("EXPO_PUBLIC_SUPABASE_URL", "").strip()
    ).rstrip("/")
    if not base:
        return f"../email-assets/{filename}"
    return f"{base}/storage/v1/object/public/{EMAIL_ASSETS_BUCKET}/brand/{filename}"


def logo_img_src() -> str:
    """Prefer HTTPS (mail clients); fall back to base64 for local HTML preview only."""
    url = logo_public_url()
    if url:
        return url
    b64 = base64.b64encode(build_email_logo_png()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def logo_img_html(src: str) -> str:
    return f"""<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0;">
                <tr>
                  <td align="center" style="background:#FFFFFF;border-radius:14px;padding:5px;line-height:0;box-shadow:0 4px 14px rgba(5,16,48,0.18);">
                    <img src="{src}" width="54" height="54" alt="FlyFam" style="display:block;border:0;border-radius:10px;outline:none;text-decoration:none;" />
                  </td>
                </tr>
              </table>"""


def render(
    eyebrow: str,
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
    hero_url: str,
    cta_href: str,
    account_html: str = "<strong style=\"color:#0F1B3D;font-size:14px;\">{{ .Email }}</strong>",
) -> str:
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="x-ua-compatible" content="ie=edge" />
  <meta name="color-scheme" content="light only" />
  <title>{title_tr} / {title_en}</title>
</head>
<body style="margin:0;padding:0;background:#EEF2F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:{BRAND['text']};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#EEF2F7;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#FFFFFF;border-radius:22px;border:1px solid #DEE5EF;box-shadow:0 18px 50px rgba(15,27,61,0.11);overflow:hidden;">
          <tr>
            <td style="padding:18px 24px;background:#FFFFFF;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="58" valign="middle">{logo_html}</td>
                  <td valign="middle" style="padding-left:12px;">
                    <div style="font-size:24px;font-weight:850;letter-spacing:-0.025em;color:{BRAND['navy']};line-height:1;">FlyFam</div>
                    <div style="font-size:9px;font-weight:800;letter-spacing:0.15em;color:#72809A;margin-top:7px;">ROSTER &middot; FAMILY &middot; TOGETHER</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0;line-height:0;background:{BRAND['navy']};">
              <img src="{hero_url}" width="600" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;" />
            </td>
          </tr>
          <tr>
            <td lang="tr" style="padding:32px 32px 10px;">
              <span style="display:inline-block;background:#EAF0FF;color:{BRAND['accent']};font-size:10px;font-weight:850;letter-spacing:0.09em;padding:7px 11px;border-radius:999px;">{eyebrow}</span>
              <h1 style="margin:16px 0 12px;font-size:27px;line-height:1.22;letter-spacing:-0.025em;color:{BRAND['text']};">{title_tr}</h1>
              <div style="font-size:15px;line-height:1.72;color:{BRAND['text_body']};">{tr_body}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px 28px;">
              <a href="{cta_href}" style="display:block;background:{BRAND['accent']};color:#FFFFFF !important;text-align:center;text-decoration:none;font-weight:850;font-size:16px;line-height:1.3;padding:17px 22px;border-radius:13px;box-shadow:{BRAND['btn_shadow']};">{cta_label}</a>
              <div style="font-size:12px;color:{BRAND['text_muted']};margin-top:12px;line-height:1.55;text-align:center;">{cta_sub}</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;background:#F5F8FF;border:1px solid #DCE6FA;border-radius:12px;">
                <tr>
                  <td style="padding:13px 15px;font-size:13px;line-height:1.5;color:{BRAND['text_muted']};word-break:break-word;">
                    <span style="font-size:10px;font-weight:850;letter-spacing:0.07em;color:{BRAND['accent']};">HESAP / ACCOUNT</span><br />
                    {account_html}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px;"><div style="border-top:1px solid #E5E9F0;height:1px;"></div></td>
          </tr>
          <tr>
            <td lang="en" style="padding:25px 32px 28px;">
              <span style="font-size:10px;font-weight:850;letter-spacing:0.10em;color:#718096;">ENGLISH</span>
              <div style="font-size:20px;font-weight:800;line-height:1.3;color:{BRAND['text']};padding:11px 0 8px;">{title_en}</div>
              <div style="font-size:14px;line-height:1.68;color:{BRAND['text_body']};">{en_body}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 25px;background:#F8FAFD;border-top:1px solid #E5E9F0;">
              <p style="margin:0 0 9px;font-size:12px;line-height:1.55;color:{BRAND['text_muted']};"><strong style="color:{BRAND['accent']};">TR</strong>&nbsp; {footer_tr}</p>
              <p style="margin:0;font-size:12px;line-height:1.55;color:{BRAND['text_muted']};"><strong style="color:{BRAND['accent']};">EN</strong>&nbsp; {footer_en}</p>
              <p style="margin:20px 0 0;font-size:11px;color:#98A2B3;text-align:center;">FlyFam &middot; U&#231;u&#351; program&#305;n&#305;z, ailenize daha yak&#305;n.<br />Your roster, closer to family.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
""".replace("{{{{", "{{").replace("}}}}", "}}")


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

    auth_bridge = "https://app.flyfamapp.com/auth-callback.html"
    signup_href = f"{auth_bridge}?token_hash={{{{ .TokenHash }}}}&amp;type=signup"
    recovery_href = f"{auth_bridge}?token_hash={{{{ .TokenHash }}}}&amp;type=recovery"
    invite_href = f"{auth_bridge}?token_hash={{{{ .TokenHash }}}}&amp;type=invite"
    magic_link_href = f"{auth_bridge}?token_hash={{{{ .TokenHash }}}}&amp;type=magiclink"
    email_change_href = f"{auth_bridge}?token_hash={{{{ .TokenHash }}}}&amp;type=email_change"

    (TEMPLATES / "confirmation.html").write_text(
        render(
            "HESAP DO&#286;RULAMA",
            "FlyFam'e hoş geldiniz",
            "Welcome to FlyFam",
            "FlyFam — Hesabınızı doğrulayın · Confirm your account",
            "Uçuş programınızı güvenle yönetmek ve seçtiğiniz yakınlarınızı zamanında bilgilendirmek için son bir adım kaldı. E-posta adresinizi doğrulayarak hesabınızı etkinleştirin.",
            "Hesab&#305;m&#305; do&#287;rula<br /><span style=\"font-size:12px;font-weight:600;opacity:0.88;\">Confirm my account</span>",
            "Bu ba&#287;lant&#305; yaln&#305;zca hesab&#305;n&#305;z&#305; etkinle&#351;tirmek i&#231;in kullan&#305;l&#305;r.",
            "There is just one step left. Confirm your email to activate FlyFam, manage your flight schedule securely, and keep the people you choose informed at the right time.",
            f'Buton çalışmazsa <a href="{signup_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">bu güvenli bağlantıyı açın</a>.',
            f'If the button does not work, open <a href="{signup_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">this secure link</a>.',
            logo_html,
            email_asset_public_url("flyfam-email-confirmation-hero.jpg"),
            signup_href,
        ),
        encoding="utf-8",
    )
    (TEMPLATES / "recovery.html").write_text(
        render(
            "HESAP G&#220;VENL&#304;&#286;&#304;",
            "Yeni şifrenizi belirleyin",
            "Choose a new password",
            "FlyFam — Şifrenizi güvenle yenileyin · Secure password reset",
            "FlyFam hesabınız için şifre yenileme talebi aldık. Aşağıdaki güvenli bağlantıyı kullanarak yeni şifrenizi oluşturabilirsiniz. Bu talep size ait değilse e-postayı yok saymanız yeterlidir.",
            "Yeni &#351;ifre olu&#351;tur<br /><span style=\"font-size:12px;font-weight:600;opacity:0.88;\">Create a new password</span>",
            "G&#252;venli&#287;iniz i&#231;in bu ba&#287;lant&#305; s&#305;n&#305;rl&#305; s&#252;re ge&#231;erlidir.",
            "We received a password reset request for your FlyFam account. Use the secure link above to create a new password. If you did not request this, simply ignore this email.",
            f'Buton çalışmazsa <a href="{recovery_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">bu güvenli bağlantıyı açın</a>.',
            f'If the button does not work, open <a href="{recovery_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">this secure link</a>.',
            logo_html,
            email_asset_public_url("flyfam-email-recovery-hero.jpg"),
            recovery_href,
        ),
        encoding="utf-8",
    )
    (TEMPLATES / "invite.html").write_text(
        render(
            "FLYFAM DAVET&#304;",
            "FlyFam'e davet edildiniz",
            "You are invited to FlyFam",
            "FlyFam — Davetinizi kabul edin · Accept your invitation",
            "FlyFam hesabınızı oluşturarak uçuş programlarını güvenle takip edebilir ve size verilen erişim kapsamında ailenizle bağlantıda kalabilirsiniz.",
            "Daveti kabul et<br /><span style=\"font-size:12px;font-weight:600;opacity:0.88;\">Accept invitation</span>",
            "Bu davet yaln&#305;zca bu e-posta adresi i&#231;in ge&#231;erlidir.",
            "Create your FlyFam account to follow flight schedules securely and stay connected with your family within the access shared with you.",
            f'Buton çalışmazsa <a href="{invite_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">bu güvenli bağlantıyı açın</a>.',
            f'If the button does not work, open <a href="{invite_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">this secure link</a>.',
            logo_html,
            email_asset_public_url("flyfam-email-confirmation-hero.jpg"),
            invite_href,
        ),
        encoding="utf-8",
    )
    (TEMPLATES / "magic-link.html").write_text(
        render(
            "G&#220;VENL&#304; G&#304;R&#304;&#350;",
            "FlyFam'e güvenle giriş yapın",
            "Sign in securely to FlyFam",
            "FlyFam — Güvenli giriş bağlantınız · Your secure sign-in link",
            "FlyFam hesabınıza şifresiz giriş yapmak için aşağıdaki tek kullanımlık bağlantıyı açın. Bu isteği siz yapmadıysanız e-postayı yok sayabilirsiniz.",
            "Giri&#351; yap<br /><span style=\"font-size:12px;font-weight:600;opacity:0.88;\">Sign in</span>",
            "Bu ba&#287;lant&#305; tek kullan&#305;ml&#305;kt&#305;r ve s&#305;n&#305;rl&#305; s&#252;re ge&#231;erlidir.",
            "Open the one-time link above to sign in to your FlyFam account without a password. If you did not request this, you can safely ignore this email.",
            f'Buton çalışmazsa <a href="{magic_link_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">bu güvenli bağlantıyı açın</a>.',
            f'If the button does not work, open <a href="{magic_link_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">this secure link</a>.',
            logo_html,
            email_asset_public_url("flyfam-email-confirmation-hero.jpg"),
            magic_link_href,
        ),
        encoding="utf-8",
    )
    (TEMPLATES / "change-email.html").write_text(
        render(
            "E-POSTA G&#220;VENL&#304;&#286;&#304;",
            "Yeni e-posta adresinizi doğrulayın",
            "Confirm your new email address",
            "FlyFam — E-posta değişikliğini doğrulayın · Confirm your email change",
            "FlyFam hesabınızın e-posta adresini değiştirme talebi aldık. Yeni adresi kullanmaya başlamak için aşağıdaki güvenli bağlantıyla işlemi doğrulayın. Bu talep size ait değilse bağlantıyı açmayın.",
            "Yeni adresi do&#287;rula<br /><span style=\"font-size:12px;font-weight:600;opacity:0.88;\">Confirm new email</span>",
            "Bu ba&#287;lant&#305; yaln&#305;zca e-posta de&#287;i&#351;ikli&#287;ini onaylar.",
            "We received a request to change the email address for your FlyFam account. Confirm the change using the secure link above. If you did not request it, do not open the link.",
            f'Buton çalışmazsa <a href="{email_change_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">bu güvenli bağlantıyı açın</a>.',
            f'If the button does not work, open <a href="{email_change_href}" style="color:#1A5CF5;font-weight:700;text-decoration:underline;">this secure link</a>.',
            logo_html,
            email_asset_public_url("flyfam-email-recovery-hero.jpg"),
            email_change_href,
            account_html=(
                '<span style="color:#6B7280;font-size:12px;">Mevcut / Current</span><br />'
                '<strong style="color:#0F1B3D;font-size:14px;">{{ .Email }}</strong><br />'
                '<span style="display:inline-block;margin-top:8px;color:#6B7280;font-size:12px;">Yeni / New</span><br />'
                '<strong style="color:#1A5CF5;font-size:14px;">{{ .NewEmail }}</strong>'
            ),
        ),
        encoding="utf-8",
    )
    updated = ["confirmation.html", "recovery.html", "invite.html", "magic-link.html", "change-email.html"]
    print("Updated", ", ".join(str(TEMPLATES / name) for name in updated))


if __name__ == "__main__":
    main()
