"""Shared constants and path configuration for Fathom Vault."""

import os

VAULT_DIR = "/data/Dropbox/Work/vault"
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend", "dist")
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp")
PORT = 4243
