{{RESOLVER_BLOCK}}

server {
    listen       8080;
    server_name  localhost;

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
        alias   /usr/share/nginx/html;
        index  index.html index.htm;
        try_files $uri $uri/ /index.html;
        absolute_redirect off;
    }

    location /byaiService {
        proxy_pass {{PROXY_HTTP}}/byaiService;

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
        proxy_set_header Connection "upgrade";
    }

    location /byaiService/ws {
        proxy_pass {{PROXY_WS}}/byaiService/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade websocket;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # 支持sse流式输出配置
        chunked_transfer_encoding off;
        proxy_buffering off;
        gzip off;
    }

    error_page 500 502 503 504 /50x.html;
    location = /50x.html {
        root /usr/share/nginx/html;
    }
}
