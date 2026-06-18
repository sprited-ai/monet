# Backlog

- [ ] Read "../anima/v34"
- [ ] Create v1 following "../anima/v34".

## Experiments

- [x] Get `bizarre-pose-estimator` running locally (native arm64, CPU) — anime/illustration
      pose estimator. Working on repo-root `.venv`. See
      `experiments/bizarre-pose-estimator/RUN_NOTES.md` for the recipe (detectron2 source build,
      `TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1`, numpy-2 patch, new GDrive file ID). Excluded from git.
- [ ] (maybe) Use bizarre-pose-estimator to extract COCO keypoints from Monet animation frames —
      could feed pose-conditioned generation / consistency checks for the v1 animation pipeline.
