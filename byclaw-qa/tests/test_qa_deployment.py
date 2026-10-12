"""Verify deployment still exposes QA Manager after retiring the standalone worker."""

import os
from pathlib import Path
import shutil
import subprocess

import yaml


ROOT = Path(__file__).resolve().parents[2]


def test_compose_keeps_manager_api_without_worker():
    compose = yaml.safe_load((ROOT / "deploy/standalone/docker-compose.yml").read_text())
    services = compose["services"]
    assert services["qa-manager"]["command"] == "api"
    assert services["qa-manager"]["ports"]
    assert "qa-worker" not in services
    windows = yaml.safe_load((ROOT / "deploy/standalone/docker-compose.windows.yml").read_text())
    assert "qa-manager" in windows["services"]
    assert "qa-worker" not in windows["services"]


def test_k3s_renders_manager_service_and_runtime_config_without_worker(tmp_path):
    config = tmp_path / "config"
    config.mkdir()
    for name in ("application.properties", "logback.xml"):
        shutil.copy2(ROOT / "deploy/config" / name, config / name)
    # Rendering embeds the generated Nginx config; no real environment or certificates are needed here.
    (config / "nginx-standalone.conf").write_text("server { listen 8080; }\n")
    output = tmp_path / "generated"
    subprocess.run(
        ["bash", str(ROOT / "deploy/k3s/render-manifests.sh"),
         str(ROOT / "deploy/k3s/env.k3s.example"), str(output)],
        env={"PATH": os.environ["PATH"], "BYCLAW_DEPLOY_CONFIG_DIR": str(config)},
        check=True, capture_output=True, text=True,
    )
    resources = list(yaml.safe_load_all((output / "40-service/byclaw-qa.yaml").read_text()))
    deployments = [item for item in resources if item["kind"] == "Deployment"]
    assert len(deployments) == 1
    manager = deployments[0]
    assert manager["metadata"]["name"] == "byclaw-qa-manager"
    container = manager["spec"]["template"]["spec"]["containers"][0]
    assert container["args"] == ["api"]
    service = next(item for item in resources if item["kind"] == "Service")
    assert service["spec"]["selector"] == manager["spec"]["selector"]["matchLabels"]
    assert (output / "40-service/.byclaw-qa-runtime.env").exists()
    assert not (output / "40-service/.byclaw-qa-worker-runtime.env").exists()
