# How we should process raw seedance clips (future looking)

Most videos are generated from Seedance 1.5 Pro using reference images that have solid gray background #808080.

Most videos are generated from quarter view idle state with various framings that you see in framings.json.

We mostly lock first frame to be "idle" and last frame to be "idle" but some times, we use OpenAI image to generate different poses and use those to be last frame to generate state transitions.

Usually ComfyUI is used to generate animations using I2V.

For best maintainability and repeatability, I propose that we store raw Seedance 1.5 Pro outputs (mp4 files).

```
- contents
  - monet
    - monet-idle.mp4
    - monet-idle.yaml
```

Idea is that we store raw `.mp4` then we supply hand crafted `monet-idle.json`. 

A basic JSON file may look like:

```
{
    "animations": [{
        "startStateId": "idle",
        "startFrameIndex": 0,
        "endStateId": "idle",
        "endFrameIndex": -1
    }] 
}
```

Remember Seedance 1.5 Pro allows for multi-shot prompts where user can define multiple shots in single generation. This really helps with reducing the cost down and controlling the animation.

So, in json file, we would want to be able to supply such specificities.

```
{
    "animations": [{
        "startStateId": "idle",
        "startFrameIndex": 0,
        "endStateId": "looking-up",
        "endFrameIndex": 39
    }, {
        "startStateId": "looking-up",
        "startFrameIndex": 40,
        "endStateId": "looking-up",
        "endFrameIndex": 80
    }, {
        "startStateId": "looking-up",
        "startFrameIndex": 39,
        "endStateId": "idle",
        "endFrameIndex": 0,
        "reverse": true
    }],
    "keyframeIndex": 39
}
```

What this does is that we build a state nodes and transition graph.

Animations are transition functions.

Then at `contents/monet/index.json`, we list out all of these json files so that in runtime, we can load these json files to compile the full state and transition graph.

## Derivatives

We have several derivatives we need to generate offline (baking) before we can serve these animations though.

1. `monet-idle.alpha.mp4`: alpha mask (birefnet).
2. `monet-idle.depth.mp4`: depth map (video depth anything).
3. `monet-idle.normal.mp4`: normal map (NormalCrafter?)
4. `monet-idle.s3body.json`: pose estimation (Sam3D body)
5. `monet-idle.bizarre.json`: pose estimation (bizzare pose estimator)
6. `monet-idle.face.json`: face tracking info (anime-face-detector)
7. `monet-idle.mouth.json`: mouth tracking info (Sam3 Video)
8. `monet-idle.thumbnail.webp`: thumbnail (use keyframeIndex)

They just need to be generated from source video.

To generate these derivatives one usually requires Nvidia GPUs but running it on macOS also works just painfully slow and may OOM.

We do however want to make this generating of derivative not platform dependent in principal given that there are enough memory to spare.

Most of the time, we would just do:
```bash
ssh gin
cd ~/dev/monet
git pull
source ./scripts/.venv/bin/activate 
uv pip install ./scripts/requirements.txt # or something equivalent
uv run python scripts/process_animations.py # or something
```

## Process Animation Script

It will go through all animations in `contents/monet` then create the derivatives.

If there are already derivatives, it will skip that particular derivatives.

If there aren't the .json file, it will generate a default one with sensible defaults.

## Using comfy.sprited.ai

comfy.sprited.ai is my personal server with 96GB GPU. RTX 6000 Pro.

While this adds non-standard dependency. It really helps out if I can use the same models in Comfy and experiment instead of having two copies of different models.

It also helps to be able to run generation of derivatives from MAC and to have all inferencing done in a beefy machine out side.

So, for V1, I would stick to comfy.sprited.ai for inferencing. This service is already used heavily in our codebase anyways.

## Automation

단순히 seedance 1.5 pro 결과값 폴더에 드랍하고 커멘드 하나만 돌리면 주변 것들 알아서 다 제러네이트 되는 상황이 되었으면 좋겠어. 

그 다음 타겟은 seedance 1.5 pro 까지 그냥 커멘드 라인 하나로 그냥 만들어 지고 쉽게 만들어 질 수 있도록
```bash
monet i2i --image "./contents/monet/monet-idle-quarter.png" --prompt "..." --output "..."
monet i2v --image1 "./contents/monet/monet-idle-quarter.png" --image2 "./contents/monet/monet-idle-quarter.png" --prompt "..." --output "..."
monet generate-sidecars --video "./contents/..." --output "..."
```
이렇게 돌리면 알아서 이미 만들어진 comfy 워크플로우 돌리고 프로세싱해서 알아서 contents 폴더에 올리고 wiring it up 까지 해 주는거지.
