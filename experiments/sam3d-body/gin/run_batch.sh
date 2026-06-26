#!/bin/bash
export CUDA_HOME=/usr/local/cuda-12.8
export PATH=$CUDA_HOME/bin:$HOME/.local/bin:$PATH
cd ~/dev/sam-3d-body
source .venv/bin/activate
python sam3d_batch.py
