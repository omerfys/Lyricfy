import os
import sys
import math
from PIL import Image, ImageDraw, ImageFont

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

WIDTH = 760
HEIGHT = 450
ROOT_DIR = os.path.dirname(os.path.dirname(__file__))
DOCS_ASSETS = os.path.join(ROOT_DIR, "docs", "assets")
os.makedirs(DOCS_ASSETS, exist_ok=True)

def get_font(size, bold=False):
    font_name = "segoeuib.ttf" if bold else "segoeui.ttf"
    try:
        return ImageFont.truetype(font_name, size)
    except Exception:
        try:
            return ImageFont.truetype("arial.ttf", size)
        except Exception:
            return ImageFont.load_default()

FONT_XS = get_font(10)
FONT_BOLD_XS = get_font(10, bold=True)
FONT_SM = get_font(12)
FONT_BOLD_SM = get_font(12, bold=True)
FONT_MD = get_font(15, bold=True)
FONT_LG = get_font(22, bold=True)
FONT_XL = get_font(34, bold=True)
FONT_XXL = get_font(44, bold=True)

LOGO_PATH = os.path.join(ROOT_DIR, "public", "icon.png")
LOGO_IMG = None
if os.path.exists(LOGO_PATH):
    try:
        LOGO_IMG = Image.open(LOGO_PATH).convert("RGBA").resize((20, 20), Image.Resampling.LANCZOS)
    except Exception:
        LOGO_IMG = None

