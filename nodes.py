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


def _save_output_image(pil: "Image.Image", base_name: str, group: str = "默认分组", item: str = "", index: int = 0) -> Tuple[str, str, str]:
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
                "分组名称": ("STRING", {"default": "默认分组"}),
                "项目名称": ("STRING", {"default": ""}),
                "命名格式": ("STRING", {"default": "{分组}_{项目}_{日期}_{时间}"}),
                "提示词内容": ("STRING", {"multiline": True, "default": ""}),
                "图片": ("IMAGE",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ()
    RETURN_NAMES = ()
    FUNCTION = "save"
    CATEGORY = "提示词图片管理器"
    OUTPUT_NODE = True

    def save(
        self,
        分组名称: str,
        提示词内容: str,
        图片,
        项目名称: str = "",
        命名格式: str = "{分组}_{项目}_{日期}_{时间}",
        unique_id: str = "",
    ) -> dict:
        group_name = 分组名称
        prompt_text = 提示词内容
        image = 图片
        item_name = 项目名称
        filename_pattern = 命名格式
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
            "result": (),
        }


class PromptImageGroupLoadItem:
    @classmethod
    def INPUT_TYPES(cls):
        from .storage import list_groups
        groups = list_groups()
        if not groups:
            groups = ["默认分组"]
        return {
            "required": {
                "分组名称": (groups,),
                "记录索引": ("INT", {"default": 0, "min": 0, "max": 499, "step": 1}),
            }
        }

    RETURN_TYPES = ("STRING", "IMAGE")
    RETURN_NAMES = ("提示词", "图片")
    FUNCTION = "load"
    CATEGORY = "提示词图片管理器"
    OUTPUT_NODE = True

    def load(self, 分组名称: str, 记录索引: int) -> Tuple[str, object]:
        group_name = 分组名称
        item_index = 记录索引
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
                "item_name": [it.get("item_name") or ""],
            },
            "result": (prompt, image_tensor),
        }


NODE_CLASS_MAPPINGS: Dict[str, object] = {
    "提示词组保存": PromptImageGroupSave,
    "提示词组加载项": PromptImageGroupLoadItem,
}

NODE_DISPLAY_NAME_MAPPINGS: Dict[str, str] = {
    "提示词组保存": "提示词组保存 (文本+图片)",
    "提示词组加载项": "提示词组加载项 (提示词+图片)",
}

