package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.context.i18n.LocaleContextHolder;

final class ConnectorAuthorizationCallbackPage {
    private ConnectorAuthorizationCallbackPage() {
    }

    static String render(boolean connected) {
        String stateClass = connected ? "success" : "failed";
        String symbol = connected ? "&#10003;" : "!";
        String title = connected ? I18nUtil.get("connector.callback.successTitle") : I18nUtil.get("connector.callback.failedTitle");
        String message = connected
            ? I18nUtil.get("connector.callback.successMessage")
            : I18nUtil.get("connector.callback.failedMessage");
        return """
            <!doctype html>
            <html lang="%s">
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
                <button type="button" onclick="window.close()">%s</button>
              </main>
              <script>setTimeout(function () { window.close(); }, 1200);</script>
            </body>
            </html>
            """.formatted(LocaleContextHolder.getLocale().toLanguageTag(), title, stateClass, symbol, title, message,
                I18nUtil.get("connector.callback.close"));
    }
}
