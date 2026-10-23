package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import okio.Buffer;

class SharedDshHostClientTest {

    @Test
    void ensureUserPutsSandboxIdAndEnvWithBearerToken() throws Exception {
        FakeHttp http = new FakeHttp().reply(200,
            "{\"userCode\":\"u 1\",\"status\":\"ready\",\"hostId\":\"h1\",\"webPath\":\"/u/u%201/\",\"webToken\":\"wt\"}");
        SharedDshHostClient client = new SharedDshHostClient(http, "http://host:7300/", "secret");

        SharedDshHostClient.UserContext context = client.ensureUser("u 1", "byclaw-dsh-u 1", Map.of("K", "V"));

        assertThat(context.getWebToken()).isEqualTo("wt");
        assertThat(context.getHostId()).isEqualTo("h1");
        Request request = http.requests.getFirst();
        assertThat(request.method()).isEqualTo("PUT");
        assertThat(request.url().toString()).isEqualTo("http://host:7300/v1/users/u%201");
        assertThat(request.header("Authorization")).isEqualTo("Bearer secret");
        JsonNode body = new ObjectMapper().readTree(http.bodies.getFirst());
        assertThat(body.path("sandboxId").asText()).isEqualTo("byclaw-dsh-u 1");
        assertThat(body.path("env").path("K").asText()).isEqualTo("V");
    }

    @Test
    void ensureUserFailsOn503WithHostError() {
        FakeHttp http = new FakeHttp().reply(503, "{\"status\":\"failed\",\"error\":\"boot crashed\"}");
        SharedDshHostClient client = new SharedDshHostClient(http, "http://host:7300", "secret");

        assertThatThrownBy(() -> client.ensureUser("u1", "byclaw-dsh-u1", null))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("HTTP 503")
            .hasMessageContaining("boot crashed");
    }

    @Test
    void ensureUserRejectsReadyWithoutWebToken() {
        FakeHttp http = new FakeHttp().reply(200, "{\"status\":\"ready\"}");
        SharedDshHostClient client = new SharedDshHostClient(http, "http://host:7300", "secret");

        assertThatThrownBy(() -> client.ensureUser("u1", "byclaw-dsh-u1", null))
            .hasMessageContaining("webToken");
    }

    @Test
    void getUserReadsStatusAndTreats404AsAbsent() {
        FakeHttp http = new FakeHttp()
            .reply(200, "{\"status\":\"ready\",\"busy\":true,\"lastActiveAt\":42}")
            .reply(404, "");
        SharedDshHostClient client = new SharedDshHostClient(http, "http://host:7300", "secret");

        SharedDshHostClient.UserContext ready = client.getUser("u1");
        SharedDshHostClient.UserContext missing = client.getUser("u2");

        assertThat(ready.getStatus()).isEqualTo("ready");
        assertThat(ready.getBusy()).isTrue();
        assertThat(ready.getLastActiveAt()).isEqualTo(42L);
        assertThat(missing.getStatus()).isEqualTo("absent");
        assertThat(http.requests.get(0).method()).isEqualTo("GET");
    }

    @Test
    void deleteUserIsIdempotentAndReportsServerErrors() {
        FakeHttp http = new FakeHttp().reply(200, "").reply(404, "").reply(500, "oops");
        SharedDshHostClient client = new SharedDshHostClient(http, "http://host:7300", "secret");

        client.deleteUser("u1");
        client.deleteUser("u1");
        assertThatThrownBy(() -> client.deleteUser("u1")).hasMessageContaining("HTTP 500");
        assertThat(http.requests).extracting(Request::method).containsOnly("DELETE");
    }

    @Test
    void networkErrorsSurfaceAsIllegalState() {
        Call.Factory failing = request -> new FakeCall(request, null);
        SharedDshHostClient client = new SharedDshHostClient(failing, "http://host:7300", "secret");

        assertThatThrownBy(() -> client.getUser("u1"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("connection refused");
    }

    @Test
    void requiresToken() {
        assertThatThrownBy(() -> new SharedDshHostClient(new FakeHttp(), "http://host:7300", " "))
            .hasMessageContaining("token");
    }

    /** Records requests and answers them from a queue of canned responses. */
    static final class FakeHttp implements Call.Factory {
        final List<Request> requests = new ArrayList<>();
        final List<String> bodies = new ArrayList<>();
        private final Deque<Response.Builder> replies = new ArrayDeque<>();

        FakeHttp reply(int code, String body) {
            replies.add(new Response.Builder()
                .protocol(Protocol.HTTP_1_1)
                .code(code)
                .message("x")
                .body(ResponseBody.create(body, MediaType.get("application/json"))));
            return this;
        }

        @Override
        public Call newCall(Request request) {
            requests.add(request);
            String body = "";
            if (request.body() != null) {
                try (Buffer buffer = new Buffer()) {
                    request.body().writeTo(buffer);
                    body = buffer.readUtf8();
                }
                catch (IOException e) {
                    throw new IllegalStateException(e);
                }
            }
            bodies.add(body);
            Response.Builder reply = replies.poll();
            return new FakeCall(request, reply != null ? reply.request(request).build() : null);
        }
    }

    static final class FakeCall implements Call {
        private final Request request;
        private final Response response;

        FakeCall(Request request, Response response) {
            this.request = request;
            this.response = response;
        }

        @Override
        public Response execute() throws IOException {
            if (response == null) {
                throw new IOException("connection refused");
            }
            return response;
        }

        @Override
        public Request request() {
            return request;
        }

        @Override
        public void enqueue(okhttp3.Callback responseCallback) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void cancel() {
        }

        @Override
        public boolean isExecuted() {
            return true;
        }

        @Override
        public boolean isCanceled() {
            return false;
        }

        @Override
        public okio.Timeout timeout() {
            return okio.Timeout.NONE;
        }

        @Override
        public Call clone() {
            return this;
        }
    }
}
