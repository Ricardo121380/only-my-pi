# Legacy source and recovery

Current development follows the native Pi WebUI on `main`. The former CLI
mainline is preserved at `legacy/cli-before-webui-20261105`, commit
`c37f16e10d8e7dc227255917e179ab283d960135`.

`cli/workflows/` preserves eight retired CLI release workflows byte for byte.
They are outside `.github/workflows/`, so Actions cannot discover or trigger
them. Their old seed assets are no longer a current distribution input.
Historical signature verification continues to use the original workflow
identity. Restoring an old workflow requires a separate review of its runtime,
inputs and release authority; moving it back does not renew its qualification.

Runtime modules, CLI regression tests, versioned schemas and historical failure
records remain in the source repository. Shared capabilities still serve the
WebUI and must be separated before any later deletion.

`design/` preserves four unused design drafts with their original bytes:
the old `style.css` and `glacier.css`, U0 workbench HTML and integration types.
The current design extraction source remains at
[`pi-agent-glacier.html`](../docs/design/glacier/pi-agent-glacier.html), and
`scripts/sync-glacier-assets.mjs` continues to verify its CSS and icons.
Historical path/hash snapshots retain their original identity.
