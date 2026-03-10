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
  } catch { }
  try {
    const q = app?.ui?.queue;
    if (q && typeof q.click === "function") {
      q.click();
      return true;
    }
  } catch { }
  return false;
}

async function commitSave(node) {
  const group = findWidget(node, "分组名称")?.value ?? "default";
  const itemName = findWidget(node, "项目名称")?.value ?? "";
  const prompt = findWidget(node, "提示词内容")?.value ?? "";
  const fnPattern = findWidget(node, "命名格式")?.value ?? "";
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
    const isSave = nodeData?.name === "提示词组保存";
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

        const promptWidget = findWidget(this, "提示词内容");
        if (promptWidget) {
          if (promptWidget.inputEl) {
            promptWidget.inputEl.style.minHeight = "120px";
            promptWidget.inputEl.style.height = "120px";
          }

          // 当节点整体发生缩放/拉伸时回调
          const origOnResize = this.onResize;
          this.onResize = function (size) {
            if (origOnResize) origOnResize.apply(this, arguments);
            // 给 LiteGraph 留一点余量计算最新布局
            setTimeout(() => {
              if (!promptWidget.inputEl) return;
              // 计算所有前面小部件叠加起来的高度的粗略估值
              // 每个标准输入挂件通常大约是 20-30 像素左右，加上一些边距
              let fixedHeight = 0;
              for (const w of this.widgets) {
                if (w === promptWidget) break; // 遇到自己跳出
                fixedHeight += w.computeSize ? w.computeSize(size[0])[1] : 26;
                fixedHeight += 12; // widget margin
              }
              // 加上顶部标题栏与下方按钮留白
              fixedHeight += 40 /* title */ + 70 /* bot btn */;

              const newHeight = Math.max(120, size[1] - fixedHeight);
              promptWidget.inputEl.style.height = `${newHeight}px`;
            }, 0);
          };

          // 延迟一帧让DOM更新后重新计算节点大小（初始放大）
          requestAnimationFrame(() => {
            const sz = this.computeSize();
            if (sz[0] > this.size[0] || Math.max(120, sz[1]) > this.size[1]) {
              this.setSize([Math.max(sz[0], this.size[0]), Math.max(120 + 200, sz[1])]);
            }
            this.setDirtyCanvas(true, true);
          });
        }

        const saveBtn = document.createElement("button");
        saveBtn.textContent = "保存";
        saveBtn.style.cssText = "font-size: 14px; font-weight: bold; margin: 4px 0; border-radius: 4px; border: 1px solid #48b; background: rgba(50, 160, 100, 0.8); color: #eee; cursor: pointer; padding: 8px; width: 100%; box-sizing: border-box;";
        saveBtn.onmouseover = () => { saveBtn.style.background = "rgba(50, 160, 100, 1)"; };
        saveBtn.onmouseout = () => { saveBtn.style.background = "rgba(50, 160, 100, 0.8)"; };
        saveBtn.onclick = () => {
          const promptVal = findWidget(this, "提示词内容")?.value;
          if (!promptVal || String(promptVal).trim() === "") {
            try {
              const toast = app?.extensionManager?.toast;
              const msg = "提示词内容为空，请输入要保存的提示词。";
              if (toast?.add) {
                toast.add({
                  severity: "warn",
                  summary: "提示词图片管理器",
                  detail: msg,
                  life: 4000,
                });
              } else if (toast?.addAlert) {
                toast.addAlert("提示词图片管理器: " + msg);
              } else if (typeof console !== "undefined") {
                console.warn(msg);
              }
            } catch {
              // ignore UI errors
            }
            return;
          }

          // Prefer "commit save" without queuing the full graph.
          commitSave(this)
            .then(() => {
              try {
                // 使用 ComfyUI Toast 提示保存成功（非阻塞，无需手动关闭）
                const toast = app?.extensionManager?.toast;
                if (toast?.add) {
                  toast.add({
                    severity: "success",
                    summary: "提示词图片管理器",
                    detail: "已保存当前提示词与图片。",
                    life: 3000,
                  });
                } else if (toast?.addAlert) {
                  toast.addAlert("提示词图片管理器: 已保存当前提示词与图片。");
                }
              } catch {
                // ignore UI errors
              }
            })
            .catch((e) => {
              // 提示需要先执行一次节点生成预览图
              try {
                const toast = app?.extensionManager?.toast;
                const msg = "保存失败：" + (e?.message || "未知错误");
                if (toast?.add) {
                  toast.add({
                    severity: "warn",
                    summary: "提示词图片管理器",
                    detail: msg,
                    life: 4000,
                  });
                } else if (toast?.addAlert) {
                  toast.addAlert("提示词图片管理器: " + msg);
                } else if (typeof console !== "undefined") {
                  console.warn(msg);
                }
              } catch {
                // ignore
              }
            });
        };
        this.addDOMWidget("Save", "btn", saveBtn, { serialize: false, hideOnZoom: false });
      }

      return r;
    };
  },
});

