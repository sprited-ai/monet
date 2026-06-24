#!/bin/bash
set -e
export CUDA_HOME=/usr/local/cuda-12.8
export PATH=$CUDA_HOME/bin:$HOME/.local/bin:$PATH
export TORCH_CUDA_ARCH_LIST="12.0"
export MAX_JOBS=8
UV=$HOME/.local/bin/uv
cd ~/dev/sam-3d-body

echo "=== [1/5] uv venv (MANAGED py3.11 — bundles Python.h for detectron2 build) ==="
rm -rf .venv
$UV python install 3.11
$UV venv --python 3.11 --python-preference only-managed .venv
source .venv/bin/activate
$UV pip install -q setuptools wheel pip ninja
python --version
python -c "import sysconfig,os;h=os.path.join(sysconfig.get_path('include'),'Python.h');print('Python.h:',os.path.exists(h),h)"

echo "=== [2/5] torch cu128 (Blackwell sm_120) ==="
$UV pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cu128
python -c "import torch;print('torch',torch.__version__,'cuda',torch.version.cuda,torch.cuda.is_available(),torch.cuda.get_device_name(0))"

echo "=== [3/5] deps ==="
$UV pip install -q pytorch-lightning pyrender opencv-python yacs scikit-image einops timm dill pandas rich hydra-core hydra-submitit-launcher hydra-colorlog pyrootutils webdataset chump networkx==3.2.1 roma joblib seaborn wandb appdirs cython jsonlines pytest xtcocotools loguru optree fvcore black pycocotools tensorboard huggingface_hub imageio

echo "=== [4/5] detectron2 (compile, arch 12.0) ==="
$UV pip install -q "git+https://github.com/facebookresearch/detectron2.git@a1ce2f9" --no-build-isolation --no-deps
python -c "import detectron2;print('detectron2',detectron2.__version__)"

echo "=== [5/5] checkpoint dinov3 ==="
hf download facebook/sam-3d-body-dinov3 --local-dir checkpoints/sam-3d-body-dinov3

echo "=== ALL DONE ==="
ls -la checkpoints/sam-3d-body-dinov3
