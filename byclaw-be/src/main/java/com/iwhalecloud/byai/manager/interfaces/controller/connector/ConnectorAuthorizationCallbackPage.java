package com.iwhalecloud.byai.manager.interfaces.controller.connector;

final class ConnectorAuthorizationCallbackPage {
    private ConnectorAuthorizationCallbackPage() {
    }

    static String render(boolean connected) {
        String stateClass = connected ? "success" : "failed";
        String symbol = connected ? "&#10003;" : "!";
        String title = connected ? "GitHub 授权成功" : "GitHub 授权未完成";
        String message = connected
            ? "ByClaw 已获得您的 GitHub 授权，此页面将自动关闭。"
            : "请返回 ByClaw 查看详细信息并重新授权。";
        return """
            <!doctype html>
            <html lang="zh-CN">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <title>%s</title>
              <style>
                * { box-sizing: border-box; }
                body { margin: 0; min-height: 100vh; display: grid; place-items: center;
                  background: #f5f7fa; color: #1f2328; font-family: -apple-system, BlinkMacSystemFont,
                  "Segoe UI", sans-serif; }
                main { width: min(440px, calc(100%% - 40px)); padding: 40px 32px; text-align: center;
                  background: #fff; border: 1px solid #d8dee4; border-radius: 14px;
                  box-shadow: 0 8px 30px rgba(31, 35, 40, .08); }
                .icon { width: 64px; height: 64px; margin: 0 auto 20px; display: grid; place-items: center;
                  border-radius: 50%%; color: #fff; font-size: 34px; font-weight: 700; }
                .success .icon { background: #1f883d; }
                .failed .icon { background: #cf222e; }
                h1 { margin: 0 0 12px; font-size: 24px; }
                p { margin: 0; color: #57606a; line-height: 1.7; }
                button { margin-top: 24px; padding: 9px 20px; border: 0; border-radius: 8px;
                  background: #24292f; color: #fff; cursor: pointer; font-size: 14px; }
              </style>
            </head>
            <body>
              <main class="%s">
                <div class="icon" aria-hidden="true">%s</div>
                <h1>%s</h1>
                <p>%s</p>
                <button type="button" onclick="window.close()">关闭页面</button>
              </main>
              <script>setTimeout(function () { window.close(); }, 1200);</script>
            </body>
            </html>
            """.formatted(title, stateClass, symbol, title, message);
    }
}
