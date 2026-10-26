#!/usr/bin/env python3
"""
生成方案 A 全部角色、NPC 与动态机关设备精灵表（216x416, 3列x4行, 单帧 72x104）
以及 6 套立绘头像 (public/assets/avatars/skin-*.png) 和汇总预览图 (/workspace/g5l6_upgrade/new_sprites_showcase.png)。
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageEnhance, ImageFilter
from scipy import ndimage

sys.path.insert(0, '/workspace/tools/agent-sprite-forge/shared')
import forge_matte

ROOT = Path('/workspace/g5l6_upgrade')
MASTER_PROTAG = Path('/cursor/stores/store-8818132d-69bd-46fb-ad34-6e2f7d7b65c8/grok-bot/agents/e4d20b60-b45a-406b-a1f3-d6ee0eb71e66/attachments/8a2ff656438930b99b8735d5e483bdff0883cefc9fc39edfbc46cbe8c10b7553.jpg')
MASTER_NPCS = Path('/cursor/stores/store-8818132d-69bd-46fb-ad34-6e2f7d7b65c8/grok-bot/agents/e4d20b60-b45a-406b-a1f3-d6ee0eb71e66/attachments/0adb182775beaae073ad1a09502a4b3b520136fc75d9468d88ab55b02c4e24ab.jpg')

OUT_DIRS = [
    ROOT / 'engine/public/spritesheets',
    ROOT / 'public/rpgjs/spritesheets',
]
AVATAR_DIR = ROOT / 'public/assets/avatars'
ASSET_CACHE = ROOT / 'scripts/assets/spritesheets_v2'

FW, FH = 72, 104

def clean_key(img_path: Path) -> Image.Image:
    im = Image.open(img_path)
    keyed, _ = forge_matte.key_still(im, key="magenta", quality="soft")
    arr = np.array(keyed, dtype=np.uint8)
    # Remove any residual magenta/pink fringe on semi-transparent edge pixels
    r = arr[:, :, 0].astype(np.int16)
    g = arr[:, :, 1].astype(np.int16)
    b = arr[:, :, 2].astype(np.int16)
    a = arr[:, :, 3].astype(np.int16)
    fringe = (a > 0) & (a < 235) & ((r - g) > 35) & ((b - g) > 25)
    arr[fringe, 0] = np.clip((r[fringe] + g[fringe]) // 2, 0, 255).astype(np.uint8)
    arr[fringe, 2] = np.clip((b[fringe] + g[fringe]) // 2, 0, 255).astype(np.uint8)
    arr[fringe, 3] = (a[fringe] * 0.65).astype(np.uint8)
    # Clean tiny isolated specks
    mask = arr[:, :, 3] > 20
    mask = ndimage.binary_opening(mask, structure=np.ones((2, 2)))
    arr[~mask] = 0
    return Image.fromarray(arr, mode='RGBA')

def extract_crop(rgba: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    sub = rgba.crop(box)
    arr = np.array(sub)
    ys, xs = np.where(arr[:, :, 3] > 24)
    if len(xs) == 0:
        return sub
    return sub.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))

def fit_cell(sprite: Image.Image, max_w=62, max_h=92, foot_y=99, dx=0, dy=0, ring_style: str = 'npc') -> Image.Image:
    w, h = sprite.size
    scale = min(max_w / max(w, 1), max_h / max(h, 1))
    nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
    resized = sprite.resize((nw, nh), Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    shadow = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    if ring_style == 'player':
        # High-contrast Electric Cyan + Magenta-Purple + White halo ring for the player
        sdraw.ellipse([FW // 2 - 31 + dx, foot_y - 11, FW // 2 + 31 + dx, foot_y + 4], fill=(14, 116, 144, 115), outline=(0, 229, 255, 255), width=3)
        sdraw.ellipse([FW // 2 - 25 + dx, foot_y - 8, FW // 2 + 25 + dx, foot_y + 2], fill=(56, 189, 248, 95), outline=(255, 255, 255, 245), width=2)
    else:
        sw = min(28, max(20, int(nw * 0.42)))
        sdraw.ellipse([FW // 2 - sw + dx, foot_y - 8, FW // 2 + sw + dx, foot_y + 3], fill=(15, 23, 42, 95), outline=(254, 240, 138, 195), width=2)
    cell.alpha_composite(shadow)
    px = (FW - nw) // 2 + dx
    py = foot_y - nh + dy
    cell.alpha_composite(resized, (px, py))
    return cell

def animate_walk_frame(base_cell: Image.Image, phase: int, is_side: bool = False) -> Image.Image:
    """
    phase:
      1 = stand / gentle breathe
      0 = step A (natural stride + arm swing + 2px bounce)
      2 = step B (opposite stride + arm swing + 2px bounce)
    Uses smooth upper/lower body counter-shear and foot lift without tearing pixels.
    """
    if phase == 1:
        return base_cell.copy()
    arr = np.array(base_cell, dtype=np.float32)
    h, w, _ = arr.shape
    out = np.zeros_like(arr)
    sign = -1.0 if phase == 0 else 1.0
    # Keep shadow fixed near bottom (y >= 96)
    y_hip = 64
    y_neck = 42
    yy, xx = np.meshgrid(np.arange(h, dtype=np.float32), np.arange(w, dtype=np.float32), indexing='ij')
    cx = w / 2.0

    # Vertical bounce (2px up during stride)
    src_y = yy + 1.8
    # Upper body subtle tilt / arm swing
    upper_t = np.clip((y_hip - yy) / max(1.0, y_hip - 15.0), 0.0, 1.0)
    # Lower body stride shear + slight leg separation
    lower_t = np.clip((yy - y_hip) / max(1.0, 96.0 - y_hip), 0.0, 1.0)

    if is_side:
        # Side walk: legs swing forward/back smoothly, arms counter-swing
        # Split left/right half of legs slightly in opposite horizontal directions to show two feet stepping
        side_offset = np.tanh((xx - cx) / 5.0)
        leg_shift = sign * lower_t * (2.6 * side_offset + 1.2)
        arm_shift = -sign * upper_t * 1.1 * (yy > y_neck)
        src_x = xx - (leg_shift + arm_shift)
        # Lift the back/front foot slightly
        foot_lift = np.clip(sign * side_offset, 0.0, 1.0) * (lower_t ** 1.4) * 2.2
        src_y = src_y + foot_lift
    else:
        # Front/back walk: alternating left/right foot lift and subtle hip sway
        side_sign = np.tanh((xx - cx) / 4.5)
        foot_lift = np.clip(sign * side_sign, 0.0, 1.0) * (lower_t ** 1.3) * 3.0
        hip_sway = sign * lower_t * 1.1
        head_bob = -sign * upper_t * 0.7
        src_x = xx - (hip_sway + head_bob)
        src_y = src_y + foot_lift

    for c in range(4):
        out[:, :, c] = ndimage.map_coordinates(arr[:, :, c], [src_y, src_x], order=1, mode='constant', cval=0.0)
    out = np.clip(out, 0, 255).astype(np.uint8)
    # Restore ground shadow cleanly
    res = Image.fromarray(out, mode='RGBA')
    return res

def build_character_sheet(front_img: Image.Image, side_left_img: Image.Image, back_img: Image.Image, ring_style: str = 'npc') -> Image.Image:
    sheet = Image.new('RGBA', (FW * 3, FH * 4), (0, 0, 0, 0))
    side_right_img = side_left_img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    rows = [
        (front_img, False),       # Row 0: Down (正面朝下)
        (side_left_img, True),    # Row 1: Left (侧面朝左)
        (side_right_img, True),   # Row 2: Right (侧面朝右)
        (back_img, False),        # Row 3: Up (背面朝上)
    ]
    for r_idx, (pose_img, is_side) in enumerate(rows):
        base_cell = fit_cell(pose_img, max_w=62, max_h=92, foot_y=99, ring_style=ring_style)
        for c_idx in range(3):
            frame = animate_walk_frame(base_cell, c_idx, is_side=is_side)
            sheet.alpha_composite(frame, (c_idx * FW, r_idx * FH))
    return sheet

def build_avatar(front_img: Image.Image, bg_color: tuple[int, int, int]) -> Image.Image:
    size = 128
    av = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(av)
    draw.ellipse([4, 4, size - 5, size - 5], fill=(*bg_color, 255), outline=(24, 76, 59, 255), width=4)
    # Crop upper 70% of front character for crisp bust portrait
    w, h = front_img.size
    bust = front_img.crop((0, 0, w, int(h * 0.78)))
    bw, bh = bust.size
    scale = min(104 / max(bw, 1), 108 / max(bh, 1))
    nw, nh = int(round(bw * scale)), int(round(bh * scale))
    bust_resized = bust.resize((nw, nh), Image.Resampling.LANCZOS)
    # Circular mask
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse([8, 8, size - 9, size - 9], fill=255)
    inner = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    inner.alpha_composite(bust_resized, ((size - nw) // 2, size - nh - 6))
    av.paste(inner, (0, 0), mask)
    draw.ellipse([4, 4, size - 5, size - 5], outline=(255, 250, 240, 255), width=3)
    return av

def main():
    for d in [*OUT_DIRS, AVATAR_DIR, ASSET_CACHE]:
        d.mkdir(parents=True, exist_ok=True)

    print("Keying master sheet 1 (Protagonists)...")
    p1_rgba = clean_key(MASTER_PROTAG)
    print("Keying master sheet 2 (NPCs & Devices)...")
    p2_rgba = clean_key(MASTER_NPCS)

    # 6 Protagonist columns in Master 1 (1280x720)
    # Row 0: Front (y: 15..244), Row 1: Side-Right (y: 248..468), Row 2: Back (y: 472..698)
    col_x = [
        (40, 205),    # 0: engineer (boy green)
        (250, 425),   # 1: engineer-girl (girl purple)
        (475, 615),   # 2: engineer-mecha-boy
        (680, 825),   # 3: engineer-mecha-girl
        (880, 1025),  # 4: engineer-explorer-boy
        (1070, 1220), # 5: engineer-explorer-girl
    ]
    row_y = [
        (15, 244),
        (248, 468),
        (472, 698),
    ]
    protag_defs = [
        ('engineer', 'skin-boy', (219, 244, 228)),
        ('engineer-girl', 'skin-girl', (238, 225, 252)),
        ('engineer-mecha-boy', 'skin-mecha-boy', (214, 236, 255)),
        ('engineer-mecha-girl', 'skin-mecha-girl', (255, 224, 242)),
        ('engineer-explorer-boy', 'skin-explorer-boy', (250, 238, 205)),
        ('engineer-explorer-girl', 'skin-explorer-girl', (248, 232, 210)),
    ]

    saved_sheets = {}
    for idx, (sprite_id, avatar_id, bg_col) in enumerate(protag_defs):
        x0, x1 = col_x[idx]
        front = extract_crop(p1_rgba, (x0, row_y[0][0], x1, row_y[0][1]))
        side = extract_crop(p1_rgba, (x0, row_y[1][0], x1, row_y[1][1]))
        if idx in (4, 5):
            # col 4 in master sheet is angled slightly right; flip so side_left faces left
            side = side.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        back_x0, back_x1 = col_x[4] if idx == 5 else (x0, x1)
        back = extract_crop(p1_rgba, (back_x0, row_y[2][0], back_x1, row_y[2][1]))
        sheet = build_character_sheet(front, side, back, ring_style='player')
        saved_sheets[sprite_id] = sheet
        for out_dir in [*OUT_DIRS, ASSET_CACHE]:
            sheet.save(out_dir / f"{sprite_id}.png")
        avatar = build_avatar(front, bg_col)
        avatar.save(AVATAR_DIR / f"{avatar_id}.png")
        print(f"  Built protagonist {sprite_id}.png & {avatar_id}.png")

    # Master 2 Top Row: NPCs
    # #00 Gardener: x=[10..240], y=[65..368]
    # #01 Warden Front: x=[250..440], y=[65..368]
    # #02 Warden Side (facing right): x=[470..610], y=[65..368]
    # #03 Mechanic: x=[620..840], y=[65..368]
    # #04 Staff/Visitor (side/3-4 stride facing left): x=[865..1020], y=[65..368]
    # #05 Robot Drone: x=[1050..1245], y=[100..335]
    gardener_crop = extract_crop(p2_rgba, (10, 65, 240, 368))
    warden_front = extract_crop(p2_rgba, (250, 65, 440, 368))
    warden_side = extract_crop(p2_rgba, (470, 65, 610, 368))
    mechanic_crop = extract_crop(p2_rgba, (620, 65, 840, 368))
    visitor_crop = extract_crop(p2_rgba, (865, 65, 1020, 368))
    robot_crop = extract_crop(p2_rgba, (1050, 100, 1245, 335))

    # Build Gardener (gardener_crop faces left)
    gardener_sheet = build_character_sheet(gardener_crop, gardener_crop, gardener_crop)
    saved_sheets['gardener'] = gardener_sheet

    # Build Warden (warden_side faces left)
    warden_sheet = build_character_sheet(warden_front, warden_side, warden_front)
    saved_sheets['warden'] = warden_sheet

    # Build Mechanic (mechanic_crop faces left)
    mechanic_sheet = build_character_sheet(mechanic_crop, mechanic_crop, mechanic_crop)
    saved_sheets['mechanic'] = mechanic_sheet

    # Build Staff (Visitor): visitor_crop faces left
    staff_sheet = build_character_sheet(visitor_crop, visitor_crop, visitor_crop)
    saved_sheets['staff'] = staff_sheet

    # Build Robot Drone (hover animation across 3 columns: dy = -3, 0, +2)
    robot_sheet = Image.new('RGBA', (FW * 3, FH * 4), (0, 0, 0, 0))
    robot_right = robot_crop.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    for r_idx, pose in enumerate([robot_crop, robot_crop, robot_right, robot_crop]):
        for c_idx, dy in enumerate([-3, 0, 2]):
            cell = fit_cell(pose, max_w=58, max_h=76, foot_y=92, dy=dy)
            robot_sheet.alpha_composite(cell, (c_idx * FW, r_idx * FH))
    saved_sheets['robot'] = robot_sheet

    for npc_id in ['gardener', 'warden', 'mechanic', 'staff', 'robot']:
        for out_dir in [*OUT_DIRS, ASSET_CACHE]:
            saved_sheets[npc_id].save(out_dir / f"{npc_id}.png")
        print(f"  Built NPC {npc_id}.png")

    # Master 2 Bottom Row: Devices
    # #06 fan-off: x=[48..202], y=[445..625]
    # #07 fan-on:  x=[225..410], y=[465..615]
    # #08 control: x=[420..635], y=[475..625]
    # #09 sensor:  x=[670..768], y=[445..632]
    # #10 monitor: x=[792..952], y=[475..628]
    # #11 battery-a: x=[985..1114], y=[458..634]
    # #12 battery-b: x=[1136..1258], y=[458..634]
    fan_off_crop = extract_crop(p2_rgba, (48, 445, 202, 625))
    fan_on_crop = extract_crop(p2_rgba, (225, 465, 410, 615))
    control_crop = extract_crop(p2_rgba, (420, 475, 635, 625))
    sensor_crop = extract_crop(p2_rgba, (670, 445, 768, 632))
    monitor_crop = extract_crop(p2_rgba, (792, 475, 952, 628))
    battery_a_crop = extract_crop(p2_rgba, (985, 458, 1114, 634))
    battery_b_crop = extract_crop(p2_rgba, (1136, 458, 1258, 634))

    def build_device_sheet(crop_img: Image.Image, mode: str = 'pulse') -> Image.Image:
        sheet = Image.new('RGBA', (FW * 3, FH * 4), (0, 0, 0, 0))
        frames = []
        for c_idx in range(3):
            if mode == 'fan-on':
                # Combine fan body with spinning rotor effect + wind lines across 3 frames
                base = fit_cell(crop_img, max_w=66, max_h=84, foot_y=98, dy=(-1 if c_idx == 1 else 0))
                if c_idx == 1:
                    base = ImageEnhance.Brightness(base).enhance(1.08)
                elif c_idx == 2:
                    # Slight horizontal wind shimmer
                    b_arr = np.array(base)
                    draw = ImageDraw.Draw(base)
                    draw.arc([8, 22, 64, 78], start=20, end=140, fill=(94, 234, 212, 190), width=2)
                    draw.arc([10, 26, 62, 74], start=200, end=320, fill=(45, 212, 191, 190), width=2)
                else:
                    draw = ImageDraw.Draw(base)
                    draw.arc([8, 22, 64, 78], start=110, end=230, fill=(94, 234, 212, 190), width=2)
                    draw.arc([10, 26, 62, 74], start=290, end=50, fill=(45, 212, 191, 190), width=2)
                frames.append(base)
            elif mode == 'fan-off':
                base = fit_cell(crop_img, max_w=64, max_h=86, foot_y=98)
                # Subtle red standby indicator dot on frame 1
                draw = ImageDraw.Draw(base)
                alpha_dot = 230 if c_idx != 1 else 130
                draw.ellipse([33, 80, 39, 86], fill=(239, 68, 68, alpha_dot), outline=(255, 255, 255, 200))
                frames.append(base)
            else:
                # Subtle tech glow pulse on frame 1
                base = fit_cell(crop_img, max_w=64, max_h=86, foot_y=98)
                if c_idx == 1:
                    base = ImageEnhance.Brightness(base).enhance(1.06)
                frames.append(base)
        for r_idx in range(4):
            for c_idx in range(3):
                sheet.alpha_composite(frames[c_idx], (c_idx * FW, r_idx * FH))
        return sheet

    device_defs = [
        ('fan-off', fan_off_crop, 'fan-off'),
        ('fan-on', fan_on_crop, 'fan-on'),
        ('control', control_crop, 'pulse'),
        ('sensor', sensor_crop, 'pulse'),
        ('monitor', monitor_crop, 'pulse'),
        ('battery-a', battery_a_crop, 'pulse'),
        ('battery-b', battery_b_crop, 'pulse'),
    ]
    for dev_id, crop_img, mode in device_defs:
        sheet = build_device_sheet(crop_img, mode)
        saved_sheets[dev_id] = sheet
        for out_dir in [*OUT_DIRS, ASSET_CACHE]:
            sheet.save(out_dir / f"{dev_id}.png")
        print(f"  Built device {dev_id}.png")

    # Build Showcase Preview Image (/workspace/g5l6_upgrade/new_sprites_showcase.png)
    showcase = Image.new('RGBA', (1360, 860), (23, 59, 49, 255))
    sdraw = ImageDraw.Draw(showcase)
    # Background card panels
    sdraw.rounded_rectangle([20, 20, 1340, 430], radius=18, fill=(255, 250, 240, 255), outline=(115, 149, 122, 255), width=3)
    sdraw.rounded_rectangle([20, 450, 1340, 840], radius=18, fill=(244, 249, 238, 255), outline=(115, 149, 122, 255), width=3)

    try:
        font_title = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 24)
        font_label = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", 16)
        font_small = ImageFont.truetype("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 13)
    except Exception:
        font_title = font_label = font_small = ImageFont.load_default()

    sdraw.text((40, 34), "方案 A · 主角 6 套换装模型（正面 / 右行 / 左行 / 背面 + 圆形立绘头像）", fill=(24, 76, 59), font=font_title)
    protag_titles = [
        "男巡检员·小阳\n(默认)",
        "女巡检员·小星\n(默认)",
        "未来机甲·男\n(通1站解锁)",
        "未来机甲·女\n(通1站解锁)",
        "生态探险·男\n(通2站解锁)",
        "生态探险·女\n(通2站解锁)",
    ]
    for idx, (sprite_id, avatar_id, _) in enumerate(protag_defs):
        bx = 40 + idx * 214
        sdraw.rounded_rectangle([bx, 78, bx + 200, 412], radius=14, fill=(235, 245, 236, 255), outline=(180, 205, 185, 255), width=2)
        av = Image.open(AVATAR_DIR / f"{avatar_id}.png").resize((76, 76), Image.Resampling.LANCZOS)
        showcase.alpha_composite(av, (bx + 14, 90))
        sdraw.text((bx + 98, 102), protag_titles[idx], fill=(24, 76, 59), font=font_label)
        sh = saved_sheets[sprite_id]
        # Paste Down(row 0, col 1), Right(row 2, col 0), Left(row 1, col 2), Up(row 3, col 1)
        poses = [
            (sh.crop((FW * 1, FH * 0, FW * 2, FH * 1)), "正面"),
            (sh.crop((FW * 0, FH * 2, FW * 1, FH * 3)), "右迈步"),
            (sh.crop((FW * 2, FH * 1, FW * 3, FH * 2)), "左迈步"),
            (sh.crop((FW * 1, FH * 3, FW * 2, FH * 4)), "背面"),
        ]
        for p_i, (p_img, p_lbl) in enumerate(poses):
            px = bx + 10 + (p_i % 2) * 92
            py = 174 + (p_i // 2) * 114
            showcase.alpha_composite(p_img, (px + 10, py - 6))
            sdraw.text((px + 24, py + 92), p_lbl, fill=(60, 90, 75), font=font_small)

    sdraw.text((40, 466), "NPC 四向动态精灵 & 智慧园区 Q 版科技机关设备（全部 216×416 精灵表）", fill=(24, 76, 59), font=font_title)
    bottom_items = [
        ('gardener', '园艺员阿绿'),
        ('warden', '巡检员小巡'),
        ('mechanic', '维修员老修'),
        ('staff', '过街游客(侧行)'),
        ('robot', '巡检无人机'),
        ('fan-off', '风机(静止态)'),
        ('fan-on', '风机(旋转态)'),
        ('sensor', '温度探头'),
        ('control', '规则控制柜'),
        ('monitor', '现场核验仪'),
        ('battery-a', '电池A支路'),
        ('battery-b', '电池B支路'),
    ]
    for idx, (item_id, label) in enumerate(bottom_items):
        bx = 36 + idx * 107
        sdraw.rounded_rectangle([bx, 512, bx + 100, 822], radius=12, fill=(255, 255, 255, 255), outline=(195, 215, 198, 255), width=2)
        sh = saved_sheets[item_id]
        # Top: Row 0 Col 1 (Front/Stand), Bottom: Row 2 Col 0 (Right/Active)
        f_top = sh.crop((FW * 1, FH * 0, FW * 2, FH * 1))
        f_bot = sh.crop((FW * 0, FH * 2, FW * 1, FH * 3))
        showcase.alpha_composite(f_top, (bx + 14, 524))
        showcase.alpha_composite(f_bot, (bx + 14, 646))
        sdraw.text((bx + 8, 768), label, fill=(24, 76, 59), font=font_small)
        sdraw.text((bx + 14, 792), "正面 & 动态帧", fill=(110, 135, 120), font=font_small)

    showcase_path = ROOT / 'new_sprites_showcase.png'
    showcase.convert('RGB').save(showcase_path, quality=95)
    print(f"Saved showcase to {showcase_path}")

if __name__ == '__main__':
    main()
