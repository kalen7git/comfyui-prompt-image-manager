from __future__ import annotations

import os
import time
from typing import Dict, Tuple

import numpy as np
import shutil


try:
    import torch
except Exception:  # pragma: no cover
    torch = None  # type: ignore

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None  # type: ignore

try:
    import folder_paths  # ComfyUI
except Exception:  # pragma: no cover
    folder_paths = None  # type: ignore

from .storage import (
    SUBFOLDER,
    SavedItem,
    _safe_name,
    clean_prompt,
    expand_filename_pattern,
    pim_dir,
    register_item,
)

_LAST_PREVIEW_BY_UID: Dict[str, Dict[str, str]] = {}


def _tensor_to_pil(img_tensor):
    if torch is None or Image is None:
        raise RuntimeError("Missing torch/PIL; run inside ComfyUI environment.")
    if not isinstance(img_tensor, torch.Tensor):
        raise TypeError("IMAGE input must be a torch.Tensor")
    t = img_tensor
    if t.dim() == 4:
        t = t[0]
    # expected HWC float 0..1
    t = t.detach().cpu().clamp(0, 1)
    if t.shape[-1] != 3:
        # try to coerce to RGB by dropping/tiling channels
        if t.shape[-1] > 3:
            t = t[..., :3]
        elif t.shape[-1] == 1:
            t = t.repeat(1, 1, 3)
        else:
            raise ValueError(f"Unexpected channel count: {t.shape[-1]}")
    arr = (t.numpy() * 255.0).round().astype(np.uint8)
    return Image.fromarray(arr, mode="RGB")


def _pil_to_tensor(pil: "Image.Image"):
    if torch is None:
        raise RuntimeError("Missing torch; run inside ComfyUI environment.")
    if pil.mode != "RGB":
        pil = pil.convert("RGB")
    arr = np.array(pil).astype(np.float32) / 255.0  # HWC
    t = torch.from_numpy(arr)
    return t.unsqueeze(0)  # BHWC


def _resolve_saved_image_path(filename: str, subfolder: str, t: str) -> str:
    # For our plugin we always save into output/SUBFOLDER, but keep it generic.
    base = None
    if folder_paths is not None:
        base = folder_paths.get_output_directory() if (t or "output") == "output" else folder_paths.get_input_directory()
    if base is None:
        base = os.path.abspath(os.path.join(os.getcwd(), "output" if (t or "output") == "output" else "input"))
    return os.path.join(base, subfolder or "", filename)


def _save_output_image(pil: "Image.Image", base_name: str, group: str = "default", item: str = "", index: int = 0) -> Tuple[str, str, str]:
    """
    Returns (filename, subfolder, type) suitable for ComfyUI /view.
    """
    out_dir = pim_dir()
    expanded = expand_filename_pattern(base_name, group=group, item=item, index=index)
    filename = f"{expanded}.png"
    abs_path = os.path.join(out_dir, filename)
    pil.save(abs_path, format="PNG", optimize=True)
    return filename, SUBFOLDER, "output"


def _save_temp_preview(pil: "Image.Image", base_name: str) -> Tuple[str, str, str, str]:
    """
    Save a preview image into ComfyUI temp, so UI can render it without "officially saving".
    Returns (filename, subfolder, type) suitable for /view.
    """
    ts = int(time.time() * 1000)
    safe = _safe_name(base_name)
    filename = f"preview_{safe}_{ts}.png"

    if folder_paths is not None and hasattr(folder_paths, "get_temp_directory"):
        base = folder_paths.get_temp_directory()
        subfolder = SUBFOLDER
        out_dir = os.path.join(base, subfolder)
        os.makedirs(out_dir, exist_ok=True)
        abs_path = os.path.join(out_dir, filename)
        pil.save(abs_path, format="PNG", optimize=True)
        return filename, subfolder, "temp", abs_path

    # Fallback (non-Comfy env)
    out_dir = pim_dir()
    abs_path = os.path.join(out_dir, filename)
    pil.save(abs_path, format="PNG", optimize=True)
    return filename, SUBFOLDER, "output", abs_path


