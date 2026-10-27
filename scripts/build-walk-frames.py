"""补齐工程师角色的左右（以及背面）行走帧。

背景：`public/assets/characters.png` 里玩家只有一张侧面像、一张背面像，
`scripts/build-rpg-assets.cjs` 打包时把同一张图复制成 3 帧（中间帧下移 2px），
于是 RPGJS 播放 0→1→2 时左右方向只有上下抖 2px、循环接缝还重复同一帧，
看起来像卡住。这里保留第 1 帧（站立帧，引擎静止时也用它），
用「下半身绕髋线逐渐张开 + 前后摆动」合成出第 0、2 帧的迈步姿态，
不改图集尺寸与脚底基线，避免出现接缝或错位。

用法（在项目根目录）：
    python scripts/build-walk-frames.py            # 直接写回两处精灵表
    python scripts/build-walk-frames.py --dry-run  # 只输出到 build/walk-preview.png

依赖：Pillow、numpy。
"""
import argparse
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "scripts/assets/engineer.base.png"   # 打包产出的原始精灵表（只有一张侧面像）
TARGETS = [
    ROOT / "public/rpgjs/spritesheets/engineer.png",
    ROOT / "engine/public/spritesheets/engineer.png",
]

FW, FH = 72, 104      # 单元格（3 帧 × 4 方向）
Y_HIP = 74            # 髋线：从这里往下逐渐张开
FRONT = 0.45          # 前腿方向张开幅度（脚底处）
BACK = 0.15           # 后腿方向张开幅度
SHEAR = 3.5           # 下半身前后摆动像素（脚底处）
BOB = 2               # 行走帧整体上移量，沿用原有节奏
UP_SPREAD = 0.22      # 背面对称张开幅度


def spread(base: np.ndarray, left_amt: float, right_amt: float, shear: float = 0.0) -> np.ndarray:
    """把下半身按深度逐渐张开：x<cx 用 left_amt，x>=cx 用 right_amt，同时可整体前后摆。"""
    h, w = base.shape[:2]
    cx = w / 2.0
    xs = np.arange(w, dtype=np.float32)
    ys = np.arange(h, dtype=np.float32)

    # 每行一个系数：髋线处 1.0，脚底处 1+amt
    t = np.clip((ys - Y_HIP) / float(h - 1 - Y_HIP), 0.0, 1.0)
    s_left = 1.0 + left_amt * t
    s_right = 1.0 + right_amt * t

    left_mask = xs[None, :] < cx
    scale = np.where(left_mask, s_left[:, None], s_right[:, None])
    shift = (shear * t)[:, None]
    src_x = cx + (xs[None, :] - shift - cx) / scale
    src_y = np.broadcast_to(ys[:, None], (h, w))

    rgb = base[..., :3].astype(np.float32)
    alpha = base[..., 3:4].astype(np.float32) / 255.0
    prem = rgb * alpha  # 预乘，避免双线性采样出暗边

    x0 = np.floor(src_x).astype(np.int32)
    y0 = np.floor(src_y).astype(np.int32)
    fx = (src_x - x0)[..., None]
    fy = (src_y - y0)[..., None]
    x0c, y0c = np.clip(x0, 0, w - 1), np.clip(y0, 0, h - 1)
    x1c, y1c = np.clip(x0 + 1, 0, w - 1), np.clip(y0 + 1, 0, h - 1)

    out = (
        prem[y0c, x0c] * (1 - fx) * (1 - fy)
        + prem[y0c, x1c] * fx * (1 - fy)
        + prem[y1c, x0c] * (1 - fx) * fy
        + prem[y1c, x1c] * fx * fy
    )
    out_a = (
        alpha[y0c, x0c] * (1 - fx) * (1 - fy)
        + alpha[y0c, x1c] * fx * (1 - fy)
        + alpha[y1c, x0c] * (1 - fx) * fy
        + alpha[y1c, x1c] * fx * fy
    )
    rgb_out = np.where(out_a > 1e-4, out / np.maximum(out_a, 1e-4), 0)
    res = np.concatenate([rgb_out, out_a * 255.0], axis=2)
    return np.clip(res, 0, 255).astype(np.uint8)


def build(sheet_path: Path) -> Image.Image:
    src = np.array(Image.open(sheet_path).convert("RGBA"))
    out = src.copy()
    plans = {
        1: [(FRONT, BACK, -SHEAR), (BACK, FRONT, SHEAR)],      # 左：帧0 前腿领步，帧2 后腿蹬地
        2: [(BACK, FRONT, SHEAR), (FRONT, BACK, -SHEAR)],      # 右：镜像
        3: [(UP_SPREAD, UP_SPREAD, 0.0)] * 2,                  # 背：对称张开
    }
    for row, frames in plans.items():
        base = src[row * FH:(row + 1) * FH, FW:2 * FW]          # 第 1 帧即站立帧
        for col, (left_amt, right_amt, shear) in zip((0, 2), frames):
            step = Image.fromarray(spread(base, left_amt, right_amt, shear), "RGBA")
            canvas = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
            canvas.alpha_composite(step, (0, -BOB))
            out[row * FH:(row + 1) * FH, col * FW:(col + 1) * FW] = np.array(canvas)
    return Image.fromarray(out, "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser(description="补齐左右/背面行走帧")
    parser.add_argument("--dry-run", action="store_true", help="只写预览图，不改精灵表")
    parser.add_argument("--force", action="store_true", help="v2 素材存在时仍强制合成")
    args = parser.parse_args()

    v2 = ROOT / "scripts/assets/spritesheets_v2/engineer.png"
    if v2.exists() and not args.force:
        print("v2 精灵已自带四向三帧，无需合成；确需覆盖请加 --force。")
        return
    if not BASE.exists():
        raise SystemExit("缺少原始精灵表 %s，请先用 scripts/build-rpg-assets.cjs 重新打包。" % BASE)
    image = build(BASE)
    if args.dry_run:
        preview = ROOT / "build/walk-preview.png"
        preview.parent.mkdir(parents=True, exist_ok=True)
        image.save(preview)
        print("预览写入", preview)
        return

    for target in TARGETS:
        image.save(target)
        print("写入", target)


if __name__ == "__main__":
    main()
