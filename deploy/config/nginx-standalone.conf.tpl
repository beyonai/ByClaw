{{RESOLVER_BLOCK}}

{{UPSTREAM_BLOCK}}

map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen       8080;
    listen       8443 ssl;
    http2 on;
    server_name  localhost 127.0.0.1;

    ssl_certificate {{SSL_CERT_PATH}};
    ssl_certificate_key {{SSL_KEY_PATH}};
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    large_client_header_buffers 4 16k;
    client_max_body_size 300m;
    proxy_connect_timeout 6000;
    proxy_read_timeout 6000;
    proxy_send_timeout 6000;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;
    gzip_min_length 1024;

    {{BACKEND_VARS}}

    location /beyond {
        alias /usr/share/nginx/html;
        index index.html index.htm;
        try_files $uri $uri/ /index.html;
        absolute_redirect off;

        if ($request_filename ~* .*\.(?:htm|html)$) {
            add_header Cache-Control "no-cache, must-revalidate, proxy-revalidate";
        }

        if ($uri ~* "\.[0-9a-f]{8}\.(async\.|chunk\.)?(js|css)$") {
            expires 1y;
            add_header Cache-Control "public, max-age=31536000, immutable";
        }

        if ($uri ~* "\.(js|css)$") {
            expires 1y;
            add_header Cache-Control "public, max-age=31536000";
        }
    }

    location /v1/sandboxes {
        proxy_pass {{PROXY_SANDBOXES}};

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }

    location /byaiService/ws {
        proxy_pass {{PROXY_WS}};
        proxy_http_version 1.1;
        proxy_set_header Upgrade websocket;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Supports SSE streaming.
        chunked_transfer_encoding off;
        proxy_buffering off;
        gzip off;
    }

    location /byaiService {
        proxy_pass {{PROXY_HTTP}};

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Cookie $http_cookie;
        proxy_cookie_path /byaiService /byaiService;
        proxy_cookie_flags ~ samesite=lax;

        # WebSocket
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }

    location /filebrowser {
        rewrite ^/filebrowser(.*)$ /byaiService/filebrowser$1 break;
        proxy_pass {{PROXY_HTTP}};

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header Cookie $http_cookie;
        proxy_cookie_path /byaiService/filebrowser /filebrowser;
        proxy_cookie_flags ~ samesite=lax;
    }

    location /websockify {
        set $novnc_url "";

        if ($http_cookie ~* "(^|;\s*)novncUrl=(https?://[^;]+)") {
            set $novnc_url $2;
        }

        if ($novnc_url = "") {
            return 400 "Missing novncUrl cookie";
        }

        proxy_pass $novnc_url/websockify;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_send_timeout 1800s;
        proxy_read_timeout 1800s;
        proxy_ssl_server_name on;
    }

    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
