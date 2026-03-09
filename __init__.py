from __future__ import annotations

from typing import Any, Dict

from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "web"


def _register_routes() -> None:
    try:
        from aiohttp import web
        from server import PromptServer  # ComfyUI
    except Exception:
        return

    from . import storage
    from . import nodes
    import os
    import shutil
    import time

    routes = PromptServer.instance.routes

    async def groups(_request):
        return web.json_response({"groups": storage.list_groups()})

    async def group_detail(request):
        name = request.match_info.get("name", "")
        name = storage._safe_name(name)
        return web.json_response({"group": name, **storage.get_group(name)})

    async def delete_item(request):
        name = request.match_info.get("name", "")
        name = storage._safe_name(name)
        try:
            payload = await request.json()
            ts = payload.get("ts")
            print(f"[PIM DEBUG] Delete request received for ts: {ts}, name: {name}")
            if ts is None:
                print("[PIM DEBUG] Missing ts in request")
                return web.json_response({"ok": False, "error": "missing_ts"}, status=400)
            
            idx = storage.load_index()
            groups = idx.get("groups", {})
            if name in groups:
                items = groups[name].get("items", [])
                print(f"[PIM DEBUG] Current items count: {len(items)}")
                new_items = [it for it in items if it.get("ts") != ts]
                print(f"[PIM DEBUG] New items count: {len(new_items)}")
                if not new_items:
                    del groups[name]
                    print(f"[PIM DEBUG] Group {name} is empty, deleted.")
                else:
                    groups[name]["items"] = new_items
                storage.save_index(idx)
                print("[PIM DEBUG] Index saved successfully")
                return web.json_response({"ok": True})
            print(f"[PIM DEBUG] Group {name} not found in {list(groups.keys())}")
            return web.json_response({"ok": False, "error": "group_not_found"}, status=404)
        except Exception as e:
            print(f"[PIM DEBUG] Error during delete: {str(e)}")
            return web.json_response({"ok": False, "error": str(e)}, status=500)

    routes.get("/pim/groups")(groups)
    routes.get("/pim/group/{name}")(group_detail)
    routes.post("/pim/group/{name}/delete")(delete_item)

    async def commit_save(request):
        """
        Save without queuing the whole graph:
        copies the last temp preview for a node unique_id into output and registers index.
        """
        try:
            payload = await request.json()
        except Exception:
            return web.json_response({"ok": False, "error": "invalid_json"}, status=400)

        uid = str(payload.get("unique_id") or "")
        if not uid:
            return web.json_response({"ok": False, "error": "missing_unique_id"}, status=400)

        info = nodes._LAST_PREVIEW_BY_UID.get(uid)
        if not info:
            return web.json_response({"ok": False, "error": "no_preview_yet"}, status=409)

        abs_src = info.get("abs_path") or ""
        if not abs_src or not os.path.exists(abs_src):
            return web.json_response({"ok": False, "error": "preview_missing"}, status=409)

        group = storage._safe_name(str(payload.get("group_name") or "default"))
        item_name = str(payload.get("item_name") or "").strip()
        item = storage._safe_name(item_name) if item_name else ""
        prompt_text = (payload.get("prompt_text") or "")
        prompt_final = str(prompt_text).strip()
        filename_pattern = str(payload.get("filename_pattern") or "").strip()

        # Compute index for {index} variable
        group_data = storage.get_group(group)
        current_count = len(group_data.get("items") or [])

        # Copy preview -> output/prompt_image_manager
        out_dir = storage.pim_dir()
        ts = int(time.time())
        expanded = storage.expand_filename_pattern(filename_pattern, group=group, item=item, index=current_count)
        filename = f"{expanded}.png"
        abs_dst = os.path.join(out_dir, filename)
        shutil.copy2(abs_src, abs_dst)

        item = storage.SavedItem(
            group=group,
            ts=ts,
            prompt_clean=prompt_final,
            prompt_original=str(prompt_text),
            removed_text=[],
            filename=filename,
            subfolder=storage.SUBFOLDER,
            type="output",
            item_name=item_name,
        )
        storage.register_item(item)

        return web.json_response(
            {
                "ok": True,
                "image": {"filename": filename, "subfolder": storage.SUBFOLDER, "type": "output"},
                "saved_image_path": f"{storage.SUBFOLDER}/{filename}",
            }
        )

    routes.post("/pim/commit_save")(commit_save)


_register_routes()

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

