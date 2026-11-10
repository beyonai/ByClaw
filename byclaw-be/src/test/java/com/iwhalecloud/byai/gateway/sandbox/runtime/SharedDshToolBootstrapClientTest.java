package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.sun.net.httpserver.HttpServer;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;

class SharedDshToolBootstrapClientTest {
    private static final String SERVICE = "byclaw-tools";
    private static final String TOKEN = "user-web-token";
    private static final String FAILURE = "Unable to obtain shared DSH tool environment bootstrap";
    private static final Map<String, String> KEYS = Map.of(
        "authorizedKey", "ssh-ed25519 YWJj bootstrap-test",
        "hostPrivateKeyBase64", Base64.getEncoder().encodeToString(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----\n"
                .getBytes(StandardCharsets.UTF_8)));
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void postsOnlyServiceToCurrentUserPathWithScopedCookieAndEndpointHeaders() throws Exception {
        ReplyHttp http = new ReplyHttp(200, validResponse());
        SandboxLaunchData context = context("https://host.example/prefix/u/account%20one/chat?token=" + TOKEN + "&unused=1");
        context.setGatewayToken(TOKEN);
        context.setEndpointHeaders(Map.of("X-Endpoint-Auth", "endpoint-header", "Cookie", "foreign-cookie"));

        assertThat(new SharedDshToolBootstrapClient(http).load(context, SERVICE)).isEqualTo(KEYS);

        Request request = http.requests.getFirst();
        assertThat(request.method()).isEqualTo("POST");
        assertThat(request.url().toString()).isEqualTo(
            "https://host.example/prefix/u/account%20one/api/byclaw/tool-environment/bootstrap");
        assertThat(request.header("Cookie")).isEqualTo("byclaw_web_token=" + TOKEN);
        assertThat(request.header("X-Endpoint-Auth")).isEqualTo("endpoint-header");
        try (Buffer body = new Buffer()) {
            request.body().writeTo(body);
            assertThat(JSON.readValue(body.readUtf8(), Map.class)).isEqualTo(Map.of("serviceKey", SERVICE));
        }
    }

    @Test
    void usesFirstEndpointAndGatewayTokenWhenPrimaryEndpointIsAbsent() throws Exception {
        ReplyHttp http = new ReplyHttp(200, validResponse());
        SandboxLaunchData context = context(null);
        context.setEndpoints(List.of("https://host.example/u/user-one/chat", "https://unused.example/u/other/chat"));
        context.setGatewayToken(TOKEN);

        assertThat(new SharedDshToolBootstrapClient(http).load(context, SERVICE)).isEqualTo(KEYS);
        assertThat(http.requests.getFirst().url().host()).isEqualTo("host.example");
        assertThat(http.requests.getFirst().header("Cookie")).isEqualTo("byclaw_web_token=" + TOKEN);
    }

