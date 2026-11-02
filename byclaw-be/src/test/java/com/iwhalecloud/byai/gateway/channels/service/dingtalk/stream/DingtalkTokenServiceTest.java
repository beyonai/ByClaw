package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.api.DefaultDingTalkClient;
import com.dingtalk.api.request.OapiGettokenRequest;
import com.dingtalk.api.response.OapiGettokenResponse;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;

import java.util.Map;
import java.util.concurrent.*;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DingtalkTokenServiceTest {
    private final DingtalkRobotConfigService configs = mock(DingtalkRobotConfigService.class);
    private final DingtalkHttpClientFactory factory = mock(DingtalkHttpClientFactory.class);
    private final DefaultDingTalkClient client = mock(DefaultDingTalkClient.class);
    private final DingtalkTokenService service = new DingtalkTokenService(configs, factory);
    private final Map<String, String> cache = new ConcurrentHashMap<>();

    @BeforeEach
    void configure() {
        DingtalkRobotChannelConfig config = new DingtalkRobotChannelConfig();
        config.setClientId("app");
        config.setClientSecret("test-secret");
        when(configs.getRobotConfig(anyString())).thenReturn(config);
        when(factory.legacyClient(anyString())).thenReturn(client);
    }

    @Test
    void differentSendersReuseTheSameApplicationToken() throws Exception {
        when(client.execute(any(OapiGettokenRequest.class))).thenReturn(response("token"));
        try (var redis = mockCache()) {
            assertThat(service.getAccessToken("alice", "robot")).isEqualTo("token");
            assertThat(service.getAccessToken("bob", "robot")).isEqualTo("token");
            verify(client, times(1)).execute(any(OapiGettokenRequest.class));
            service.evictAccessTokensByRobotCode("robot");
            redis.verify(() -> RedisUtil.delByPrefix("dingtalk:access_token:robot:"));
        }
    }

    @Test
    void concurrentCacheMissesShareOneFetch() throws Exception {
        CountDownLatch fetching = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch joined = new CountDownLatch(1);
        when(client.execute(any(OapiGettokenRequest.class))).thenAnswer(invocation -> {
            fetching.countDown();
            assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            return response("token");
        });
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<String> first = executor.submit(() -> {
                try (var ignored = mockCache()) {
                    return service.getAccessToken("alice", "robot");
                }
            });
            assertThat(fetching.await(5, TimeUnit.SECONDS)).isTrue();
            Future<String> second = executor.submit(() -> {
                try (var redis = mockCache()) {
                    redis.when(() -> RedisUtil.getString(anyString())).thenAnswer(invocation -> {
                        joined.countDown();
                        return cache.get(invocation.<String>getArgument(0));
                    });
                    return service.getAccessToken("bob", "robot");
                }
            });
            assertThat(joined.await(5, TimeUnit.SECONDS)).isTrue();
            release.countDown();

            assertThat(first.get(5, TimeUnit.SECONDS)).isEqualTo("token");
            assertThat(second.get(5, TimeUnit.SECONDS)).isEqualTo("token");
            verify(client, times(1)).execute(any(OapiGettokenRequest.class));
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void failedFetchDoesNotPoisonTheNextAttempt() throws Exception {
        when(client.execute(any(OapiGettokenRequest.class)))
            .thenThrow(new IllegalStateException("unavailable"))
            .thenReturn(response("recovered"));
        try (var ignored = mockCache()) {
            assertThatIllegalStateException().isThrownBy(() -> service.getAccessToken("alice", "robot"));
            assertThat(service.getAccessToken("bob", "robot")).isEqualTo("recovered");
        }
    }

    @Test
    void differentRobotsDoNotShareTokenCache() throws Exception {
        when(client.execute(any(OapiGettokenRequest.class))).thenReturn(response("first"), response("second"));
        try (var ignored = mockCache()) {
            assertThat(service.getAccessToken("alice", "robot-1")).isEqualTo("first");
            assertThat(service.getAccessToken("alice", "robot-2")).isEqualTo("second");
            verify(client, times(2)).execute(any(OapiGettokenRequest.class));
        }
    }

    private MockedStatic<RedisUtil> mockCache() {
        MockedStatic<RedisUtil> redis = mockStatic(RedisUtil.class);
        redis.when(() -> RedisUtil.getString(anyString())).thenAnswer(invocation -> cache.get(invocation.<String>getArgument(0)));
        redis.when(() -> RedisUtil.setString(anyString(), anyString(), anyLong(), eq(TimeUnit.MINUTES)))
            .thenAnswer(invocation -> {
                cache.put(invocation.getArgument(0), invocation.getArgument(1));
                return null;
            });
        return redis;
    }

    private OapiGettokenResponse response(String token) {
        OapiGettokenResponse response = new OapiGettokenResponse();
        response.setErrcode(0L);
        response.setAccessToken(token);
        return response;
    }
}
