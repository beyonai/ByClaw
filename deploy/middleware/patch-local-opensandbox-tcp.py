#!/usr/bin/env python3
"""Apply ByClaw's tenant TCP, container naming, and stopped-delete fixes to OpenSandbox v0.1.9.

Run while building the local OpenSandbox server image. Only the tenant database
port is published; ordinary sandbox networking remains unchanged.
"""

from pathlib import Path


def patch(source: str) -> str:
    if "byclawTcpPort" not in source:
        create_marker = '''                    host_config_kwargs["port_bindings"] = port_bindings
                    exposed_ports = list(port_bindings.keys())'''
        create_replacement = '''                    tcp_port = (request.metadata or {}).get("byclawTcpPort")
                    if tcp_port:
                        if tcp_port != "5432":
                            raise ValueError("Only tenant OpenGauss port 5432 may be published")
                        tenant_id = (request.metadata or {}).get("enterpriseId", "")
                        if not tenant_id.isdecimal():
                            raise ValueError("A numeric enterpriseId is required for tenant OpenGauss")
                        labels["byclaw.tenant.id"] = tenant_id
                        host_tcp_port = self._allocate_host_port()
                        while host_tcp_port in (host_execd_port, host_http_port):
                            host_tcp_port = self._allocate_host_port()
                        if host_tcp_port is None:
                            raise ValueError("No free host port for tenant OpenGauss")
                        port_bindings[tcp_port] = ("0.0.0.0", host_tcp_port)
                        labels["byclaw.tcp.5432"] = str(host_tcp_port)
                    host_config_kwargs["port_bindings"] = port_bindings
                    exposed_ports = list(port_bindings.keys())'''
        endpoint_marker = '''        if port == 8080:
            if http_host_port is None:'''
        endpoint_replacement = '''        tcp_label = f"byclaw.tcp.{port}"
        if tcp_label in labels:
            tcp_host_port = self._parse_host_port_label(labels[tcp_label], tcp_label)
            if tcp_host_port is not None:
                return Endpoint(endpoint=f"{public_host}:{tcp_host_port}")

        if port == 8080:
            if http_host_port is None:'''
        if source.count(create_marker) != 1 or source.count(endpoint_marker) != 1:
            raise RuntimeError("Unsupported OpenSandbox server version; TCP patch was not applied")
        source = source.replace(create_marker, create_replacement).replace(endpoint_marker, endpoint_replacement)

    if '"byclaw.tenant.id"' not in source:
        tenant_marker = '                        labels["byclaw.tcp.5432"] = str(host_tcp_port)'
        if source.count(tenant_marker) != 1:
            raise RuntimeError("Unsupported OpenSandbox server version; tenant label was not applied")
        source = source.replace(tenant_marker,
            tenant_marker + '\n                        labels["byclaw.tenant.id"] = (request.metadata or {})["enterpriseId"]')

    name_marker = '                    "name": f"sandbox-{sandbox_id}",'
    if 'tenant-db-{tenant_id}-{sandbox_id.replace' not in source:
        name_replacement = '''                    "name": (f"tenant-db-{tenant_id}-{sandbox_id.replace('-', '')}"
                             if (tenant_id := labels.get("byclaw.tenant.id")) else f"sandbox-{sandbox_id}"),'''
        previous_name = '''                    "name": (f"tenant-opengauss-{tenant_id}-{sandbox_id}"
                             if (tenant_id := labels.get("byclaw.tenant.id")) else f"sandbox-{sandbox_id}"),'''
        if source.count(name_marker) == 1:
            source = source.replace(name_marker, name_replacement)
        elif source.count(previous_name) == 1:
            source = source.replace(previous_name, name_replacement)
        else:
            raise RuntimeError("Unsupported OpenSandbox server version; tenant container name was not applied")

    delete_marker = '''                with self._docker_operation("kill sandbox container", sandbox_id):
                    container.kill()'''
    delete_replacement = '''                if container.attrs.get("State", {}).get("Running", False):
                    with self._docker_operation("kill sandbox container", sandbox_id):
                        container.kill()'''
    if delete_replacement not in source:
        if source.count(delete_marker) != 1:
            raise RuntimeError("Unsupported OpenSandbox server version; stopped-container delete patch was not applied")
        source = source.replace(delete_marker, delete_replacement)
    return source


if __name__ == "__main__":
    target = Path("/app/src/services/docker.py")
    original = target.read_text()
    updated = patch(original)
    if updated != original:
        target.write_text(updated)
    print("Local OpenSandbox tenant TCP support ready")
