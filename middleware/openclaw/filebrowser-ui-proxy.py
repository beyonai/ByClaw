#!/usr/bin/env python3
import argparse
import cgi
import html
import http.client
import json
import mimetypes
import os
import posixpath
import shutil
import socketserver
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler


TEXT_EXTENSIONS = {
    ".css", ".csv", ".env", ".html", ".java", ".js", ".json", ".jsx", ".less",
    ".log", ".md", ".mjs", ".py", ".sh", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml",
}


def normalize_baseurl(value):
    value = (value or "/filebrowser").strip()
    if not value.startswith("/"):
        value = "/" + value
    return value.rstrip("/") or "/filebrowser"


def normalize_user_path(value):
    value = urllib.parse.unquote(value or "/")
    value = value.replace("\\", "/")
    if not value.startswith("/"):
        value = "/" + value
    return posixpath.normpath(value) or "/"


def config_path_to_virtual_path(value, root):
    wildcard = value.endswith("*")
    base = value[:-1] if wildcard else value
    base = base.strip().replace("\\", "/")
    if not base.startswith("/"):
        base = "/" + base
    normalized = posixpath.normpath(base)
    root_path = posixpath.normpath(os.path.realpath(root).replace("\\", "/"))
    if normalized == root_path:
        virtual = "/"
    elif normalized.startswith(root_path.rstrip("/") + "/"):
        virtual = normalized[len(root_path.rstrip("/")):] or "/"
    else:
        virtual = normalized
    return virtual + "*" if wildcard else virtual


def split_allowed_roots(value, root):
    roots = []
    for item in (value or "").split(","):
        item = item.strip()
        if not item:
            continue
        roots.append(config_path_to_virtual_path(item, root))
    return roots or ["/"]


def default_from_allowed_roots(allowed_roots):
    first = allowed_roots[0]
    if first.endswith("*"):
        return posixpath.normpath(first[:-1].rstrip("/")) or "/"
    return first


def path_matches_allowed_roots(normalized, allowed_roots):
    for pattern in allowed_roots:
        if pattern.endswith("*"):
            prefix = pattern[:-1]
            if normalized.startswith(prefix):
                return True
            continue
        if normalized == pattern or normalized.startswith(pattern.rstrip("/") + "/"):
            return True
    return False


def json_bytes(payload):
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def is_text_file(path):
    ext = os.path.splitext(path)[1].lower()
    return ext in TEXT_EXTENSIONS


class ThreadingHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


