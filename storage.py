import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple


try:
    import folder_paths  # ComfyUI
except Exception:  # pragma: no cover
    folder_paths = None  # type: ignore


INDEX_FILENAME = "pim_index.json"
SUBFOLDER = "prompt_image_manager"


def _now_ts() -> int:
    return int(time.time())


def _safe_name(name: str) -> str:
    name = (name or "").strip()
    name = re.sub(r"[^\w\-\.\s\u4e00-\u9fff]", "_", name, flags=re.UNICODE)
    name = re.sub(r"\s+", " ", name).strip()
    return name or "默认分组"


def expand_filename_pattern(
    pattern: str,
    group: str = "默认分组",
    item: str = "",
    index: int = 0,
) -> str:
    """Expand a filename pattern with template variables.

    Supported variables:
        {group}  - group name
        {item}   - item name (if empty, stripped out)
        {date}   - current date (YYYY-MM-DD)
        {time}   - current time (HH-MM-SS)
        {ts}     - unix timestamp
        {index}  - zero-padded index within the group (e.g. 001)

    If the pattern contains no '{}' variables, it is treated as a plain
    prefix and '_{ts}' is appended automatically for backward compatibility.
    """
    import datetime

    pattern = (pattern or "").strip()
    if not pattern:
        pattern = "{分组}_{项目}_{日期}_{时间}"

    # If no template variables detected, treat as plain prefix (backward compat)
    if "{" not in pattern:
        ts = int(time.time())
        safe = _safe_name(pattern)
        return f"{safe}_{ts}"

    now = datetime.datetime.now()
    ts = int(time.time())

    replacements = {
        "group": _safe_name(group),
        "item": _safe_name(item) if item else "",
        "date": now.strftime("%Y-%m-%d"),
        "time": now.strftime("%H-%M-%S"),
        "ts": str(ts),
        "index": f"{index:03d}",
        "分组": _safe_name(group),
        "项目": _safe_name(item) if item else "",
        "日期": now.strftime("%Y-%m-%d"),
        "时间": now.strftime("%H-%M-%S"),
        "时间戳": str(ts),
        "序号": f"{index:03d}",
    }

    result = pattern
    for key, value in replacements.items():
        result = result.replace("{" + key + "}", value)

    # Clean the final result
    result = _safe_name(result)
    # Remove consecutive underscores that might result from empty variables like {item}
    result = re.sub(r"_{2,}", "_", result)
    result = result.strip("_")
    
    return result or "默认分组"


def _output_dir() -> str:
    if folder_paths is None:
        # Fallback for unit testing / non-Comfy environment
        return os.path.abspath(os.path.join(os.getcwd(), "output"))
    return folder_paths.get_output_directory()


def pim_dir() -> str:
    d = os.path.join(_output_dir(), SUBFOLDER)
    os.makedirs(d, exist_ok=True)
    return d


def index_path() -> str:
    return os.path.join(pim_dir(), INDEX_FILENAME)


def load_index() -> Dict[str, Any]:
    p = index_path()
    if not os.path.exists(p):
        return {"version": 1, "groups": {}}
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"version": 1, "groups": {}}
        data.setdefault("version", 1)
        data.setdefault("groups", {})
        if not isinstance(data["groups"], dict):
            data["groups"] = {}
        return data
    except Exception:
        return {"version": 1, "groups": {}}


def save_index(data: Dict[str, Any]) -> None:
    p = index_path()
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, p)


def clean_prompt(
    text: str,
    remove_lines_regex: str = "",
    remove_inline_regex: str = "",
    strip_empty_lines: bool = True,
) -> Tuple[str, List[str]]:
    original = text or ""
    removed: List[str] = []

    line_re = None
    if (remove_lines_regex or "").strip():
        line_re = re.compile(remove_lines_regex, re.IGNORECASE)

    inline_re = None
    if (remove_inline_regex or "").strip():
        inline_re = re.compile(remove_inline_regex, re.IGNORECASE)

    out_lines: List[str] = []
    for line in original.splitlines():
        raw = line
        if line_re and line_re.search(raw):
            removed.append(raw)
            continue
        if inline_re:
            raw2 = inline_re.sub("", raw)
            if raw2 != raw:
                removed.append(raw)
            raw = raw2
        if strip_empty_lines and not raw.strip():
            continue
        out_lines.append(raw.rstrip())

    cleaned = "\n".join(out_lines).strip()
    return cleaned, removed


@dataclass
class SavedItem:
    group: str
    ts: int
    prompt_clean: str
    prompt_original: str
    removed_text: List[str]
    filename: str
    subfolder: str
    type: str
    item_name: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "group": self.group,
            "ts": self.ts,
            "item_name": self.item_name,
            "prompt_clean": self.prompt_clean,
            "prompt_original": self.prompt_original,
            "removed_text": self.removed_text,
            "image": {
                "filename": self.filename,
                "subfolder": self.subfolder,
                "type": self.type,
            },
        }


def register_item(item: SavedItem) -> None:
    idx = load_index()
    groups = idx.setdefault("groups", {})
    g = item.group
    groups.setdefault(g, {"items": []})
    if not isinstance(groups[g].get("items"), list):
        groups[g]["items"] = []
    groups[g]["items"].insert(0, item.to_dict())
    # Keep index from growing without bound
    groups[g]["items"] = groups[g]["items"][:500]
    save_index(idx)


def list_groups() -> List[str]:
    idx = load_index()
    return sorted(list((idx.get("groups") or {}).keys()))


def get_group(name: str) -> Dict[str, Any]:
    idx = load_index()
    g = (idx.get("groups") or {}).get(name)
    if not isinstance(g, dict):
        return {"items": []}
    items = g.get("items")
    if not isinstance(items, list):
        items = []
    return {"items": items}

