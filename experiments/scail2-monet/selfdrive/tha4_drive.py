#!/usr/bin/env python3
"""Self-driven pose sequence for THA4 — the DRIVER, no human capture.

Input: her speech audio (wav) + an emotion + a render fps.
Output: pose_sequence.json — one named THA4 pose vector per frame, built from
  - visemes  : mouth opening driven by the audio amplitude envelope (her own voice)
  - emotion  : a small expression bias
  - life     : breathing, gentle head sway, gaze drift, periodic blink
NOTHING here comes from a webcam/ARKit. The body is driven by her generated speech +
state. This is the endo-driven proof (memory: living-agent-not-vtuber).

  python3 tha4_drive.py --wav monet_line.wav --emotion happy --fps 20 --out pose_sequence.json
"""
import argparse, json, math, wave, struct

def rms_envelope(wav_path, fps):
    w = wave.open(wav_path, "rb")
    sr, n, ch, sw = w.getframerate(), w.getnframes(), w.getnchannels(), w.getsampwidth()
    raw = w.readframes(n); w.close()
    assert sw == 2, "expect 16-bit pcm"
    samples = struct.unpack("<%dh" % (len(raw) // 2), raw)
    if ch == 2:
        samples = samples[0::2]
    dur = len(samples) / sr
    nfr = max(1, int(math.ceil(dur * fps)))
    win = int(sr / fps)
    env = []
    for i in range(nfr):
        s = samples[i * win:(i + 1) * win]
        if not s:
            env.append(0.0); continue
        env.append((sum(v * v for v in s) / len(s)) ** 0.5)
    m = max(env) or 1.0
    return [e / m for e in env], dur, nfr

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--wav", required=True)
    p.add_argument("--emotion", default="happy", choices=["happy", "neutral", "surprised"])
    p.add_argument("--fps", type=int, default=20)
    p.add_argument("--mouth_gain", type=float, default=1.15, help="viseme drive strength")
    p.add_argument("--out", default="pose_sequence.json")
    a = p.parse_args()
    env, dur, nfr = rms_envelope(a.wav, a.fps)

    frames = []
    blink_period = 2.6      # s
    for i in range(nfr):
        t = i / a.fps
        e = env[i]
        openness = max(0.0, min(1.0, (e ** 0.55) * a.mouth_gain))   # gamma-lifted mouth open

        # visemes: aaa is the main open; mix in ooo/iii via slow phase so the shape varies
        ph = 2 * math.pi * 0.9 * t
        ooo = openness * 0.45 * max(0.0, math.sin(ph))
        iii = openness * 0.35 * max(0.0, math.sin(ph + 2.1))
        aaa = max(0.0, openness - 0.5 * ooo - 0.5 * iii)
        pose = {"mouth_aaa": round(aaa, 3), "mouth_ooo": round(ooo, 3), "mouth_iii": round(iii, 3)}

        # emotion bias
        if a.emotion == "happy":
            pose["eye_happy_wink_left"] = 0.25
            pose["eye_happy_wink_right"] = 0.25
        elif a.emotion == "surprised":
            pose["eye_surprised_left"] = 0.5
            pose["eye_surprised_right"] = 0.5

        # life: breathing, head sway, gaze drift
        pose["breathing"] = round(0.5 + 0.5 * math.sin(2 * math.pi * 0.25 * t), 3)
        pose["head_x"] = round(0.18 * math.sin(2 * math.pi * 0.11 * t), 3)
        pose["head_y"] = round(0.12 * math.sin(2 * math.pi * 0.17 * t + 1.0), 3)
        pose["iris_rotation_x"] = round(0.25 * math.sin(2 * math.pi * 0.09 * t), 3)

        # periodic blink (~0.18s) layered on top
        tb = t % blink_period
        if tb < 0.18:
            b = math.sin(math.pi * tb / 0.18)
            pose["eye_wink_left"] = round(b, 3)
            pose["eye_wink_right"] = round(b, 3)
        frames.append(pose)

    json.dump({"fps": a.fps, "duration": dur, "emotion": a.emotion, "frames": frames},
              open(a.out, "w"))
    print(f"wrote {a.out}: {nfr} frames @ {a.fps}fps ({dur:.2f}s), emotion={a.emotion}")

if __name__ == "__main__":
    main()
