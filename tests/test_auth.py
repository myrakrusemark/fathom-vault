"""Tests for auth.py — API key generation, validation, and middleware."""

import json
import os
import tempfile

import pytest

# Patch DATA_DIR before importing auth
_tmpdir = tempfile.mkdtemp()
os.environ.setdefault("_FATHOM_DATA_DIR_OVERRIDE", _tmpdir)

import auth  # noqa: E402


@pytest.fixture(autouse=True)
def _isolated_config(tmp_path, monkeypatch):
    """Each test gets its own server.json."""
    config_path = str(tmp_path / "server.json")
    monkeypatch.setattr(auth, "_SERVER_CONFIG_PATH", config_path)
    monkeypatch.setattr(auth, "_DATA_DIR", str(tmp_path))
    yield


class TestApiKeyGeneration:
    def test_generated_key_has_prefix(self):
        key = auth._generate_api_key()
        assert key.startswith("fv_")

    def test_generated_keys_are_unique(self):
        keys = {auth._generate_api_key() for _ in range(100)}
        assert len(keys) == 100

    def test_key_length_is_sufficient(self):
        key = auth._generate_api_key()
        # fv_ prefix (3) + 32 base64url chars = 35 minimum
        assert len(key) >= 35


class TestServerConfig:
    def test_load_creates_config_on_first_run(self, tmp_path):
        config = auth.load_server_config()
        assert "api_key" in config
        assert config["api_key"].startswith("fv_")
        assert config["auth_enabled"] is False
        # File was written
        assert os.path.exists(str(tmp_path / "server.json"))

    def test_load_preserves_existing_key(self, tmp_path):
        config_path = str(tmp_path / "server.json")
        with open(config_path, "w") as f:
            json.dump({"api_key": "fv_test123", "auth_enabled": True}, f)
        config = auth.load_server_config()
        assert config["api_key"] == "fv_test123"
        assert config["auth_enabled"] is True

    def test_regenerate_changes_key(self):
        old_key = auth.get_api_key()
        new_key = auth.regenerate_api_key()
        assert old_key != new_key
        assert new_key.startswith("fv_")
        assert auth.get_api_key() == new_key

    def test_auth_toggle(self):
        assert not auth.is_auth_enabled()
        auth.set_auth_enabled(True)
        assert auth.is_auth_enabled()
        auth.set_auth_enabled(False)
        assert not auth.is_auth_enabled()


class TestRequireApiKeyDecorator:
    def _make_app(self):
        from flask import Flask, jsonify

        test_app = Flask(__name__)

        @test_app.route("/api/test")
        @auth.require_api_key
        def protected():
            return jsonify({"ok": True})

        @test_app.route("/dashboard")
        def unprotected():
            return jsonify({"ok": True})

        return test_app

    def test_passes_when_auth_disabled(self):
        app = self._make_app()
        auth.set_auth_enabled(False)
        with app.test_client() as c:
            resp = c.get("/api/test")
            assert resp.status_code == 200

    def test_rejects_missing_header_when_auth_enabled(self):
        app = self._make_app()
        auth.set_auth_enabled(True)
        with app.test_client() as c:
            resp = c.get("/api/test")
            assert resp.status_code == 401

    def test_rejects_wrong_key(self):
        app = self._make_app()
        auth.set_auth_enabled(True)
        with app.test_client() as c:
            resp = c.get("/api/test", headers={"Authorization": "Bearer fv_wrong"})
            assert resp.status_code == 401

    def test_accepts_correct_key(self):
        app = self._make_app()
        auth.set_auth_enabled(True)
        key = auth.get_api_key()
        with app.test_client() as c:
            resp = c.get("/api/test", headers={"Authorization": f"Bearer {key}"})
            assert resp.status_code == 200

    def test_unprotected_route_always_accessible(self):
        app = self._make_app()
        auth.set_auth_enabled(True)
        with app.test_client() as c:
            resp = c.get("/dashboard")
            assert resp.status_code == 200
