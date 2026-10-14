package com.iwhalecloud.byai.manager.domain.aimodel.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mockStatic;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

class AiModelServiceTest {
    private final AiModelService service = new AiModelService();

    @Test
    void parsesEachRedisJsonStringInsteadOfParsingAnArrayOfStringsAsObjects() {
        String llm = """
            {"instanceId":"42","modelCode":"test-llm","modelType":"LLM","status":1,
             "authToken":"synthetic-test-token","maxContentToken":"128000",
             "instanceParam":{"abilities":["3","7"],"providerName":"OpenAI"}}
            """;
        String embedding = """
            {"instanceId":"43","modelCode":"test-embedding","modelType":"EMBEDDING","status":1}
            """;
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.hmGetAll(RedisConfig.AI_MODEL_KEY)).thenReturn(List.of(llm, embedding));
            List<ModelDto> models = service.getModelList();
            assertThat(models).extracting(ModelDto::getInstanceId).containsExactly("42", "43");
            assertThat(models.get(0).getAuthToken()).isEqualTo("synthetic-test-token");
            assertThat(models.get(0).getInstanceParam().get("abilities")).isEqualTo(List.of("3", "7"));
            assertThat(models.get(1).getModelType()).isEqualTo("EMBEDDING");
        }
    }

    @Test
    void acceptsAlreadyDeserializedModelObjectsForOlderRedisSerializers() {
        Map<String, Object> object = Map.of("instanceId", "44", "modelCode", "test-model", "status", 0);
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.hmGetAll(RedisConfig.AI_MODEL_KEY)).thenReturn(List.of(object));
            List<ModelDto> models = service.getModelList();
            assertThat(models).extracting(ModelDto::getInstanceId).containsExactly("44");
            assertThat(models.get(0).getStatus()).isZero();
        }
    }

    @Test
    void emptyOrMissingCacheReturnsAnEmptyList() {
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.hmGetAll(RedisConfig.AI_MODEL_KEY)).thenReturn(null).thenReturn(List.of());
            assertThat(service.getModelList()).isEmpty();
            assertThat(service.getModelList()).isEmpty();
        }
    }

    @Test
    void skipsBrokenRecordsAndDoesNotLogCredentialsOrParserExceptionBodies() {
        Logger logger = (Logger) LoggerFactory.getLogger(AiModelService.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try (var redis = mockStatic(RedisUtil.class)) {
            String invalid = "{\"authToken\":\"synthetic-private-token\",,}";
            String valid = JsonUtil.toJSONString(Map.of("instanceId", "42", "modelCode", "test-model"));
            redis.when(() -> RedisUtil.hmGetAll(RedisConfig.AI_MODEL_KEY))
                .thenReturn(Arrays.asList(null, " ", "null", invalid, "[]", valid));
            assertThat(service.getModelList()).extracting(ModelDto::getInstanceId).containsExactly("42");
            assertThat(appender.list).isNotEmpty();
            assertThat(appender.list).allSatisfy(event -> {
                assertThat(event.getFormattedMessage()).doesNotContain("synthetic-private-token", "authToken");
                assertThat(event.getThrowableProxy()).isNull();
            });
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }
}
