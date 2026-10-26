package com.iwhalecloud.byai.common.integration.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.*;
import java.util.UUID;

/** Runs before browser filters and only attaches identity after complete authentication. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class InternalServiceAuthenticationFilter extends OncePerRequestFilter {
    private final InternalServiceAuthenticator authenticator;
    // Internal errors must retain numeric RFC 9457 status independently from portal serializers.
    private final ObjectMapper mapper = org.springframework.http.converter.json.Jackson2ObjectMapperBuilder.json()
        .mixIn(ProblemDetail.class, org.springframework.http.converter.json.ProblemDetailJacksonMixin.class).build();
    public InternalServiceAuthenticationFilter(InternalServiceAuthenticator authenticator, ObjectMapper ignoredPortalMapper) {
        this.authenticator = authenticator;
    }
    @Override protected boolean shouldNotFilter(HttpServletRequest request) {
        return !InternalServiceRoutes.matches(request.getMethod(), request.getRequestURI().substring(request.getContextPath().length()));
    }
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws IOException, ServletException {
        // Service requests never inherit a browser principal from a reused worker thread.
        com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.clearLoginInfo();
        try {
            // Bound unsigned input before authentication to avoid unbounded body buffering.
            byte[] body = request.getInputStream().readNBytes(1024 * 1024 + 1);
            if (body.length > 1024 * 1024) throw new InternalServiceSecurityException(413, "SERVICE_BODY_TOO_LARGE");
            var principal = authenticator.authenticate(request, body);
            request.setAttribute(InternalServicePrincipal.ATTRIBUTE, principal);
            chain.doFilter(new HttpServletRequestWrapper(request) {
                @Override public ServletInputStream getInputStream() {
                    var input = new ByteArrayInputStream(body);
                    return new ServletInputStream() {
                        public int read() { return input.read(); }
                        public boolean isFinished() { return input.available() == 0; }
                        public boolean isReady() { return true; }
                        public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
                    };
                }
                @Override public BufferedReader getReader() {
                    return new BufferedReader(new InputStreamReader(getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
                }
            }, response);
        } catch (InternalServiceSecurityException exception) {
            response.setStatus(exception.status());
            response.setContentType("application/problem+json");
            ProblemDetail problem = ProblemDetail.forStatus(exception.status());
            problem.setTitle("Service authorization failed");
            problem.setProperty("errorCode", exception.getMessage());
            problem.setProperty("traceId", UUID.randomUUID().toString());
            mapper.writeValue(response.getOutputStream(), problem);
        } finally {
            request.removeAttribute(InternalServicePrincipal.ATTRIBUTE);
            com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.clearLoginInfo();
        }
    }
}