class PromptImageGroupSave:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "group_name": ("STRING", {"default": "default"}),
                "item_name": ("STRING", {"default": ""}),
                "filename_pattern": ("STRING", {"default": "{group}_{item}_{date}_{time}"}),
                "prompt_text": ("STRING", {"multiline": True, "default": ""}),
                "image": ("IMAGE",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt_text", "saved_image_path")
    FUNCTION = "save"
    CATEGORY = "Prompt Image Manager"
    OUTPUT_NODE = True

    def save(
        self,
        group_name: str,
        prompt_text: str,
        image,
        item_name: str = "",
        filename_pattern: str = "{group}_{item}_{date}_{time}",
        unique_id: str = "",
    ) -> Tuple[str, str]:
        group = _safe_name(group_name)
        item = _safe_name(item_name) if item_name else ""
        # Text is fully user-provided; do not auto-clean/modify.
        prompt_final = (prompt_text or "").strip()

        view_path = ""

        pil = _tensor_to_pil(image)
        # Always generate a temp preview for node UI
        p_fn, p_sub, p_type, p_abs = _save_temp_preview(pil, filename_pattern.strip() or group)
        if unique_id:
            _LAST_PREVIEW_BY_UID[str(unique_id)] = {
                "filename": p_fn,
                "subfolder": p_sub,
                "type": p_type,
                "abs_path": p_abs,
            }

        return {
            "ui": {
                "images": [
                    {
                        "filename": p_fn,
                        "subfolder": p_sub,
                        "type": p_type,
                    }
                ],
            },
            "result": (prompt_final, view_path),
        }


class PromptImageGroupLoadItem:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "group_name": ("STRING", {"default": "default"}),
                "item_index": ("INT", {"default": 0, "min": 0, "max": 499, "step": 1}),
            }
        }

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("prompt_text", "image")
    FUNCTION = "load"
    CATEGORY = "Prompt Image Manager"
    OUTPUT_NODE = True

    def load(self, group_name: str, item_index: int) -> Tuple[str, object]:
        from .storage import get_group, _safe_name

        if Image is None:
            raise RuntimeError("Missing PIL; run inside ComfyUI environment.")

        g = _safe_name(group_name)
        data = get_group(g)
        items = data.get("items") or []
        if not items:
            # empty: return blank values
            if torch is None:
                return ("", None)
            blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return ("", blank)

        idx = max(0, min(int(item_index), len(items) - 1))
        it = items[idx] or {}
        img = (it.get("image") or {})
        filename = img.get("filename") or ""
        subfolder = img.get("subfolder") or SUBFOLDER
        t = img.get("type") or "output"

        abs_path = _resolve_saved_image_path(filename, subfolder, t)
        if not filename or not os.path.exists(abs_path):
            if torch is None:
                return (it.get("prompt_clean") or "", None)
            blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
            return (it.get("prompt_clean") or "", blank)

        pil = Image.open(abs_path)
        image_tensor = _pil_to_tensor(pil)
        prompt = it.get("prompt_clean") or ""
        
        return {
            "ui": {
                "images": [
                    {
                        "filename": filename,
                        "subfolder": subfolder,
                        "type": t,
                    }
                ],
                "text": [prompt],
            },
            "result": (prompt, image_tensor),
        }


NODE_CLASS_MAPPINGS: Dict[str, object] = {
    "PromptImageGroupSave": PromptImageGroupSave,
    "PromptImageGroupLoadItem": PromptImageGroupLoadItem,
}

NODE_DISPLAY_NAME_MAPPINGS: Dict[str, str] = {
    "PromptImageGroupSave": "Prompt Group Save (text+image)",
    "PromptImageGroupLoadItem": "Prompt Group Load Item (prompt+image)",
}

