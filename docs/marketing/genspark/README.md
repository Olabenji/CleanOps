# CleanOps marketing — Genspark pack

Ready-to-paste brief for generating a CleanOps marketing video + jingle in Genspark AI.

| Item | Path |
|------|------|
| **Master instruction script** | [`GENSPARK_MASTER_INSTRUCTION.md`](./GENSPARK_MASTER_INSTRUCTION.md) |
| Feature images | [`assets/`](./assets/) |

## Feature images

| File | Workload shown |
|------|----------------|
| `cleanops-feature-workload-fleet.png` | Morning fleet / ward ops atmosphere |
| `cleanops-feature-problem-to-solution.png` | Paper chaos → digital command |
| `cleanops-feature-operator-dashboard.png` | Operator web command centre |
| `cleanops-feature-driver-field.png` | Driver field routes on mobile |
| `cleanops-feature-agent-collections.png` | Agent door-to-door payments + receipts |

## Built locally in Cursor

| File | Duration |
|------|----------|
| `output/CleanOps_Marketing_Hero_30s.mp4` | 35s |
| `output/CleanOps_Marketing_Cutdown_15s.mp4` | 15s |
| `output/jingle.wav` | audio bed |

Rebuild: `python docs/marketing/genspark/build_video.py` (needs FFmpeg + Pillow).

## Quick start (Genspark)

1. Upload the five PNGs in `assets/` to Genspark.
2. Copy the fenced block under **PASTE INTO GENSPARK** in `GENSPARK_MASTER_INSTRUCTION.md`.
3. Ask Genspark for a shot board first, then render.