def get_dark_stage_canvas(accent_rgb=(255, 0, 85), transparent_desktop=False):
    canvas = Image.new("RGBA", (WIDTH, HEIGHT), (8, 8, 12, 255))
    draw = ImageDraw.Draw(canvas)
    if transparent_desktop:
        for y in range(HEIGHT):
            r = int(14 + (y / HEIGHT) * 18)
            g = int(24 + (y / HEIGHT) * 28)
            b = int(48 + (y / HEIGHT) * 42)
            draw.line([(0, y), (WIDTH, y)], fill=(r, g, b, 255))
    else:
        for y in range(HEIGHT):
            ratio = abs((y - HEIGHT / 2) / (HEIGHT / 2))
            r = int(10 * (1 - ratio) + 4)
            g = int(10 * (1 - ratio) + 4)
            b = int(16 * (1 - ratio) + 8)
            draw.line([(0, y), (WIDTH, y)], fill=(r, g, b, 255))

    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    ar, ag, ab = accent_rgb
    for rad in range(180, 20, -25):
        alpha = int(16 * (1 - rad / 180.0))
        g_draw.ellipse([WIDTH // 2 - rad * 1.5, HEIGHT // 2 - rad, WIDTH // 2 + rad * 1.5, HEIGHT // 2 + rad],
                       fill=(ar, ag, ab, alpha))
    canvas.alpha_composite(glow)
    return canvas

def draw_cursor(draw, x, y, clicking=False):
    fill_color = (200, 240, 255, 255) if clicking else (245, 245, 245, 255)
    border_color = (15, 23, 42, 255)
    poly = [
        (x, y),
        (x, y + 15),
        (x + 4, y + 12),
        (x + 8, y + 19),
        (x + 11, y + 18),
        (x + 7, y + 11),
        (x + 12, y + 11),
    ]
    draw.polygon(poly, fill=fill_color, outline=border_color)

def draw_hud(draw, img, active_source="Oto", song_title="Mor ve Ötesi — Bir Derdim Var", accent=(255, 0, 85)):
    pill_w = 500
    pill_h = 34
    px = WIDTH - pill_w - 16
    py = 14

    hud_bg = Image.new("RGBA", (pill_w, pill_h), (0, 0, 0, 0))
    h_draw = ImageDraw.Draw(hud_bg)
    h_draw.rounded_rectangle([0, 0, pill_w - 1, pill_h - 1], radius=12, fill=(14, 16, 24, 230), outline=(255, 255, 255, 38), width=1)
    img.alpha_composite(hud_bg, (px, py))

    if LOGO_IMG:
        img.alpha_composite(LOGO_IMG, (px + 10, py + 7))
    else:
        draw.rounded_rectangle([px + 10, py + 7, px + 30, py + 27], radius=5, fill=(168, 85, 247, 255))

    draw.text((px + 36, py + 9), "Lyricfy", font=FONT_BOLD_SM, fill=(255, 255, 255, 245))

    sources = [("Oto", 92, 36), ("Spotify", 132, 52), ("YT Music", 188, 60)]
    for s_name, sx, sw in sources:
        is_act = (s_name == active_source)
        if is_act:
            if s_name == "Spotify":
                bg_c = (16, 185, 129, 70)
                out_c = (16, 185, 129, 180)
                txt_c = (110, 231, 183, 255)
            elif s_name == "YT Music":
                bg_c = (244, 63, 94, 70)
                out_c = (244, 63, 94, 180)
                txt_c = (253, 164, 175, 255)
            else:
                bg_c = (255, 255, 255, 45)
                out_c = (255, 255, 255, 120)
                txt_c = (255, 255, 255, 255)
        else:
            bg_c = (255, 255, 255, 10)
            out_c = (255, 255, 255, 20)
            txt_c = (148, 163, 184, 220)
        draw.rounded_rectangle([px + sx, py + 7, px + sx + sw, py + 26], radius=6, fill=bg_c, outline=out_c, width=1)
        draw.text((px + sx + 7, py + 10), s_name, font=FONT_BOLD_XS, fill=txt_c)

    draw.text((px + 258, py + 10), song_title[:24], font=FONT_XS, fill=(203, 213, 225, 240))

    draw.rounded_rectangle([px + 412, py + 7, px + 488, py + 26], radius=6, fill=(accent[0], accent[1], accent[2], 50), outline=(accent[0], accent[1], accent[2], 160), width=1)
    draw.text((px + 420, py + 10), "Görünüm", font=FONT_BOLD_XS, fill=(255, 255, 255, 240))

def draw_sticker_icon(draw, x, y, kind="rose"):
    # Draws a crisp vector-like 3D icon badge next to active word
    draw.ellipse([x - 16, y - 16, x + 16, y + 16], fill=(15, 23, 42, 200), outline=(255, 255, 255, 90), width=2)
    if kind == "rose":
        draw.ellipse([x - 9, y - 10, x + 9, y + 6], fill=(244, 63, 94, 255), outline=(255, 200, 210, 255), width=1)
        draw.ellipse([x - 5, y - 6, x + 5, y + 2], fill=(225, 29, 72, 255))
        draw.line([(x, y + 6), (x, y + 13)], fill=(16, 185, 129, 255), width=2)
    elif kind == "heart":
        draw.polygon([(x, y + 10), (x - 10, y - 2), (x - 5, y - 9), (x, y - 4), (x + 5, y - 9), (x + 10, y - 2)], fill=(239, 68, 68, 255))
    elif kind == "fire":
        draw.polygon([(x, y - 11), (x + 9, y + 3), (x + 4, y + 10), (x - 4, y + 10), (x - 9, y + 3)], fill=(249, 115, 22, 255))
        draw.polygon([(x, y - 4), (x + 5, y + 4), (x, y + 9), (x - 5, y + 4)], fill=(253, 224, 71, 255))
    elif kind == "moon":
        draw.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(250, 204, 21, 255))
        draw.ellipse([x - 3, y - 9, x + 11, y + 5], fill=(15, 23, 42, 255))
    elif kind == "note":
        draw.ellipse([x - 8, y + 2, x - 1, y + 8], fill=(56, 189, 248, 255))
        draw.ellipse([x + 2, y, x + 9, y + 6], fill=(56, 189, 248, 255))
        draw.line([(x - 1, y + 5), (x - 1, y - 8), (x + 9, y - 10), (x + 9, y + 3)], fill=(56, 189, 248, 255), width=2)

