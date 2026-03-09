import { app } from "../../scripts/app.js";

function findWidget(node, name) {
  if (!node?.widgets) return null;
  return node.widgets.find((w) => w?.name === name) || null;
}

function tryQueue() {
  // Different ComfyUI builds expose different helpers.
  // Best-effort: if we can queue, do it; otherwise user can press Queue manually.
  try {
    if (typeof app.queuePrompt === "function") {
      app.queuePrompt(0, 1);
      return true;
    }
  } catch {}
  try {
    const q = app?.ui?.queue;
    if (q && typeof q.click === "function") {
      q.click();
      return true;
    }
  } catch {}
  return false;
}

async function commitSave(node) {
  const group = findWidget(node, "group_name")?.value ?? "default";
  const itemName = findWidget(node, "item_name")?.value ?? "";
  const prompt = findWidget(node, "prompt_text")?.value ?? "";
  const fnPattern = findWidget(node, "filename_pattern")?.value ?? "";
  const payload = {
    unique_id: String(node.id ?? ""),
    group_name: String(group ?? ""),
    item_name: String(itemName ?? ""),
    prompt_text: String(prompt ?? ""),
    filename_pattern: String(fnPattern ?? ""),
  };
  const r = await fetch("/pim/commit_save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    const err = j?.error || `${r.status} ${r.statusText}`;
    throw new Error(err);
  }
  return await r.json();
}

app.registerExtension({
  name: "prompt_image_manager.save_button",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const isSave = nodeData?.name === "PromptImageGroupSave";
    if (!isSave) return;

    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = orig?.apply(this, arguments);

      if (isSave) {
        const saveNow = findWidget(this, "save_now");
        if (saveNow) {
          // Hide the raw toggle; we'll drive it via button.
          saveNow.options = saveNow.options || {};
          saveNow.options.hidden = true;
        }

        this.addWidget("button", "Save", "保存", () => {
          // Prefer "commit save" without queuing the full graph.
          commitSave(this)
            .then(() => {
              try {
                // 使用 ComfyUI Toast 提示保存成功（非阻塞，无需手动关闭）
                const toast = app?.extensionManager?.toast;
                if (toast?.add) {
                  toast.add({
                    severity: "success",
                    summary: "Prompt Image Manager",
                    detail: "已保存当前提示词与图片。",
                    life: 3000,
                  });
                } else if (toast?.addAlert) {
                  toast.addAlert("Prompt Image Manager: 已保存当前提示词与图片。");
                }
              } catch {
                // ignore UI errors
              }
            })
            .catch((e) => {
              // 提示需要先执行一次节点生成预览图
              try {
                const toast = app?.extensionManager?.toast;
                const msg =
                  "保存失败：" +
                  (e?.message || "") +
                  "。请先运行一次该节点生成预览图，然后再点击 Save。";
                if (toast?.add) {
                  toast.add({
                    severity: "warn",
                    summary: "Prompt Image Manager",
                    detail: msg,
                    life: 4000,
                  });
                } else if (toast?.addAlert) {
                  toast.addAlert("Prompt Image Manager: " + msg);
                } else if (typeof console !== "undefined") {
                  console.warn(msg);
                }
              } catch {
                // ignore
              }
            });
        });
      }

      return r;
    };
  },
});

