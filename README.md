# Fathom Vault

A local markdown vault viewer, editor, and MCP server. Browse and edit your vault in a browser. Let AI agents read and write files via MCP tools.

## Install

```bash
git clone https://github.com/myrakrusemark/fathom-vault.git
cd fathom-vault
pip install -r requirements.txt
cd mcp && npm install && cd ..
```

## Configure your vault path

Edit `config.py` to point at your vault directory:

```python
VAULT_DIR = "/path/to/your/vault"
PORT = 4243
```

Also update the path at the top of `mcp/index.js`:

```js
const VAULT_PATH = "/path/to/your/vault";
```

Both must point to the same directory. If you want to get started quickly, point both at the included `vault/` directory — it contains the full documentation for Fathom Vault itself.

## Run

```bash
python app.py
```

Open `http://localhost:4243`.

## MCP server

Register in your MCP config to give AI agents direct vault access:

```json
{
  "fathom-vault": {
    "type": "stdio",
    "command": "node",
    "args": ["/path/to/fathom-vault/mcp/index.js"]
  }
}
```

Available tools: `fathom_vault_read`, `fathom_vault_write`, `fathom_vault_append`, `fathom_vault_list`, `fathom_vault_folder`, `fathom_vault_image`, `fathom_vault_write_asset`.

Every MCP read and write records the file in an activity tracker. The browser UI surfaces recently active files with heat indicators (🔥/🌡) and an Active Files panel.

## Build the frontend

```bash
cd frontend && npm install && npm run build
```

## Test

```bash
pytest
```

## Documentation

Full documentation lives in `vault/documentation/fathom-vault/`:

- `index.md` — overview and architecture
- `mcp-tools.md` — all MCP tools, parameters, and return shapes
- `activity-tracking.md` — heat scoring, Active Files panel, settings
- `running.md` — install, configure, and keep the server running

## License

MIT