def draw_active_word_badge(img, cx, cy, word, bg_rgb=(255, 0, 85), icon_kind="rose", tilt_deg=-3.0):
    bbox = FONT_XL.getbbox(word)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    pad_x, pad_y = 22, 12
    bw = tw + pad_x * 2
    bh = th + pad_y * 2

    badge_layer = Image.new("RGBA", (bw + 80, bh + 80), (0, 0, 0, 0))
    b_draw = ImageDraw.Draw(badge_layer)
    ox, oy = 40, 40

    # Glow shadow
    b_draw.rounded_rectangle([ox - 4, oy + 4, ox + bw + 4, oy + bh + 8], radius=14, fill=(bg_rgb[0], bg_rgb[1], bg_rgb[2], 95))
    # Main sticker pill
    b_draw.rounded_rectangle([ox, oy, ox + bw, oy + bh], radius=12, fill=(bg_rgb[0], bg_rgb[1], bg_rgb[2], 255), outline=(255, 255, 255, 220), width=2)
    b_draw.text((ox + pad_x, oy + pad_y - 4), word, font=FONT_XL, fill=(255, 255, 255, 255))

    # Sticker icon on top-right corner
    draw_sticker_icon(b_draw, ox + bw - 6, oy + 4, kind=icon_kind)

    rotated = badge_layer.rotate(tilt_deg, resample=Image.Resampling.BICUBIC, expand=False)
    img.alpha_composite(rotated, (int(cx - (bw + 80) // 2), int(cy - (bh + 80) // 2)))

# ==============================================================================
# 1. HERO KINETIC LYRICS & FISHEYE STAGE (1-hero-kinetic-lyrics.gif)
# ==============================================================================
def generate_hero_kinetic_gif():
    output_path = os.path.join(DOCS_ASSETS, "1-hero-kinetic-lyrics.gif")
    print(f"[*] 1/4 Üretiliyor: {output_path}")

    frames = []
    total_frames = 44

    words_seq = [
        ("GÜLLER", "rose", (255, 0, 85), -3.5, ["GÜLLER", "AÇAR", "GECEYE", "DOĞRU"]),
        ("AÇAR", "fire", (255, 45, 110), 2.8, ["GÜLLER", "AÇAR", "GECEYE", "DOĞRU"]),
        ("KALBİMDE", "heart", (236, 72, 153), -2.5, ["KALBİMDE", "YANAR", "ATEŞLER"]),
        ("ATEŞLER", "fire", (249, 115, 22), 3.2, ["KALBİMDE", "YANAR", "ATEŞLER"]),
    ]

    prev_lines = [
        "BİR DERDİM VAR ARTIK TUTAMAM İÇİNDE",
        "GİTSEM NEREYE KADAR KALSAM NEYE YARAR",
    ]
    next_lines = [
        "GÖZLERİMDE SON BİR UMUT PARLIYOR",
        "SESSİZCE AKIP GİDEN ZAMANIN İÇİNDE",
        "BİR MELODİ DUYULUR UZAKLARDAN",
    ]

    for f in range(total_frames):
        step_idx = min(3, f // 11)
        active_word, icon_kind, accent_col, tilt, curr_line_words = words_seq[step_idx]
        local_p = (f % 11) / 11.0
        pulse = math.sin(local_p * math.pi)

        img = get_dark_stage_canvas(accent_rgb=accent_col)
        draw = ImageDraw.Draw(img)

        draw_hud(draw, img, active_source="Spotify", song_title="Mor ve Ötesi — Bir Derdim Var", accent=accent_col)

        # Fisheye upper inactive lines
        for idx, line_txt in enumerate(prev_lines):
            y_pos = 88 + idx * 45
            font_use = FONT_MD if idx == 0 else FONT_LG
            alpha = 65 if idx == 0 else 110
            bbox = font_use.getbbox(line_txt)
            tw = bbox[2] - bbox[0]
            draw.text((WIDTH // 2 - tw // 2, y_pos), line_txt, font=font_use, fill=(148, 163, 184, alpha))

        # Center active line with surrounding words + active sticker badge
        center_y = 225
        total_w = 0
        word_widths = []
        for w in curr_line_words:
            b = FONT_XL.getbbox(w)
            ww = (b[2] - b[0]) + (52 if w == active_word else 24)
            word_widths.append(ww)
            total_w += ww

        cur_x = WIDTH // 2 - total_w // 2
        for w, ww in zip(curr_line_words, word_widths):
            if w == active_word:
                draw_active_word_badge(img, cur_x + ww // 2, center_y - int(pulse * 5), w, bg_rgb=accent_col, icon_kind=icon_kind, tilt_deg=tilt)
            else:
                draw.text((cur_x + 8, center_y - 18), w, font=FONT_LG, fill=(226, 232, 240, 175))
            cur_x += ww

        # Fisheye lower upcoming lines
        for idx, line_txt in enumerate(next_lines):
            y_pos = 298 + idx * 44
            font_use = FONT_LG if idx == 0 else FONT_MD
            alpha = 115 if idx == 0 else (75 if idx == 1 else 45)
            bbox = font_use.getbbox(line_txt)
            tw = bbox[2] - bbox[0]
            draw.text((WIDTH // 2 - tw // 2, y_pos), line_txt, font=font_use, fill=(148, 163, 184, alpha))

        # Bottom status pill
        draw.rounded_rectangle([20, HEIGHT - 38, 290, HEIGHT - 14], radius=8, fill=(15, 23, 42, 210), outline=(255, 255, 255, 35))
        draw.text((30, HEIGHT - 32), "Kelime Bazlı Kinetik Senkron • 60 FPS", font=FONT_BOLD_XS, fill=(203, 213, 225, 230))

        p_img = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
        frames.append(p_img)

    frames[0].save(output_path, save_all=True, append_images=frames[1:], duration=65, loop=0, optimize=True)
    mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[OK] 1/4 Tamamlandı: {output_path} ({mb:.2f} MB)")

# ==============================================================================
# 2. SPOTIFY & YOUTUBE MUSIC HYBRID SYNC (2-spotify-ytmusic-sync.gif)
# ==============================================================================
def generate_hybrid_sync_gif():
    output_path = os.path.join(DOCS_ASSETS, "2-spotify-ytmusic-sync.gif")
    print(f"[*] 2/4 Üretiliyor: {output_path}")

    frames = []
    total_frames = 46

    for f in range(total_frames):
        is_yt = (f >= 22)
        accent = (244, 63, 94) if is_yt else (16, 185, 129)
        src_name = "YT Music" if is_yt else "Spotify"
        song_name = "Duman — Senden Daha Güzel (Official Video)" if is_yt else "Tame Impala — Let It Happen"

        img = get_dark_stage_canvas(accent_rgb=accent)
        draw = ImageDraw.Draw(img)

        draw_hud(draw, img, active_source=src_name, song_title=song_name, accent=accent)

        # Left Info Card: Media Bridge & Transcript Alignment Status
        card_w, card_h = 310, 145
        cx, cy = 24, 64
        card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
        c_draw = ImageDraw.Draw(card)
        c_draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=12, fill=(15, 23, 42, 235), outline=(accent[0], accent[1], accent[2], 140), width=1)

        if not is_yt:
            c_draw.text((14, 12), "Kaynaktan Canlı Akış: Spotify", font=FONT_BOLD_SM, fill=(52, 211, 153, 255))
            c_draw.text((14, 34), "Protokol: Windows GSMTC Timeline API", font=FONT_XS, fill=(203, 213, 225, 255))
            c_draw.text((14, 54), "Söz Motoru: LRCLIB Word-by-Word", font=FONT_XS, fill=(148, 163, 184, 255))
            c_draw.rounded_rectangle([14, 80, card_w - 14, 106], radius=6, fill=(16, 185, 129, 35), outline=(16, 185, 129, 120))
            c_draw.text((22, 87), "Milisaniyelik Doğrudan Senkron Aktif", font=FONT_BOLD_XS, fill=(110, 231, 183, 255))
            c_draw.text((14, 116), "Zamanlayıcı: 01:24.380 / 04:16.000", font=FONT_XS, fill=(148, 163, 184, 230))
        else:
            c_draw.text((14, 12), "Kaynaktan Canlı Akış: YouTube Music", font=FONT_BOLD_SM, fill=(251, 113, 133, 255))
            c_draw.text((14, 34), "Hibrit Motor: YT TimedText (json3) + LRCLIB", font=FONT_XS, fill=(203, 213, 225, 255))
            c_draw.text((14, 54), "Klip İntro Farkı: +14.20s Otomatik Dengelendi", font=FONT_XS, fill=(253, 224, 71, 255))
            c_draw.rounded_rectangle([14, 80, card_w - 14, 106], radius=6, fill=(244, 63, 94, 40), outline=(244, 63, 94, 140))
            c_draw.text((22, 87), "Transkript Çapraz Hizalama Tamamlandı", font=FONT_BOLD_XS, fill=(253, 164, 175, 255))
            c_draw.text((14, 116), "Video Zamanı: 00:52.10 -> Şarkı Sözü: 00:37.90", font=FONT_XS, fill=(148, 163, 184, 230))

        img.alpha_composite(card, (cx, cy))

        # Active lyrics in center-right
        if not is_yt:
            draw.text((370, 170), "IT'S ALWAYS AROUND ME", font=FONT_MD, fill=(148, 163, 184, 110))
            draw_active_word_badge(img, 520, 245, "HAPPEN", bg_rgb=(16, 185, 129), icon_kind="note", tilt_deg=-2.5)
            draw.text((370, 315), "ALL THIS RUNNING AROUND", font=FONT_MD, fill=(148, 163, 184, 110))
        else:
            draw.text((360, 170), "KİMSEYE BAKMAM BEN", font=FONT_MD, fill=(148, 163, 184, 110))
            draw_active_word_badge(img, 525, 245, "GÜZEL", bg_rgb=(244, 63, 94), icon_kind="heart", tilt_deg=2.5)
            draw.text((360, 315), "SENDEN DAHA GÜZEL", font=FONT_MD, fill=(148, 163, 184, 110))

        # Cursor moving to click YT Music on HUD around frame 18-22
        if f < 22:
            prog = min(1.0, f / 18.0)
            cur_x = int(380 + prog * (460 - 380))
            cur_y = int(120 - prog * (120 - 30))
            clicking = (18 <= f <= 21)
        else:
            cur_x = 460
            cur_y = 30
            clicking = (f == 22)
        draw_cursor(draw, cur_x, cur_y, clicking=clicking)

        p_img = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
        frames.append(p_img)

    frames[0].save(output_path, save_all=True, append_images=frames[1:], duration=65, loop=0, optimize=True)
    mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[OK] 2/4 Tamamlandı: {output_path} ({mb:.2f} MB)")

# ==============================================================================
# 3. ALBUM COVER ART AUTO-SYNC THEME ENGINE (3-album-theme-autosync.gif)
# ==============================================================================
def generate_album_theme_gif():
    output_path = os.path.join(DOCS_ASSETS, "3-album-theme-autosync.gif")
    print(f"[*] 3/4 Üretiliyor: {output_path}")

    frames = []
    total_frames = 45

    themes = [
        ("The Weeknd — Starboy", (225, 29, 72), "#E11D48", "STARBOY", "fire"),
        ("Daft Punk — Discovery", (6, 182, 212), "#06B6D4", "HARDER", "note"),
        ("Billie Eilish — Everything I Wanted", (16, 185, 129), "#10B981", "DREAM", "moon"),
    ]

    for f in range(total_frames):
        t_idx = min(2, f // 15)
        song_title, accent, hex_code, word, icon_kind = themes[t_idx]

        img = get_dark_stage_canvas(accent_rgb=accent)
        draw = ImageDraw.Draw(img)

        draw_hud(draw, img, active_source="Oto", song_title=song_title, accent=accent)

        # Left Album Cover & Extracted Palette Card
        card_w, card_h = 250, 230
        cx, cy = 28, 100
        card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
        c_draw = ImageDraw.Draw(card)
        c_draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=14, fill=(15, 23, 42, 235), outline=(255, 255, 255, 45), width=1)

        # Simulated Album Cover Artwork
        c_draw.rounded_rectangle([18, 18, 108, 108], radius=10, fill=(accent[0], accent[1], accent[2], 255), outline=(255, 255, 255, 140), width=2)
        c_draw.ellipse([42, 42, 84, 84], fill=(15, 23, 42, 210), outline=(255, 255, 255, 120), width=2)
        c_draw.ellipse([58, 58, 68, 68], fill=(255, 255, 255, 255))

        c_draw.text((120, 24), "Auto Sync", font=FONT_BOLD_SM, fill=(255, 255, 255, 255))
        c_draw.text((120, 44), "Albüm Kapağı", font=FONT_XS, fill=(148, 163, 184, 255))
        c_draw.rounded_rectangle([120, 66, 232, 92], radius=6, fill=(accent[0], accent[1], accent[2], 55), outline=(accent[0], accent[1], accent[2], 200))
        c_draw.text((130, 73), f"Palet: {hex_code}", font=FONT_BOLD_XS, fill=(255, 255, 255, 255))

        c_draw.text((18, 124), "Çıkarılan Canlı Renk Kanalları:", font=FONT_BOLD_XS, fill=(203, 213, 225, 255))
        # Swatches
        swatches = [
            accent,
            (min(255, accent[0] + 40), min(255, accent[1] + 40), min(255, accent[2] + 40)),
            (255, 255, 255),
            (148, 163, 184)
        ]
        for s_i, sc in enumerate(swatches):
            sx = 18 + s_i * 54
            c_draw.rounded_rectangle([sx, 146, sx + 44, 176], radius=6, fill=(sc[0], sc[1], sc[2], 255), outline=(255, 255, 255, 90))

        c_draw.text((18, 192), "Aktif Çıkartma & Glow Senkronize", font=FONT_XS, fill=(52, 211, 153, 255))
        img.alpha_composite(card, (cx, cy))

        # Right side live kinetic word with extracted theme
        draw.text((340, 145), "ALBÜM RENGİYLE CANLI TEMA", font=FONT_MD, fill=(148, 163, 184, 120))
        draw_active_word_badge(img, 515, 225, word, bg_rgb=accent, icon_kind=icon_kind, tilt_deg=-3.0)
        draw.text((355, 305), "OTOMATİK PARALAKS & GLOW", font=FONT_MD, fill=(148, 163, 184, 120))

        p_img = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
        frames.append(p_img)

    frames[0].save(output_path, save_all=True, append_images=frames[1:], duration=65, loop=0, optimize=True)
    mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[OK] 3/4 Tamamlandı: {output_path} ({mb:.2f} MB)")

# ==============================================================================
# 4. VISUAL MODES & TRANSPARENT DESKTOP OVERLAY (4-hud-and-visual-modes.gif)
# ==============================================================================
def generate_modes_and_overlay_gif():
    output_path = os.path.join(DOCS_ASSETS, "4-hud-and-visual-modes.gif")
    print(f"[*] 4/4 Üretiliyor: {output_path}")

    frames = []
    total_frames = 45

    for f in range(total_frames):
        mode_idx = min(2, f // 15)
        transparent = (mode_idx == 2)
        accent = (168, 85, 247) if mode_idx == 0 else ((6, 182, 212) if mode_idx == 1 else (244, 63, 94))

        img = get_dark_stage_canvas(accent_rgb=accent, transparent_desktop=transparent)
        draw = ImageDraw.Draw(img)

        draw_hud(draw, img, active_source="Oto", song_title="Ezhel — Geceler", accent=accent)

        # Mode badge top-left
        mode_names = [
            "Mod 1: Odak Küresi (3D Fisheye Lens)",
            "Mod 2: Büyük Boy (3D Drifting Wall / Ship)",
            "Mod 3: Şeffaf Masaüstü Overlay + Sürükle-Gezin"
        ]
        draw.rounded_rectangle([20, 14, 315, 44], radius=8, fill=(15, 23, 42, 230), outline=(accent[0], accent[1], accent[2], 180), width=1)
        draw.text((32, 22), mode_names[mode_idx], font=FONT_BOLD_SM, fill=(255, 255, 255, 255))

        if mode_idx == 0:
            # Fisheye Sphere
            draw.ellipse([210, 75, 550, 395], outline=(168, 85, 247, 55), width=2)
            draw.text((275, 130), "GECELER DAHA ACIMASIZ", font=FONT_MD, fill=(148, 163, 184, 110))
            draw_active_word_badge(img, 380, 230, "GECELER", bg_rgb=accent, icon_kind="moon", tilt_deg=-3.0)
            draw.text((265, 320), "KARANLIKTA YOLUMU BULURUM", font=FONT_MD, fill=(148, 163, 184, 110))
        elif mode_idx == 1:
            # Ship 3D Drifting Wall
            wall_words = [
                ("ŞEHİR", 180, 130, False),
                ("UYURKEN", 340, 130, False),
                ("YILDIZLAR", 240, 225, True),
                ("PARLAR", 490, 225, False),
                ("SONSUZA", 280, 320, False),
            ]
            for ww, wx, wy, is_act in wall_words:
                if is_act:
                    draw_active_word_badge(img, wx + 60, wy, ww, bg_rgb=accent, icon_kind="fire", tilt_deg=3.5)
                else:
                    draw.text((wx, wy - 16), ww, font=FONT_XL, fill=(203, 213, 225, 130))
        else:
            # Transparent Desktop Overlay + Drag-to-browse spring back
            local_f = f - 30
            drag_offset = int(math.sin((local_f / 14.0) * math.pi) * 45)
            draw.rounded_rectangle([30, 80, 190, 210], radius=10, fill=(15, 23, 42, 190), outline=(255, 255, 255, 40))
            draw.text((44, 95), "Masaüstü Arka Planı", font=FONT_BOLD_XS, fill=(148, 163, 184, 220))
            draw.text((44, 115), "• Şeffaf Katman Aktif", font=FONT_XS, fill=(52, 211, 153, 240))
            draw.text((44, 135), "• Sol Tık Sürükle-Gezin", font=FONT_XS, fill=(56, 189, 248, 240))
            draw.text((44, 155), "• Bırakınca Yaylanarak", font=FONT_XS, fill=(253, 224, 71, 240))
            draw.text((44, 172), "  Aktif Söze Döner", font=FONT_XS, fill=(253, 224, 71, 240))

            draw.text((290, 140 + drag_offset), "GEÇMİŞ SATIRLARDA GEZİNME", font=FONT_MD, fill=(226, 232, 240, 160))
            draw_active_word_badge(img, 430, 230 + drag_offset, "AKTİF SÖZ", bg_rgb=accent, icon_kind="heart", tilt_deg=-2.0)
            draw.text((300, 315 + drag_offset), "OTOMATİK YAYLANMA (SPRING)", font=FONT_MD, fill=(226, 232, 240, 160))
            draw_cursor(draw, 450, 230 + drag_offset, clicking=(local_f < 9))

        p_img = img.convert("P", palette=Image.Palette.ADAPTIVE, colors=256)
        frames.append(p_img)

    frames[0].save(output_path, save_all=True, append_images=frames[1:], duration=65, loop=0, optimize=True)
    mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"[OK] 4/4 Tamamlandı: {output_path} ({mb:.2f} MB)")

if __name__ == "__main__":
    print("Lyricfy GitHub Showcase GIF Üreticisi Başlatılıyor...")
    generate_hero_kinetic_gif()
    generate_hybrid_sync_gif()
    generate_album_theme_gif()
    generate_modes_and_overlay_gif()
    print("Tüm 4 GIF başarıyla docs/assets/ içine kaydedildi!")
