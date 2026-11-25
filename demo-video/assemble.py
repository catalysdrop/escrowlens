#!/usr/bin/env python3
"""Assemble EscrowLens demo video: 6 slides xfade-chained, narration synced.

Each slide i is shown for its narration segment duration d_i. To keep the
audio in sync, slides 1..5 get an extra 0.5s tail that the 0.5s xfade eats:
total video = sum(d_i) = total audio length.
"""
import json
import subprocess
import sys

BASE = "/home/hatch/workspace/goals/terminal-3-micro-grant/escrowlens/demo-video"
SHOTS = f"{BASE}/shots"
NARR = f"{BASE}/narration"
OUT = f"{BASE}/escrowlens-demo.mp4"

# (image, narration segment, slide label)
SLIDES = [
    ("01-title.png", "seg1.mp3"),
    ("02-dashboard.png", "seg2.mp3"),
    ("03-demo-agent.png", "seg3.mp3"),
    ("04-ghost-agent.png", "seg4.mp3"),
    ("05-tee.png", "seg5.mp3"),
    ("06-closing.png", "seg6.mp3"),
]
XFADE = 0.5


def probe_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", path],
        capture_output=True, text=True, check=True)
    return float(json.loads(r.stdout)["format"]["duration"])


def main():
    durs = [probe_duration(f"{NARR}/{seg}") for _, seg in SLIDES]
    print("segment durations:", [round(d, 3) for d in durs],
          "total:", round(sum(durs), 3))

    # 1. Concatenate narration segments into one audio file.
    with open(f"{BASE}/concat-list.txt", "w") as f:
        for _, seg in SLIDES:
            f.write(f"file '{NARR}/{seg}'\n")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", f"{BASE}/concat-list.txt", "-c:a", "aac", "-b:a", "160k",
         f"{BASE}/narration-full.m4a"], check=True)
    audio_dur = probe_duration(f"{BASE}/narration-full.m4a")
    print("full narration:", round(audio_dur, 3))

    # 2. Build xfade chain. Slide i (except last) loops for d_i + XFADE.
    n = len(SLIDES)
    inputs = []
    for i, (img, _) in enumerate(SLIDES):
        dur = durs[i] + (XFADE if i < n - 1 else 0)
        inputs += ["-loop", "1", "-t", f"{dur:.3f}", "-i", f"{SHOTS}/{img}"]
    inputs += ["-i", f"{BASE}/narration-full.m4a"]

    filters = []
    # normalize each input to 1920x1080, 30fps, yuv420p
    for i in range(n):
        filters.append(
            f"[{i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,"
            f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,"
            f"format=yuv420p[v{i}]")
    # xfade chain
    cur = "v0"
    offset = durs[0]
    for i in range(1, n):
        out = f"x{i}" if i < n - 1 else "vout"
        filters.append(
            f"[{cur}][v{i}]xfade=transition=fade:duration={XFADE}:offset={offset:.3f}[{out}]")
        cur = out
        offset += durs[i]
    filtergraph = ";".join(filters)
    print("total video (expect ~audio):", round(offset, 3))

    cmd = (["ffmpeg", "-y", "-v", "error"] + inputs +
           ["-filter_complex", filtergraph,
            "-map", "[vout]", "-map", f"{n}:a",
            "-c:v", "libx264", "-crf", "20", "-preset", "medium",
            "-pix_fmt", "yuv420p", "-r", "30",
            "-c:a", "aac", "-b:a", "160k",
            "-movflags", "+faststart",
            "-t", f"{audio_dur:.3f}",
            OUT])
    print("running ffmpeg…")
    subprocess.run(cmd, check=True)
    print("DONE:", OUT)


if __name__ == "__main__":
    sys.exit(main())
