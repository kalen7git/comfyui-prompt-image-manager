# ComfyUI Prompt Image Manager

[English](./README_EN.md) | [中文](./README.md)

This is a custom node extension for ComfyUI designed to help users organize, save, and manage prompts and generated images by **Groups**.
This plugin is perfect for debugging prompts. It allows you to save specific generation results (along with their parameters/prompts) into categories, and you can preview and load these saved histories anytime via the built-in Browser panel with a single click.

## Nodes & Usage Guide

This plugin provides two core nodes and an independent interactive panel.

### 1. Prompt Group Save (text+image)
**Function**: At the end of the image generation workflow, pairs the generated image with the final prompt and saves them into a specified **Group**.
This is an output node. It displays the generated preview image on the ComfyUI interface and supports custom filename formatting.

**Input Parameters**:
- `group_name` (String): The name of the group to save to, e.g., "portrait_styles" or "cyberpunk_test". Images and prompts within the same group are gathered together for easy browsing. Default is "default".
- `item_name` (String): (Optional) A custom short name/title for the current record. Useful for distinguishing different tweaks within the same group (e.g., "v1_base", "v2_lighting").
- `filename_pattern` (String): Used to configure the naming rule for saving files. Supports variables:
  - `{group}` - Group name
  - `{item}` - Record name (`item_name`)
  - `{date}` - Current date (YYYYMMDD)
  - `{time}` - Current time (HHMMSS)
  - `{index}` - Current index within the group
  Default is `{group}_{item}_{date}_{time}`.
- `prompt_text` (Multiline Text): The prompt text to save. You usually connect the string before CLIP Text Encode to this endpoint.
- `image` (Image): The generated image data.

**Special UI Features**:
- **`Save` Button**: The node panel includes a `Save` button. Clicking this button will "officially" save the last generated preview image and parameters of the current node into the database **without re-executing the entire workflow**. A popup notification will appear upon successful save.
- During each workflow execution, this node also generates and displays a temporary preview image. You can confirm you are satisfied with it before clicking Save.

---

### 2. Prompt Group Load Item (prompt+image)
**Function**: Loads a historically saved prompt text and its corresponding image from a specified **Group** based on an index.

**Input Parameters**:
- `group_name` (String): The name of the group to read from.
- `item_index` (Integer): Read the Nth record in that group (0 is the first record, controlled by panel linkage).

**Outputs**:
- `prompt_text` (String): The extracted historical prompt.
- `image` (Image): The extracted historical image for restoration.

**Special UI Features (Prompt Group Browser Panel)**:
- **Prompt Preview Area**: The node panel displays a text area showing the currently loaded prompt, and directly displays the loaded preview image on the node body.
- **`Browse` Button**: Clicking this opens a powerful **visual browser (Prompt Group Browser)** dialog:
  - **Left Group Panel**: Lists all group names in the current database. Click to quickly switch groups.
  - **Middle Record Panel**: Lists all historical records in the current group (shows `item_name` and accurate save time).
  - **Right Preview Panel**: Displays the high-resolution image and full prompt text of the selected record.
  - **Action Buttons**:
    - `Use this one (write to node)`: Auto-fills the selected record's `group_name` and `item_index` into the node, and **updates the preview image and text on the ComfyUI canvas node in real-time** without re-running the workflow. What you see is what you get.
    - `Copy Prompt`: One-click copy of all prompt content of the record to the system clipboard.
    - `Delete`: Permanently delete the unsatisfactory historical record (a confirmation dialog will appear before deletion to prevent accidental deletion).

## Installation
1. Enter the `custom_nodes` folder in ComfyUI:
   ```bash
   cd ComfyUI/custom_nodes
   ```
2. Place this project folder (e.g., `prompt_image_manager`) in that directory.
3. Restart the ComfyUI backend and refresh the frontend web page.
4. You can find and start using them in the **Prompt Image Manager** category when right-clicking to add a new node.

## Storage Directory
All images are saved in a dedicated subdirectory under ComfyUI's default output folder (usually `output/prompt_image_manager`). Group structure information and prompt record data are summarized and saved in an internal cache file and corresponding storage logic for fast retrieval and reading by the interface and underlying nodes.
