    # Anonymous previews; callers cannot choose an upstream host or port.
    location ~ "^/sandbox-apps/(?<app_sandbox>sbx-[a-z0-9-]{8,100})(?<app_path>/a/[0-9a-f]{32}/.*)$" {
        resolver {{APP_PREVIEW_DNS}} valid=10s;
        set $app_upstream {{APP_PREVIEW_PORT}}-${app_sandbox}.{{APP_PREVIEW_DOMAIN}};
        proxy_pass https://$app_upstream$app_path$is_args$args;
        proxy_http_version 1.1;
        proxy_ssl_server_name on;
        proxy_ssl_name $app_upstream;
        proxy_ssl_verify on;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
        proxy_set_header Host $app_upstream;
        proxy_set_header Cookie "";
        proxy_set_header Authorization "";
        proxy_set_header Beyond-Token "";
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_hide_header Content-Disposition;
        proxy_hide_header Set-Cookie;
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_redirect ~^/a/(.*)$ /sandbox-apps/$app_sandbox/a/$1;
    }

    location /sandbox-apps/ { return 404; }
