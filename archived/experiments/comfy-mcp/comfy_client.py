"""Minimal ComfyUI client for the Sprited server (comfy.sprited.ai).

Reachable through Cloudflare Access — auth is a service token whose creds live in
monet/.env.local (COMFY_BASE_URL, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET).

This is deliberately dependency-free (urllib only) so it runs anywhere.
"""

from __future__ import annotations

import json
import time
import urllib.request
import urllib.parse
from pathlib import Path

# .env.local lives at the repo root (two levels up from this file).
ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"


def _load_env(path: Path = ENV_PATH) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Comfy:
    def __init__(self) -> None:
        env = _load_env()
        self.base = env["COMFY_BASE_URL"].rstrip("/")
        self._headers = {
            "CF-Access-Client-Id": env["CF_ACCESS_CLIENT_ID"],
            "CF-Access-Client-Secret": env["CF_ACCESS_CLIENT_SECRET"],
            # Cloudflare Bot Fight Mode 1010-bans the default "Python-urllib" UA.
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) monet-comfy/0.1",
        }
        # Stable per-process id so queue/history calls correlate.
        self.client_id = f"monet-{int(time.time())}"

    def _req(self, path: str, *, data: bytes | None = None, headers: dict | None = None):
        url = f"{self.base}{path}"
        h = dict(self._headers)
        if headers:
            h.update(headers)
        req = urllib.request.Request(url, data=data, headers=h, method="POST" if data else "GET")
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read()

    def upload_image(self, path: Path) -> str:
        """Upload a local image to the server's input dir; return its server filename."""
        boundary = "----monetboundary"
        body = b"".join(
            [
                f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{path.name}"\r\n'.encode(),
                b"Content-Type: image/png\r\n\r\n",
                path.read_bytes(),
                f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n".encode(),
                f"--{boundary}--\r\n".encode(),
            ]
        )
        out = self._req("/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
        return json.loads(out)["name"]

    def queue(self, graph: dict) -> str:
        """Submit a prompt graph; return its prompt_id."""
        payload = json.dumps({"prompt": graph, "client_id": self.client_id}).encode()
        out = self._req("/prompt", data=payload, headers={"Content-Type": "application/json"})
        return json.loads(out)["prompt_id"]

    def wait(self, prompt_id: str, *, timeout: float = 300, poll: float = 2.0) -> dict:
        """Block until the prompt finishes; return its history entry."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            hist = json.loads(self._req(f"/history/{prompt_id}") or b"{}")
            if prompt_id in hist:
                return hist[prompt_id]
            time.sleep(poll)
        raise TimeoutError(f"prompt {prompt_id} did not finish within {timeout}s")

    def images(self, history_entry: dict) -> list[dict]:
        """Pull {filename, subfolder, type} for every SaveImage output."""
        imgs: list[dict] = []
        for node_out in history_entry.get("outputs", {}).values():
            for img in node_out.get("images", []):
                imgs.append(img)
        return imgs

    def download(self, img: dict, dest: Path) -> Path:
        q = urllib.parse.urlencode(
            {"filename": img["filename"], "subfolder": img.get("subfolder", ""), "type": img.get("type", "output")}
        )
        data = self._req(f"/view?{q}")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return dest
