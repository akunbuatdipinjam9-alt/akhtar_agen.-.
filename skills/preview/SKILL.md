# Akhtar Universal Preview
> Open workspace files inside Akhtar Agent instead of sending the user to another app.

Use `preview.open` when the user asks to open, show, inspect, or preview a file in the current workspace, especially a file Akhtar Agent just created.

## Main flow
1. Prefer one `preview.open({path})` call.
2. Do not also call OS/computer tools just to open the same file.
3. After editing the file, call `preview.refresh` only when the preview should visibly update.
4. Use `preview.inspect` for follow-ups like “this file”, “the current preview”, or to ground what is open.
5. Use `preview.close` only when the user asks to close it or another workflow explicitly needs it gone.

## Supported previews
- PDF
- images
- text/code/JSON/Markdown/XML/YAML/logs
- HTML (sandboxed/static; scripts are not executed)
- CSV
- DOCX (readable document view)
- PPTX (slide-card view)
- XLSX (sheet/table view)
- common audio/video formats
- GLTF/GLB metadata summary

## Safety
Preview is read-only and confined to the open workspace. Never use it to bypass filesystem permissions or workspace boundaries. Sensitive credential files are intentionally blocked. HTML is rendered without script execution and must never receive Node/Electron privileges.

## Interaction rule
Universal Preview is not a permanent tab. It appears as an overlay/panel when invoked from chat and disappears when closed. Keep answers concise because the visual preview is the primary output.
