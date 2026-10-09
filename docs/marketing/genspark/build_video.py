"""
Build CleanOps 30s marketing hero video + 15s cutdown from feature stills.
Requires: ffmpeg on PATH, Pillow, numpy.
"""
from __future__ import annotations

import math
import struct
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "assets"
OUT = ROOT / "output"
W, H = 1920, 1080
FPS = 30

FFMPEG = (
    Path.home()
    / "AppData/Local/Microsoft/WinGet/Packages/"
    / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/"
    / "ffmpeg-8.1.2-full_build/bin/ffmpeg.exe"
)
if not FFMPEG.exists():
    FFMPEG = Path("ffmpeg")


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\calibrib.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def cover_crop(img: Image.Image, tw: int, th: int) -> Image.Image:
    src = img.convert("RGB")
    scale = max(tw / src.width, th / src.height)
    nw, nh = int(src.width * scale), int(src.height * scale)
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = (nh - th) // 2
    return resized.crop((left, top, left + tw, top + th))


def ken_burns(
    src: Path,
    seconds: float,
    *,
    zoom_start: float = 1.0,
    zoom_end: float = 1.08,
    pan: str = "center",
) -> list[Image.Image]:
    base = Image.open(src)
    # render oversized for zoom crop
    over = cover_crop(base, int(W * 1.12), int(H * 1.12))
    frames: list[Image.Image] = []
    n = max(1, int(seconds * FPS))
    for i in range(n):
        t = i / max(1, n - 1)
        z = zoom_start + (zoom_end - zoom_start) * t
        cw, ch = int(W / z), int(H / z)
        if pan == "left":
            x = int((over.width - cw) * (0.15 + 0.7 * t))
            y = (over.height - ch) // 2
        elif pan == "right":
            x = int((over.width - cw) * (0.85 - 0.7 * t))
            y = (over.height - ch) // 2
        else:
            x = (over.width - cw) // 2
            y = (over.height - ch) // 2
        crop = over.crop((x, y, x + cw, y + ch)).resize((W, H), Image.Resampling.LANCZOS)
        frames.append(crop)
    return frames


def draw_text_block(
    frame: Image.Image,
    lines: list[tuple[str, int, tuple[int, int, int]]],
    *,
    y: int,
    shadow: bool = True,
) -> Image.Image:
    out = frame.copy()
    draw = ImageDraw.Draw(out)
    # soft bottom vignette for readability
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for i in range(280):
        a = int(140 * (i / 280) ** 1.4)
        od.rectangle([0, H - 280 + i, W, H - 279 + i], fill=(16, 32, 23, a))
    out = Image.alpha_composite(out.convert("RGBA"), overlay).convert("RGB")
    draw = ImageDraw.Draw(out)

    cy = y
    for text, size, color in lines:
        f = font(size)
        bbox = draw.textbbox((0, 0), text, font=f)
        tw = bbox[2] - bbox[0]
        x = (W - tw) // 2
        if shadow:
            draw.text((x + 2, cy + 2), text, font=f, fill=(0, 0, 0))
        draw.text((x, cy), text, font=f, fill=color)
        cy += size + 14
    return out


def brand_open(frame: Image.Image) -> Image.Image:
    return draw_text_block(
        frame,
        [
            ("CLEANOPS", 92, (255, 255, 255)),
            ("PSP waste ops for Lagos wards", 36, (216, 238, 224)),
        ],
        y=H - 220,
    )


def caption(frame: Image.Image, text: str, sub: str | None = None) -> Image.Image:
    lines: list[tuple[str, int, tuple[int, int, int]]] = [(text, 42, (255, 255, 255))]
    if sub:
        lines.append((sub, 30, (216, 238, 224)))
    return draw_text_block(frame, lines, y=H - 180)


def end_card(frame: Image.Image) -> Image.Image:
    # mint wash
    wash = Image.new("RGBA", (W, H), (26, 127, 69, 90))
    base = Image.alpha_composite(frame.convert("RGBA"), wash).convert("RGB")
    return draw_text_block(
        base,
        [
            ("CLEANOPS", 88, (255, 255, 255)),
            ("Demo Waste Co (Fictional).", 48, (216, 238, 224)),
            ("Routes. Collections. Cash. One system.", 32, (238, 245, 239)),
            ("For LAWMA PSP operators", 26, (200, 220, 205)),
        ],
        y=H // 2 - 120,
    )