    @Test
    void postsBootstrapUnderManagedContextRootWithoutChatSuffix() throws Exception {
        ReplyHttp http = new ReplyHttp(200, validResponse());
        SandboxLaunchData context = context("https://host.example/prefix/u/context-42/?token=" + TOKEN);
        context.setGatewayToken(TOKEN);

        assertThat(new SharedDshToolBootstrapClient(http).load(context, SERVICE)).isEqualTo(KEYS);

        Request request = http.requests.getFirst();
        assertThat(request.url().toString()).isEqualTo(
            "https://host.example/prefix/u/context-42/api/byclaw/tool-environment/bootstrap");
        assertThat(request.header("Cookie")).isEqualTo("byclaw_web_token=" + TOKEN);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "https://host.example/u/user-one/chat?token=other-token",
        "https://host.example/u/user-one/chat?token=user-web-token&token=user-web-token",
        "https://host.example/u/user-one/chat?token=",
        "https://host.example/u/user-one/chat?token=user-web-token%3Bother%3Didentity",
        "https://host.example/u/user-one/chat?token=user-web-token%0D%0AX-Injected%3Ayes"
    })
    void rejectsAmbiguousOrInvalidTokenBeforeSending(String endpoint) throws Exception {
        ReplyHttp http = new ReplyHttp(200, validResponse());
        SandboxLaunchData context = context(endpoint);
        context.setGatewayToken(TOKEN);

        assertSafeFailure(() -> new SharedDshToolBootstrapClient(http).load(context, SERVICE));
        assertThat(http.requests).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "https://host.example/chat?token=user-web-token",
        "https://host.example/u/user-one?token=user-web-token",
        "https://host.example/prefix/u/user-one?token=user-web-token",
        "https://host.example/u/user-one/settings?token=user-web-token",
        "https://host.example/u/user-one/../user-two/chat?token=user-web-token",
        "https://host.example/u/user%2Ftwo/chat?token=user-web-token",
        "https://other-user:password@host.example/u/user-one/chat?token=user-web-token",
        "https://host.example/u/user-one/chat?token=user-web-token#fragment",
        "file:///u/user-one/chat?token=user-web-token"
    })
    void rejectsEndpointsOutsideAnUnambiguousUserChatPath(String endpoint) throws Exception {
        ReplyHttp http = new ReplyHttp(200, validResponse());

        assertSafeFailure(() -> new SharedDshToolBootstrapClient(http).load(context(endpoint), SERVICE));
        assertThat(http.requests).isEmpty();
    }

    @Test
    void rejectsMissingCredentialsAndBlankServiceBeforeSending() throws Exception {
        ReplyHttp http = new ReplyHttp(200, validResponse());
        SharedDshToolBootstrapClient client = new SharedDshToolBootstrapClient(http);
        assertSafeFailure(() -> client.load(context("https://host.example/u/user-one/chat"), SERVICE));
        assertSafeFailure(() -> client.load(context("https://host.example/u/user-one/chat?token=" + TOKEN), " "));
        assertSafeFailure(() -> client.load(null, SERVICE));
        assertThat(http.requests).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(ints = {201, 204, 301, 302, 307, 401, 403, 500})
    void rejectsEveryNon200ResponseWithoutRevealingResponse(int status) throws Exception {
        ReplyHttp http = new ReplyHttp(status, "private-response-token");
        assertSafeFailure(() -> new SharedDshToolBootstrapClient(http).load(authenticatedContext(), SERVICE));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "{}",
        "{\"serviceKey\":\"another-service\",\"toolEnvironmentKeys\":{}}",
        "{\"serviceKey\":\"byclaw-tools\"}",
        "{\"serviceKey\":\"byclaw-tools\",\"toolEnvironmentKeys\":null}",
        "{\"serviceKey\":\"byclaw-tools\",\"toolEnvironmentKeys\":{}}",
        "{\"serviceKey\":\"byclaw-tools\",\"toolEnvironmentKeys\":{\"authorizedKey\":\"bad\",\"hostPrivateKeyBase64\":\"bad\"}}",
        "[]",
        "private-response-token"
    })
    void rejectsMissingOrInvalidBootstrapResponse(String response) {
        ReplyHttp http = new ReplyHttp(200, response);
        assertSafeFailure(() -> new SharedDshToolBootstrapClient(http).load(authenticatedContext(), SERVICE));
    }

    @Test
    void rejectsWrongServiceEvenWhenReturnedKeysAreValid() throws Exception {
        ReplyHttp http = new ReplyHttp(200, JSON.writeValueAsString(
            Map.of("serviceKey", "another-service", "toolEnvironmentKeys", KEYS)));
        assertSafeFailure(() -> new SharedDshToolBootstrapClient(http).load(authenticatedContext(), SERVICE));
    }

    @Test
    void rejectsTrailingJsonAndDuplicateIdentity() throws Exception {
        assertSafeFailure(() -> new SharedDshToolBootstrapClient(new ReplyHttp(200, validResponse() + " {}"))
            .load(authenticatedContext(), SERVICE));
        String duplicate = validResponse().replace("\"serviceKey\":", "\"serviceKey\":\"foreign-service\",\"serviceKey\":");
        assertSafeFailure(() -> new SharedDshToolBootstrapClient(new ReplyHttp(200, duplicate))
            .load(authenticatedContext(), SERVICE));
    }

    @Test
    void rejectsOversizedBodyEvenWithoutDeclaredContentLength() throws Exception {
        String oversized = validResponse().substring(0, validResponse().length() - 1)
            + ",\"padding\":\"" + "x".repeat(32768) + "\"}";
        ReplyHttp http = new ReplyHttp(200, oversized);
        http.unknownLength = true;
        assertSafeFailure(() -> new SharedDshToolBootstrapClient(http).load(authenticatedContext(), SERVICE));
    }

    @Test
    void sanitizesNetworkErrorsIncludingTheirCause() {
        Call.Factory http = request -> {
            Call call = mock(Call.class);
            try {
                when(call.execute()).thenThrow(new IOException("private-platform-url?token=" + TOKEN));
            } catch (IOException impossible) { throw new AssertionError(impossible); }
            return call;
        };
        assertSafeFailure(() -> new SharedDshToolBootstrapClient(http).load(authenticatedContext(), SERVICE));
    }

    @Test
    void defaultClientDoesNotFollowRedirectsOrForwardCookieToAnotherPath() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicInteger forwarded = new AtomicInteger();
        server.createContext("/u/user-one/api/byclaw/tool-environment/bootstrap", exchange -> {
            exchange.getResponseHeaders().add("Location", "/wrong-user");
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        server.createContext("/wrong-user", exchange -> {
            forwarded.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.start();
        try {
            SandboxLaunchData context = context("http://127.0.0.1:" + server.getAddress().getPort()
                + "/u/user-one/chat?token=" + TOKEN);
            assertSafeFailure(() -> new SharedDshToolBootstrapClient().load(context, SERVICE));
            assertThat(forwarded).hasValue(0);
        } finally { server.stop(0); }
    }

    private static void assertSafeFailure(org.assertj.core.api.ThrowableAssert.ThrowingCallable action) {
        assertThatThrownBy(action).isInstanceOf(IllegalStateException.class).hasMessage(FAILURE).hasNoCause();
    }

    private static SandboxLaunchData context(String endpoint) {
        SandboxLaunchData context = new SandboxLaunchData();
        context.setEndpoint(endpoint);
        return context;
    }

    private static SandboxLaunchData authenticatedContext() {
        return context("https://host.example/u/user-one/chat?token=" + TOKEN);
    }

    private static String validResponse() throws IOException {
        return JSON.writeValueAsString(Map.of("serviceKey", SERVICE, "toolEnvironmentKeys", KEYS));
    }

    private static final class ReplyHttp implements Call.Factory {
        private final int status;
        private final String body;
        private final List<Request> requests = new ArrayList<>();
        private boolean unknownLength;

        private ReplyHttp(int status, String body) { this.status = status; this.body = body; }

        @Override public Call newCall(Request request) {
            requests.add(request);
            ResponseBody responseBody = ResponseBody.create(MediaType.get("application/json"),
                unknownLength ? -1 : body.getBytes(StandardCharsets.UTF_8).length, new Buffer().writeUtf8(body));
            Response response = new Response.Builder().request(request).protocol(Protocol.HTTP_1_1)
                .code(status).message("fixture").body(responseBody).build();
            Call call = mock(Call.class);
            try { when(call.execute()).thenReturn(response); }
            catch (IOException impossible) { throw new AssertionError(impossible); }
            return call;
        }
    }
}
