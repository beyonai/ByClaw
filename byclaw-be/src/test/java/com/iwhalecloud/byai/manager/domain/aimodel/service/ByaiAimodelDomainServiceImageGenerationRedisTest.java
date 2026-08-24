package com.iwhalecloud.byai.manager.domain.aimodel.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.staticdata.RedisConfig;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.util.JsonUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.tag.service.ByaiTagRelationService;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import com.iwhalecloud.byai.manager.entity.tag.ByaiTagRelation;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class ByaiAimodelDomainServiceImageGenerationRedisTest {

    private final Map<String, Map<Object, Object>> redisHashes = new LinkedHashMap<>();

    private final AtomicReference<List<ByaiTagRelation>> defaultRelations = new AtomicReference<>(List.of());

    private ByaiAimodelDomainService service;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        ByaiTagRelationService tagRelationService = mock(ByaiTagRelationService.class);
        when(tagRelationService.findTagRelation(Constants.OBJ_TYPE_AIMODEL, 1L))
            .thenAnswer(invocation -> defaultRelations.get());

        service = new ByaiAimodelDomainService();
        ReflectionTestUtils.setField(service, "byaiTagRelationService", tagRelationService);

        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        HashOperations<String, Object, Object> hashOperations = mock(HashOperations.class);
        when(redisTemplate.opsForHash()).thenReturn(hashOperations);
        doAnswer(invocation -> {
            String key = invocation.getArgument(0);
            Object hashKey = invocation.getArgument(1);
            Object value = invocation.getArgument(2);
            redisHashes.computeIfAbsent(key, ignored -> new LinkedHashMap<>()).put(hashKey, value);
            return null;
        }).when(hashOperations).put(anyString(), any(), any());
        when(hashOperations.values(anyString())).thenAnswer(invocation ->
            new ArrayList<>(redisHashes.getOrDefault(invocation.getArgument(0), Map.of()).values()));
        doAnswer(invocation -> {
            String key = invocation.getArgument(0);
            Map<Object, Object> entries = invocation.getArgument(1);
            redisHashes.computeIfAbsent(key, ignored -> new LinkedHashMap<>()).putAll(entries);
            return null;
        }).when(hashOperations).putAll(anyString(), anyMap());
        when(redisTemplate.delete(anyString())).thenAnswer(invocation ->
            redisHashes.remove(invocation.getArgument(0)) != null);

        RedisUtil redisUtil = new RedisUtil();
        ReflectionTestUtils.setField(redisUtil, "stringRedisTemplate", redisTemplate);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", redisUtil);
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(RedisUtil.class, "instance", null);
    }

    @Test
    void rebuildTypeListDynamicallyGroupsImageGenerationModels() {
        defaultRelations.set(List.of(relation(101L), relation(303L)));

        service.syncToRedis(model(101L, "LLM"));
        service.syncToRedis(model(303L, "IMAGE_GENERATION"));

        assertThat(redisHashes.get(RedisConfig.AI_MODEL_TYPE_KEY)).containsOnlyKeys("LLM", "IMAGE_GENERATION");
        assertThat(typeModels("IMAGE_GENERATION")).extracting(ModelDto::getInstanceId, ModelDto::getIsDefault)
            .containsExactly(org.assertj.core.groups.Tuple.tuple("303", 1));
    }

    @Test
    void relationChangeRefreshesImageGenerationDefaultMarkerAndOrder() {
        ByaiAimodel previousDefault = model(303L, "IMAGE_GENERATION");
        ByaiAimodel replacement = model(304L, "IMAGE_GENERATION");
        defaultRelations.set(List.of(relation(303L)));
        service.syncToRedis(previousDefault);
        service.syncToRedis(replacement);

        defaultRelations.set(List.of(relation(304L)));
        service.syncToRedis(previousDefault);
        service.syncToRedis(replacement);

        assertThat(typeModels("IMAGE_GENERATION")).extracting(ModelDto::getInstanceId, ModelDto::getIsDefault)
            .containsExactly(org.assertj.core.groups.Tuple.tuple("304", 1),
                org.assertj.core.groups.Tuple.tuple("303", 0));
    }

    private List<ModelDto> typeModels(String modelType) {
        Object json = redisHashes.getOrDefault(RedisConfig.AI_MODEL_TYPE_KEY, Map.of()).get(modelType);
        return JsonUtil.parseArray(String.valueOf(json), ModelDto.class);
    }

    private static ByaiAimodel model(Long modelId, String modelType) {
        ByaiAimodel model = new ByaiAimodel();
        model.setModelId(modelId);
        model.setModelType(modelType);
        model.setModelName(modelType + " model " + modelId);
        model.setModelNo("model-" + modelId);
        model.setUrl("https://model.example/" + modelId);
        model.setStatus("OOA");
        return model;
    }

    private static ByaiTagRelation relation(Long modelId) {
        ByaiTagRelation relation = new ByaiTagRelation();
        relation.setRelationId(modelId + 1000L);
        relation.setTagId(1L);
        relation.setObjId(modelId);
        relation.setObjType(Constants.OBJ_TYPE_AIMODEL);
        return relation;
    }
}
