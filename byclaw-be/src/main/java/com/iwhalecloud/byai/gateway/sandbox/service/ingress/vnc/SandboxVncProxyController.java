package com.iwhalecloud.byai.gateway.sandbox.service.ingress.vnc;

import java.io.IOException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import okhttp3.Request;

/** Serves only versioned platform-owned viewer resources. Guest HTML/JS is never fetched. */
@RestController
public class SandboxVncProxyController {
    private final SandboxVncTargetResolver resolver;
    public SandboxVncProxyController(SandboxVncTargetResolver resolver) { this.resolver = resolver; }

    static Request request(SandboxVncTargetResolver.Target target) {
        Request.Builder request = new Request.Builder().url(target.url());
        target.headers().forEach(request::header);
        return request.build();
    }

    @GetMapping("/sandbox/vnc/**")
    public void forward(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        resolver.resolve(path, null); // Authorize every document and asset against the exact owned sandbox.
        String[] parts = path.substring(SandboxVncTargetResolver.PREFIX.length()).split("/", 3);
        String resource = parts.length == 3 ? parts[2] : "";
        if (resource.isEmpty()) resource = "index.html";
        if (!(resource.equals("index.html") || resource.equals("viewer.js") || resource.equals("viewer.css")
            || ((resource.startsWith("core/") || resource.startsWith("vendor/")) && resource.endsWith(".js")))) {
            response.sendError(404); return;
        }
        var asset = new ClassPathResource("sandbox-vnc/" + resource);
        if (!asset.exists() || !asset.isReadable()) { response.sendError(404); return; }
        response.setContentType(resource.endsWith(".js") ? "text/javascript;charset=UTF-8"
            : resource.endsWith(".css") ? "text/css;charset=UTF-8" : "text/html;charset=UTF-8");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'");
        try (var input = asset.getInputStream()) { input.transferTo(response.getOutputStream()); }
    }
}
