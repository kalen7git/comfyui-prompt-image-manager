import { app } from "../../scripts/app.js";

const API_GROUPS = "/pim/groups";
const API_GROUP = (name) => `/pim/group/${encodeURIComponent(name)}`;

function findWidget(node, name) {
  if (!node?.widgets) return null;
  return node.widgets.find((w) => w?.name === name) || null;
}

function ensureCss() {
  const id = "pim-load-css";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.pim-load-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pim-load-inner {
  width: min(1000px, 96vw);
  height: min(640px, 90vh);
  background: #181818;
  color: #eee;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.18);
  box-shadow: 0 18px 48px rgba(0,0,0,0.6);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font: 12px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
.pim-load-header {
  padding: 8px 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid rgba(255,255,255,0.09);
}
.pim-load-title { font-weight: 600; }
.pim-load-body {
  flex: 1;
  display: grid;
  grid-template-columns: 180px 260px 1fr;
  gap: 0;
  overflow: hidden;
}
.pim-load-groups,
.pim-load-items,
.pim-load-preview {
  border-right: 1px solid rgba(255,255,255,0.08);
  padding: 8px;
  overflow: auto;
}
.pim-load-preview { border-right: none; }
.pim-load-btn {
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.16);
  background: rgba(255,255,255,0.06);
  color: #eee;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 12px;
}
.pim-load-btn:hover { background: rgba(255,255,255,0.12); }
.pim-load-group-btn {
  width: 100%;
  text-align: left;
  margin-bottom: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: #eee;
  cursor: pointer;
}
.pim-load-group-btn.active {
  background: rgba(120,170,255,0.22);
  border-color: rgba(120,170,255,0.5);
}
.pim-load-item {
  padding: 6px 6px;
  margin-bottom: 4px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}
.pim-load-item:hover {
  background: rgba(255,255,255,0.06);
}
.pim-load-item.active {
  background: rgba(120,170,255,0.22);
  border-color: rgba(120,170,255,0.5);
}
.pim-load-item-title {
  font-size: 11px;
  color: rgba(255,255,255,0.78);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pim-load-item-sub {
  font-size: 11px;
  color: rgba(255,255,255,0.6);
}
.pim-load-preview-img {
  max-width: 100%;
  max-height: 280px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.18);
  display: block;
  margin-bottom: 8px;
}
.pim-load-preview-text {
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.12);
  padding: 6px;
  background: rgba(0,0,0,0.35);
  max-height: 200px;
  overflow: auto;
}
.pim-load-empty {
  padding: 6px;
  color: rgba(255,255,255,0.65);
}
`;
  document.head.appendChild(style);
}

async function jget(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return await r.json();
}

function viewUrl(img) {
  const params = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder || "",
    type: img.type || "output",
  });
  return `/view?${params.toString()}`;
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "style") n.setAttribute("style", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return n;
}

/**
 * 直接在节点上显示图片预览和提示词文本。
 * 不依赖 ComfyUI 的 onExecuted 链，直接操作 node.imgs 和 widget。
 */
function applyPreviewToNode(node, imageInfo, promptText, itemName = null) {
  // --- 图片预览 ---
  if (imageInfo && imageInfo.filename) {
    const img = new Image();
    img.onload = () => {
      node.imgs = [img];
      node.setDirtyCanvas(true, true);
      // 等待一帧后调整节点大小以适应图片
      requestAnimationFrame(() => {
        const sz = node.computeSize();
        if (sz[0] > node.size[0] || sz[1] > node.size[1]) {
          node.setSize([Math.max(sz[0], node.size[0]), Math.max(sz[1], node.size[1])]);
        }
        node.setDirtyCanvas(true, true);
      });
    };
    img.src = viewUrl(imageInfo);
  }

  // --- Item Name 文本 ---
  if (node._pimNameEl) {
    if (itemName) {
      node._pimNameEl.textContent = itemName;
      node._pimNameEl.style.display = "block";
    } else {
      node._pimNameEl.style.display = "none";
    }
  }

  // --- 提示词文本 ---
  if (promptText != null && node._pimTextEl) {
    node._pimTextEl.textContent = String(promptText);
    node.setDirtyCanvas(true, true);
  }
}

function openBrowser(node) {
  ensureCss();

  const modal = el("div", { class: "pim-load-modal" });
  const inner = el("div", { class: "pim-load-inner" });

  const header = el(
    "div",
    { class: "pim-load-header" },
    el("div", { class: "pim-load-title" }, "Prompt Group Browser"),
    el(
      "button",
      {
        class: "pim-load-btn",
        onclick: () => modal.remove(),
      },
      "关闭"
    )
  );

  const body = el("div", { class: "pim-load-body" });
  const groupsCol = el("div", { class: "pim-load-groups" });
  const itemsCol = el("div", { class: "pim-load-items" });
  const previewCol = el("div", { class: "pim-load-preview" });

  body.append(groupsCol, itemsCol, previewCol);
  inner.append(header, body);
  modal.appendChild(inner);
  document.body.appendChild(modal);

  let currentGroup = null;
  let currentItems = [];
  let selectedIndex = -1;

  function renderPreview(idx) {
    previewCol.innerHTML = "";
    if (!currentItems.length || idx < 0 || idx >= currentItems.length) {
      previewCol.appendChild(el("div", { class: "pim-load-empty" }, "请选择一条记录。"));
      return;
    }
    const it = currentItems[idx];
    const img = it.image || {};
    const prompt = it.prompt_clean || "";

    const imgEl = el("img", {
      class: "pim-load-preview-img",
      src: viewUrl(img),
    });
    const promptBox = el("div", { class: "pim-load-preview-text" }, prompt || "(空提示词)");
    const useBtn = el(
      "button",
      {
        class: "pim-load-btn",
        onclick: () => {
          const g = findWidget(node, "group_name");
          const idxWidget = findWidget(node, "item_index");
          if (g) g.value = currentGroup || "default";
          if (idxWidget) idxWidget.value = idx;

          // 直接使用当前已加载的数据在节点上显示预览
          const it = currentItems[idx];
          if (it) {
            applyPreviewToNode(node, it.image, it.prompt_clean || "", it.item_name || "");
          }

          node.setDirtyCanvas(true, true);
          modal.remove();
        },
      },
      "使用这一条（写入节点）"
    );

    const copyBtn = el(
      "button",
      {
        class: "pim-load-btn",
        style: "margin-left: 8px;",
        onclick: () => {
          navigator.clipboard.writeText(prompt).then(() => {
            const originalText = copyBtn.textContent;
            copyBtn.textContent = "已复制！";
            setTimeout(() => { copyBtn.textContent = originalText; }, 1500);
          }).catch(err => {
            console.error("复制失败: ", err);
            alert("复制失败");
          });
        },
      },
      "复制提示词"
    );

    const delBtn = el(
      "button",
      {
        class: "pim-load-btn",
        style: "background: #844; margin-left: 8px;",
        onclick: async () => {
          const confirmed = await new Promise((resolve) => {
            const dialog = document.createElement("dialog");
            dialog.style.background = "#222";
            dialog.style.color = "#eee";
            dialog.style.border = "1px solid #444";
            dialog.style.borderRadius = "8px";
            dialog.style.padding = "20px";
            dialog.innerHTML = `
              <p>确定要删除这条记录吗？此操作不可撤销。</p>
              <div style="display:flex; justify-content:flex-end; gap:10px;">
                <button id="pim-cancel" class="pim-load-btn">取消</button>
                <button id="pim-confirm" class="pim-load-btn" style="background:#844;">删除</button>
              </div>
            `;
            document.body.appendChild(dialog);
            dialog.querySelector("#pim-cancel").onclick = () => {
              dialog.close();
              dialog.remove();
              resolve(false);
            };
            dialog.querySelector("#pim-confirm").onclick = () => {
              dialog.close();
              dialog.remove();
              resolve(true);
            };
            dialog.showModal();
          });

          if (!confirmed) return;

          try {
            const r = await fetch(`/pim/group/${encodeURIComponent(currentGroup)}/delete`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ts: it.ts }),
            });
            if (!r.ok) {
              const err = await r.json().catch(() => ({}));
              throw new Error(err.error || "删除失败");
            }
            await loadGroup(currentGroup);
          } catch (e) {
            alert(e.message);
          }
        },
      },
      "删除"
    );

    previewCol.append(imgEl, el("div", { style: "margin-bottom:6px;" }, useBtn, copyBtn, delBtn), promptBox);
  }

  async function loadGroup(name) {
    currentGroup = name;
    selectedIndex = -1;
    itemsCol.innerHTML = "";
    previewCol.innerHTML = "";

    const data = await jget(API_GROUP(name));
    const items = data.items || [];
    currentItems = items;

    if (!items.length) {
      itemsCol.appendChild(el("div", { class: "pim-load-empty" }, "此分组暂无记录。"));
      previewCol.appendChild(el("div", { class: "pim-load-empty" }, "暂无可预览的图片。"));
      return;
    }

    items.forEach((it, idx) => {
      let title = (it.prompt_clean || it.prompt_original || "").split(/\r?\n/)[0] || `(记录 ${idx})`;
      if (it.item_name) {
        title = `[${it.item_name}] ${title}`;
      }
      const sub = new Date((it.ts || 0) * 1000).toLocaleString();
      const row = el(
        "div",
        {
          class: "pim-load-item" + (idx === 0 ? " active" : ""),
          onclick: () => {
            selectedIndex = idx;
            for (const item of itemsCol.querySelectorAll(".pim-load-item")) {
              item.classList.remove("active");
            }
            row.classList.add("active");
            renderPreview(idx);
          },
        },
        el("div", { class: "pim-load-item-title" }, title),
        el("div", { class: "pim-load-item-sub" }, sub)
      );
      itemsCol.appendChild(row);
    });

    renderPreview(0);
  }

  async function init() {
    groupsCol.innerHTML = "";
    itemsCol.innerHTML = "";
    previewCol.innerHTML = "";

    groupsCol.appendChild(el("div", { class: "pim-load-empty" }, "加载分组中..."));

    let data;
    try {
      data = await jget(API_GROUPS);
    } catch (e) {
      groupsCol.innerHTML = "";
      groupsCol.appendChild(
        el("div", { class: "pim-load-empty" }, `加载失败：${e.message || e.toString()}`)
      );
      return;
    }

    const groups = data.groups || [];
    groupsCol.innerHTML = "";
    if (!groups.length) {
      groupsCol.appendChild(el("div", { class: "pim-load-empty" }, "暂无分组。先用保存节点生成一些记录。"));
      previewCol.appendChild(el("div", { class: "pim-load-empty" }, "暂无可预览的数据。"));
      return;
    }

    let firstBtn = null;
    groups.forEach((gName) => {
      const btn = el(
        "button",
        {
          class: "pim-load-group-btn" + (gName === currentGroup ? " active" : ""),
          onclick: async () => {
            for (const b of groupsCol.querySelectorAll(".pim-load-group-btn")) {
              b.classList.remove("active");
            }
            btn.classList.add("active");
            await loadGroup(gName);
          },
        },
        gName
      );
      if (!firstBtn) firstBtn = btn;
      groupsCol.appendChild(btn);
    });

    // 默认选中当前节点 group_name 对应的组，否则选第一个
    const currentGroupWidget = findWidget(node, "group_name");
    const prefer = currentGroupWidget?.value || null;
    const toSelect = prefer && groups.includes(prefer) ? prefer : groups[0];
    const targetBtn = Array.from(groupsCol.querySelectorAll(".pim-load-group-btn")).find(
      (b) => b.textContent === toSelect
    );
    if (targetBtn) {
      targetBtn.click();
    } else if (firstBtn) {
      firstBtn.click();
    }
  }

  init();
}

app.registerExtension({
  name: "prompt_image_manager.load_browser",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "PromptImageGroupLoadItem") return;

    // 挂载 onExecuted 钩子：工作流执行完后显示图片和提示词
    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      onExecuted?.apply(this, arguments);

      // 通过 applyPreviewToNode 直接显示图片和文本
      const imgs = output?.images;
      const texts = output?.text;
      const itemName = output?.item_name?.[0] || ""; // 需要后端支持，如果后端没返回item_name则为空
      if (imgs && imgs.length > 0) {
        applyPreviewToNode(this, imgs[0], texts?.[0] ?? null, itemName);
      } else if (texts && texts.length > 0) {
        applyPreviewToNode(this, null, texts[0], itemName);
      }
    };

    const orig = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = orig?.apply(this, arguments);

      // 预创建 item_name 显示区域
      const nameEl = document.createElement("div");
      nameEl.style.cssText =
        "font: 11px/1.5 ui-sans-serif, system-ui, sans-serif; " +
        "color: #aae; font-weight: bold; padding: 2px 6px; " +
        "background: rgba(0,0,0,0.2); border-radius: 4px; " +
        "margin-bottom: 2px; text-align: center; " +
        "white-space: nowrap; overflow: hidden; text-overflow: ellipsis;";
      nameEl.textContent = "";
      nameEl.style.display = "none";
      this._pimNameEl = nameEl;
      const itemNameWidget = this.addDOMWidget("item_name_display", "customtext", nameEl, {
        serialize: false,
        hideOnZoom: false,
      });

      // 预创建提示词文本显示区域
      const textEl = document.createElement("div");
      textEl.style.cssText =
        "overflow:auto; white-space:pre-wrap; word-break:break-word;" +
        "font: 11px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;" +
        "color:#ddd; background:rgba(0,0,0,0.35); border:1px solid rgba(255,255,255,0.12);" +
        "border-radius:6px; padding:6px; min-height:40px; max-height:150px;";
      textEl.textContent = "（点击 Browse 选择提示词）";
      this._pimTextEl = textEl;
      const promptWidget = this.addDOMWidget("prompt_preview", "customtext", textEl, {
        serialize: false,
        hideOnZoom: false,
      });

      // 调整顺序：将 item_name_display 和 prompt_preview 放到最前面原生控件 （比如 item_index）下面。
      // ComfyUI默认将addDOMWidget放至widgets数组最后。如果要在item_index下，可以把它们移至 item_index 的后面。
      const idxIndex = this.widgets?.findIndex(w => w.name === "item_index") ?? -1;
      if (idxIndex >= 0 && this.widgets) {
        // 先移除新添加的两个
        this.widgets = this.widgets.filter(w => w.name !== "item_name_display" && w.name !== "prompt_preview");
        // 然后插入到 item_index 后面
        this.widgets.splice(idxIndex + 1, 0, itemNameWidget, promptWidget);
      }

      // 动态将 group_name 转换为 combo 类型，以便在节点上原生显示左右小箭头
      const gWidget = this.widgets?.find((w) => w.name === "group_name");
      if (gWidget) {
        gWidget.type = "combo";
        gWidget.options = gWidget.options || {};
        gWidget.options.values = [gWidget.value];
        // 异步拉取已有组别填充
        jget(API_GROUPS).then(data => {
          const groups = data.groups || [];
          if (!groups.includes(gWidget.value)) groups.unshift(gWidget.value);
          gWidget.options.values = groups;
        }).catch(err => console.error("PIM load groups error:", err));
      }

      this.addWidget("button", "CopyPrompt", "复制提示词", () => {
        const text = this._pimTextEl?.textContent;
        if (!text) return;
        const trimmed = text.trim();
        if (trimmed === "" || trimmed === "（点击 Browse 选择提示词）" || trimmed === "(空分组)" || trimmed === "(空提示词)") return;

        navigator.clipboard.writeText(text).then(() => {
          const btn = this.widgets?.find(w => w.name === "CopyPrompt");
          if (btn) {
            btn.label = "已复制！";
            this.setDirtyCanvas(true, true);
            setTimeout(() => {
              btn.label = "复制提示词";
              this.setDirtyCanvas(true, true);
            }, 1000);
          }
        }).catch(err => console.error("复制失败:", err));
      });

      this.addWidget("button", "Browse", "浏览提示词与图片", () => {
        openBrowser(this);
      });

      // 监听 group_name 或 item_index 改变，自动刷新预览
      let refreshTimer = null;
      const refreshPreview = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => {
          const gW = this.widgets?.find((w) => w.name === "group_name");
          const iW = this.widgets?.find((w) => w.name === "item_index");
          const group = gW?.value || "default";
          const idxValue = parseInt(iW?.value || 0, 10);

          try {
            const data = await jget(API_GROUP(group));
            const items = data.items || [];
            if (items.length === 0) {
              applyPreviewToNode(this, null, "(空分组)");
              return;
            }
            // 利用取模运算实现首尾循环，比如 -1 会变成 length - 1，length 会变成 0
            let idx = idxValue;
            if (idx >= items.length) {
              idx = idx % items.length;
            } else if (idx < 0) {
              idx = (idx % items.length + items.length) % items.length;
            }

            // 如果计算后的索引跟原始值不同，回写以保证前端显示循环后的值
            if (idx !== idxValue && iW) {
              iW.value = idx;
            }

            const it = items[idx];
            if (it) {
              applyPreviewToNode(this, it.image || null, it.prompt_clean || "", it.item_name || "");
            }
          } catch (e) {
            console.error("PIM load_browser refresh error:", e);
          }
        }, 300);
      };

      const theNode = this;
      // 延迟挂载 callback 拦截，确保 widget 已初始化完毕
      setTimeout(() => {
        const triggers = ["group_name", "item_index"];
        for (const w of theNode.widgets || []) {
          if (triggers.includes(w.name)) {
            const orig = w.callback;
            w.callback = function () {
              const r = orig ? orig.apply(this, arguments) : undefined;
              // 如果是切换组名，则自动将序号重置为 0
              if (w.name === "group_name") {
                const idW = theNode.widgets?.find(x => x.name === "item_index");
                if (idW && idW.value !== 0) {
                  idW.value = 0;
                }
              }
              refreshPreview();
              return r;
            };
          }
        }
      }, 100);

      return r;
    };
  },
});