class FileBrowserUIHandler(BaseHTTPRequestHandler):
    server_version = "OpenClawFileBrowserUI/1.0"

    def log_message(self, fmt, *args):
        sys.stderr.write("[filebrowser-ui] " + fmt % args + "\n")

    @property
    def root(self):
        return self.server.root

    @property
    def baseurl(self):
        return self.server.baseurl

    @property
    def ui_dir(self):
        return self.server.ui_dir

    @property
    def upstream(self):
        return self.server.upstream

    @property
    def default_path(self):
        return self.server.default_path

    @property
    def allowed_roots(self):
        return self.server.allowed_roots

    def do_GET(self):
        self.route()

    def do_POST(self):
        self.route()

    def do_DELETE(self):
        self.route()

    def do_PUT(self):
        self.route()

    def do_PATCH(self):
        self.route()

    def route(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        if path == self.baseurl:
            self.redirect(self.baseurl + "/")
            return
        if path == self.baseurl + "/openclaw-env.js" or path.endswith("/openclaw-env.js"):
            self.handle_env()
            return
        if path.startswith(self.baseurl + "/openclaw-api/"):
            self.handle_api(path[len(self.baseurl + "/openclaw-api"):], parsed.query)
            return
        if path.startswith(self.baseurl + "/api/"):
            self.proxy_to_upstream()
            return
        if path.startswith(self.baseurl + "/static/"):
            self.proxy_to_upstream()
            return
        if path.startswith(self.baseurl + "/assets/"):
            self.proxy_to_upstream()
            return
        self.serve_ui()

    def redirect(self, location):
        self.send_response(302)
        self.send_header("Location", location)
        self.end_headers()

    def send_bytes(self, status, body, content_type="application/octet-stream", headers=None):
        try:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            self.log_message("client disconnected before response was sent: status=%s path=%s", status, self.path)

    def send_json(self, status, payload):
        self.send_bytes(status, json_bytes(payload), "application/json; charset=utf-8")

    def send_error_json(self, status, message):
        self.send_json(status, {"error": message})

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def path_from_query(self, query):
        params = urllib.parse.parse_qs(query, keep_blank_values=True)
        return params.get("path", ["/"])[0]

    def is_allowed_path(self, normalized):
        return path_matches_allowed_roots(normalized, self.allowed_roots)

    def is_protected_workspace_root(self, normalized):
        for pattern in self.allowed_roots:
            if pattern.endswith("*"):
                prefix = pattern[:-1].rstrip("/")
                if normalized.startswith(prefix) and "/" not in normalized[len(prefix):].strip("/"):
                    return True
                continue
            if normalized == pattern:
                return True
        return False

    def safe_path(self, user_path):
        normalized = normalize_user_path(user_path)
        if normalized == "/":
            normalized = self.default_path
        if not self.is_allowed_path(normalized):
            raise PermissionError("path is outside workspace")
        target = os.path.join(self.root, normalized.lstrip("/"))
        target = os.path.realpath(target)
        root = os.path.realpath(self.root)
        if target != root and not target.startswith(root + os.sep):
            raise PermissionError("path escapes file root")
        return normalized, target

    def rel_path(self, target):
        root = os.path.realpath(self.root)
        target = os.path.realpath(target)
        rel = os.path.relpath(target, root)
        if rel == ".":
            return "/"
        return "/" + rel.replace(os.sep, "/")

    def file_payload(self, target):
        stat = os.stat(target)
        name = os.path.basename(target) or "/"
        is_dir = os.path.isdir(target)
        content_type = "directory" if is_dir else (mimetypes.guess_type(target)[0] or "application/octet-stream")
        return {
            "name": name,
            "path": self.rel_path(target),
            "isDir": is_dir,
            "size": stat.st_size,
            "modified": int(stat.st_mtime * 1000),
            "type": content_type,
            "text": (not is_dir) and is_text_file(target),
        }

    def handle_env(self):
        lang = os.environ.get("OPENCLAW_FILEBROWSER_LANG") or os.environ.get("LANG") or ""
        theme = os.environ.get("OPENCLAW_FILEBROWSER_THEME") or "system"
        payload = {
            "baseUrl": self.baseurl,
            "lang": lang,
            "theme": theme,
            "root": self.root,
            "defaultPath": self.default_path,
            "allowedRoots": self.allowed_roots,
        }
        js = "window.OPENCLAW_FILEBROWSER_ENV = " + json.dumps(payload, ensure_ascii=False) + ";\n"
        self.send_bytes(200, js.encode("utf-8"), "application/javascript; charset=utf-8")

    def handle_api(self, api_path, query):
        try:
            if api_path == "/list" and self.command == "GET":
                self.api_list(query)
            elif api_path == "/raw" and self.command == "GET":
                self.api_raw(query, download=False)
            elif api_path == "/download" and self.command == "GET":
                self.api_raw(query, download=True)
            elif api_path == "/mkdir" and self.command == "POST":
                self.api_mkdir()
            elif api_path == "/rename" and self.command == "POST":
                self.api_rename()
            elif api_path == "/delete" and self.command == "DELETE":
                self.api_delete(query)
            elif api_path == "/upload" and self.command == "POST":
                self.api_upload()
            else:
                self.send_error_json(404, "unknown API endpoint")
        except FileExistsError:
            self.send_error_json(409, "target already exists")
        except FileNotFoundError:
            self.send_error_json(404, "file not found")
        except PermissionError as exc:
            self.send_error_json(403, str(exc))
        except ValueError as exc:
            self.send_error_json(400, str(exc))
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            self.log_message("client disconnected during API response: %s", api_path)
        except Exception as exc:
            self.log_message("API error: %s", exc)
            self.send_error_json(500, str(exc))

    def api_list(self, query):
        clean, target = self.safe_path(self.path_from_query(query))
        if not os.path.exists(target):
            raise FileNotFoundError(clean)
        if os.path.isfile(target):
            self.send_json(200, {
                "path": clean,
                "items": [self.file_payload(target)],
                "defaultPath": self.default_path,
                "allowedRoots": self.allowed_roots,
            })
            return
        items = []
        for name in os.listdir(target):
            if name in {".", ".."}:
                continue
            child = os.path.join(target, name)
            try:
                items.append(self.file_payload(child))
            except OSError:
                continue
        self.send_json(200, {
            "path": clean,
            "items": items,
            "defaultPath": self.default_path,
            "allowedRoots": self.allowed_roots,
        })

    def api_raw(self, query, download):
        clean, target = self.safe_path(self.path_from_query(query))
        if not os.path.isfile(target):
            raise FileNotFoundError(clean)
        content_type = mimetypes.guess_type(target)[0] or "application/octet-stream"
        name = os.path.basename(target)
        disposition = "attachment" if download else "inline"
        disposition += "; filename*=UTF-8''" + urllib.parse.quote(name)
        with open(target, "rb") as handle:
            body = handle.read()
        self.send_bytes(200, body, content_type, {"Content-Disposition": disposition})

    def api_mkdir(self):
        payload = self.read_json()
        parent = payload.get("path") or "/"
        name = (payload.get("name") or "").strip()
        if not name or "/" in name or "\\" in name:
            raise ValueError("invalid folder name")
        _, parent_target = self.safe_path(parent)
        target = os.path.join(parent_target, name)
        _, target = self.safe_path(self.rel_path(target))
        os.makedirs(target, exist_ok=False)
        self.send_json(200, {"ok": True, "item": self.file_payload(target)})

    def api_rename(self):
        payload = self.read_json()
        old_path = payload.get("path") or ""
        new_name = (payload.get("newName") or "").strip()
        if not old_path:
            raise ValueError("path is required")
        if not new_name or "/" in new_name or "\\" in new_name:
            raise ValueError("invalid new name")
        old_clean, old_target = self.safe_path(old_path)
        if self.is_protected_workspace_root(old_clean):
            raise PermissionError("cannot rename workspace root")
        parent = os.path.dirname(old_target)
        new_target = os.path.join(parent, new_name)
        _, new_target = self.safe_path(self.rel_path(new_target))
        if os.path.exists(new_target):
            raise FileExistsError(new_name)
        os.rename(old_target, new_target)
        self.send_json(200, {"ok": True, "item": self.file_payload(new_target)})

    def api_delete(self, query):
        clean, target = self.safe_path(self.path_from_query(query))
        if self.is_protected_workspace_root(clean):
            raise PermissionError("cannot delete workspace root")
        if os.path.isdir(target):
            shutil.rmtree(target)
        else:
            os.remove(target)
        self.send_json(200, {"ok": True})

    def api_upload(self):
        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            raise ValueError("multipart/form-data is required")
        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
            },
        )
        path_value = form.getfirst("path") or "/"
        _, target_dir = self.safe_path(path_value)
        os.makedirs(target_dir, exist_ok=True)
        fields = form["files"] if "files" in form else []
        if not isinstance(fields, list):
            fields = [fields]
        saved = []
        for field in fields:
            if not getattr(field, "filename", None):
                continue
            filename = os.path.basename(field.filename)
            if not filename:
                continue
            target = os.path.join(target_dir, filename)
            _, target = self.safe_path(self.rel_path(target))
            with open(target, "wb") as handle:
                shutil.copyfileobj(field.file, handle)
            saved.append(self.file_payload(target))
        self.send_json(200, {"ok": True, "items": saved})

    def serve_ui(self):
        index_path = os.path.join(self.ui_dir, "index.html")
        with open(index_path, "rb") as handle:
            self.send_bytes(200, handle.read(), "text/html; charset=utf-8")

    def proxy_to_upstream(self):
        parsed = urllib.parse.urlsplit(self.path)
        upstream = urllib.parse.urlsplit(self.upstream)
        conn_cls = http.client.HTTPSConnection if upstream.scheme == "https" else http.client.HTTPConnection
        port = upstream.port or (443 if upstream.scheme == "https" else 80)
        conn = conn_cls(upstream.hostname, port, timeout=120)
        body = None
        length = self.headers.get("Content-Length")
        if length:
            body = self.rfile.read(int(length))
        target = parsed.path
        if parsed.query:
            target += "?" + parsed.query
        headers = {
            key: value for key, value in self.headers.items()
            if key.lower() not in {"host", "content-length", "connection", "accept-encoding"}
        }
        headers["Host"] = upstream.netloc
        try:
            conn.request(self.command, target, body=body, headers=headers)
            response = conn.getresponse()
            response_body = response.read()
            self.send_response(response.status)
            for key, value in response.getheaders():
                if key.lower() in {"connection", "transfer-encoding", "content-length", "content-encoding"}:
                    continue
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(response_body)
        finally:
            conn.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--address", default="0.0.0.0")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--baseurl", default="/filebrowser")
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--ui-dir", required=True)
    parser.add_argument("--default-path", default="")
    parser.add_argument("--allowed-roots", default="")
    args = parser.parse_args()

    handler = FileBrowserUIHandler
    server = ThreadingHTTPServer((args.address, args.port), handler)
    server.root = os.path.realpath(args.root)
    server.baseurl = normalize_baseurl(args.baseurl)
    server.upstream = args.upstream.rstrip("/")
    server.ui_dir = args.ui_dir
    state_dir = os.environ.get("OPENCLAW_STATE_DIR") or server.root
    allowed_roots = args.allowed_roots or os.environ.get("FILEBROWSER_ALLOWED_ROOTS") or state_dir
    default_path = args.default_path or os.environ.get("FILEBROWSER_DEFAULT_PATH") or state_dir
    server.allowed_roots = split_allowed_roots(allowed_roots, server.root)
    server.default_path = normalize_user_path(config_path_to_virtual_path(default_path, server.root))
    if not path_matches_allowed_roots(server.default_path, server.allowed_roots):
        server.default_path = default_from_allowed_roots(server.allowed_roots)

    os.makedirs(server.root, exist_ok=True)
    print(
        f"[filebrowser-ui] serving {server.baseurl} on {args.address}:{args.port}, "
        f"root={server.root}, default_path={server.default_path}, "
        f"allowed_roots={','.join(server.allowed_roots)}, upstream={server.upstream}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
