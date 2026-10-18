"""Explicit bounded model installation, separate from production inference.

One pinned official snapshot, no Hub cache copy and no automatic retries.
Interrupted downloads may be explicitly resumed. Files never enter Git.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor


def digest(path, metadata):
    if "sha256" in metadata:
        with path.open("rb") as f:
            return hashlib.file_digest(f, "sha256").hexdigest() == metadata["sha256"]
    raw = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == metadata["gitBlob"]


def install(destination, weight_host="huggingface"):
    manifest = json.loads(Path(__file__).with_name("model-source.json").read_text())
    root = Path(destination).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    remaining = sum(max(0, meta["size"] - (root / (name + ".part")).stat().st_size)
                    if (root / (name + ".part")).exists() else meta["size"]
                    for name, meta in manifest["files"].items() if not (root / name).exists())
    if shutil.disk_usage(root).free < remaining + 8 * 1024**3:
        raise RuntimeError("Not enough free space for the pinned model plus 8 GiB reserve")

    def download(item):
        name, metadata = item
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.stat().st_size != metadata["size"] or not digest(target, metadata):
                raise RuntimeError("Existing model file mismatches; preserve and inspect: " + name)
            return
        partial = target.with_name(target.name + ".part")
        if partial.exists() and partial.stat().st_size == metadata["size"] and digest(partial, metadata):
            partial.rename(target)
            return
        url = f"https://huggingface.co/{manifest['repository']}/resolve/{manifest['revision']}/{name}"
        if weight_host == "modelscope" and "sha256" in metadata:
            # This is a byte mirror, never a different model selection. The
            # official pinned SHA-256 and size remain mandatory after resume.
            url = f"https://modelscope.cn/models/{manifest['repository']}/resolve/master/{name}"
        subprocess.run(["curl", "-fLSs", "--max-time", "1800", "--continue-at", "-", url, "-o", str(partial)], check=True)
        if partial.stat().st_size != metadata["size"] or not digest(partial, metadata):
            raise RuntimeError("Downloaded bytes mismatch: " + name)
        partial.rename(target)
        print(json.dumps({"verified": name, "bytes": metadata["size"]}), flush=True)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(download, manifest["files"].items()))
    files = {}
    for name, meta in manifest["files"].items():
        with (root / name).open("rb") as f:
            files[name] = {"size": meta["size"], "sha256": hashlib.file_digest(f, "sha256").hexdigest()}
    lock = {"repository": manifest["repository"], "revision": manifest["revision"], "files": files}
    (root / "storyforge-model-lock.json").write_text(json.dumps(lock, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--weight-host", choices=("huggingface", "modelscope"), default="huggingface")
    args = parser.parse_args()
    install(args.destination, args.weight_host)