def write_frames(frames: list[Image.Image], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # raw rgb24 stream for ffmpeg
    with path.open("wb") as f:
        for fr in frames:
            f.write(fr.convert("RGB").tobytes())


def synth_jingle(path: Path, seconds: float = 35.0, sample_rate: int = 44100) -> None:
    """Simple Afro-modern-ish bed: soft kick, clap, kalimba-like plucks in G major."""
    n = int(seconds * sample_rate)
    bpm = 100
    beat = 60.0 / bpm

    # note frequencies (G major-ish motif)
    motif = [392.00, 493.88, 587.33, 659.25, 587.33, 493.88, 392.00, 329.63]  # G B D E D B G E

    def env(i: int, length: int, attack: int = 200, release: int = 2000) -> float:
        if i < attack:
            return i / attack
        if i > length - release:
            return max(0.0, (length - i) / release)
        return 1.0

    samples = [0.0] * n

    # soft pad drone on G
    for i in range(n):
        t = i / sample_rate
        pad = 0.045 * math.sin(2 * math.pi * 196.0 * t)
        pad += 0.025 * math.sin(2 * math.pi * 246.94 * t)
        samples[i] += pad * (0.7 + 0.3 * math.sin(2 * math.pi * 0.15 * t))

    # kick + clap pattern
    for b in range(int(seconds / beat)):
        start = int(b * beat * sample_rate)
        # kick every beat
        for i in range(int(0.12 * sample_rate)):
            if start + i >= n:
                break
            t = i / sample_rate
            freq = 90 * math.exp(-18 * t)
            samples[start + i] += 0.55 * math.sin(2 * math.pi * freq * t) * math.exp(-12 * t)
        # clap on 2 and 4
        if b % 4 in (1, 3):
            for i in range(int(0.05 * sample_rate)):
                if start + i >= n:
                    break
                noise = (hash((start + i) * 2654435761) % 1000) / 1000.0 - 0.5
                samples[start + i] += 0.22 * noise * math.exp(-40 * i / sample_rate)

    # kalimba motif every 2 bars
    motif_period = beat * 2
    note_len = int(0.35 * sample_rate)
    for cycle in range(int(seconds / motif_period)):
        for ni, freq in enumerate(motif):
            start = int((cycle * motif_period + ni * (motif_period / len(motif))) * sample_rate)
            for i in range(note_len):
                if start + i >= n:
                    break
                t = i / sample_rate
                tone = math.sin(2 * math.pi * freq * t)
                tone += 0.35 * math.sin(2 * math.pi * freq * 2 * t)
                samples[start + i] += 0.18 * tone * env(i, note_len) * math.exp(-2.2 * t)

    # rising stinger in last 2s
    stinger_start = int((seconds - 2.0) * sample_rate)
    stinger_notes = [392.00, 493.88, 587.33]
    for ni, freq in enumerate(stinger_notes):
        start = stinger_start + int(ni * 0.35 * sample_rate)
        for i in range(int(0.5 * sample_rate)):
            if start + i >= n:
                break
            t = i / sample_rate
            samples[start + i] += 0.28 * math.sin(2 * math.pi * freq * t) * math.exp(-3 * t)

    # normalize
    peak = max(1e-9, max(abs(s) for s in samples))
    scale = 0.85 / peak
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = b"".join(struct.pack("<h", int(max(-1, min(1, s * scale)) * 32767)) for s in samples)
        wf.writeframes(frames)


def ffmpeg_encode(raw: Path, audio: Path, mp4: Path, seconds: float) -> None:
    cmd = [
        str(FFMPEG),
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{W}x{H}",
        "-r",
        str(FPS),
        "-i",
        str(raw),
        "-i",
        str(audio),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(mp4),
    ]
    subprocess.run(cmd, check=True)


def build_hero() -> Path:
    fleet = ASSETS / "cleanops-feature-workload-fleet.png"
    problem = ASSETS / "cleanops-feature-problem-to-solution.png"
    dash = ASSETS / "cleanops-feature-operator-dashboard.png"
    driver = ASSETS / "cleanops-feature-driver-field.png"
    agent = ASSETS / "cleanops-feature-agent-collections.png"

    frames: list[Image.Image] = []

    # 0-5s open
    open_frames = ken_burns(fleet, 5.0, zoom_start=1.0, zoom_end=1.06, pan="left")
    for i, fr in enumerate(open_frames):
        frames.append(brand_open(fr) if i > int(0.4 * FPS) else fr)

    # 5-9s problem
    prob = ken_burns(problem, 4.0, zoom_start=1.0, zoom_end=1.05)
    for i, fr in enumerate(prob):
        if i > int(0.3 * FPS):
            fr = caption(
                fr,
                "Paper routes. Missing cash.",
                "Guesswork at the dumpsite.",
            )
        frames.append(fr)

    # 9-16s operator
    op = ken_burns(dash, 7.0, zoom_start=1.0, zoom_end=1.07, pan="right")
    for i, fr in enumerate(op):
        if i > int(0.4 * FPS):
            fr = caption(fr, "One command centre for the ward", "Routes · Payments · Attendance · Fleet")
        frames.append(fr)

    # 16-22s driver
    drv = ken_burns(driver, 6.0, zoom_start=1.02, zoom_end=1.08)
    for i, fr in enumerate(drv):
        if i > int(0.3 * FPS):
            fr = caption(fr, "Drivers run today's stops on phone", "Complete · Skip · Fuel · Dumpsite")
        frames.append(fr)

    # 22-28s agent
    ag = ken_burns(agent, 6.0, zoom_start=1.0, zoom_end=1.07, pan="left")
    for i, fr in enumerate(ag):
        if i > int(0.3 * FPS):
            fr = caption(fr, "Agents collect with receipts", "Cash · OPay · PalmPay · Moniepoint")
        frames.append(fr)

    # 28-35s end
    end = ken_burns(fleet, 7.0, zoom_start=1.04, zoom_end=1.1)
    for fr in end:
        frames.append(end_card(fr))

    raw = OUT / "hero.raw"
    audio = OUT / "jingle.wav"
    mp4 = OUT / "CleanOps_Marketing_Hero_30s.mp4"
    write_frames(frames, raw)
    synth_jingle(audio, seconds=len(frames) / FPS + 0.5)
    ffmpeg_encode(raw, audio, mp4, len(frames) / FPS)
    raw.unlink(missing_ok=True)
    return mp4


def build_cutdown() -> Path:
    fleet = ASSETS / "cleanops-feature-workload-fleet.png"
    problem = ASSETS / "cleanops-feature-problem-to-solution.png"
    dash = ASSETS / "cleanops-feature-operator-dashboard.png"
    driver = ASSETS / "cleanops-feature-driver-field.png"
    agent = ASSETS / "cleanops-feature-agent-collections.png"

    frames: list[Image.Image] = []
    for fr in ken_burns(fleet, 3.0, zoom_end=1.05):
        frames.append(brand_open(fr))
    for fr in ken_burns(problem, 4.0):
        frames.append(caption(fr, "Stop running the ward on paper."))
    # triptych rapid
    for src, label in [
        (dash, "Operator"),
        (driver, "Driver Field"),
        (agent, "Agent Collections"),
    ]:
        for fr in ken_burns(src, 4 / 3, zoom_end=1.04):
            frames.append(caption(fr, label))
    for fr in ken_burns(fleet, 4.0, zoom_start=1.02, zoom_end=1.08):
        frames.append(end_card(fr))

    raw = OUT / "cutdown.raw"
    audio = OUT / "jingle_15.wav"
    mp4 = OUT / "CleanOps_Marketing_Cutdown_15s.mp4"
    write_frames(frames, raw)
    synth_jingle(audio, seconds=len(frames) / FPS + 0.5)
    ffmpeg_encode(raw, audio, mp4, len(frames) / FPS)
    raw.unlink(missing_ok=True)
    return mp4


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    print("Building hero…")
    hero = build_hero()
    print("Wrote", hero)
    print("Building cutdown…")
    cut = build_cutdown()
    print("Wrote", cut)
    # keep jingle wav for reuse
    print("Audio bed:", OUT / "jingle.wav")


if __name__ == "__main__":
    main()
