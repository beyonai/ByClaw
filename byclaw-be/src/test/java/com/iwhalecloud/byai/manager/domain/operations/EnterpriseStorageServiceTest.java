package com.iwhalecloud.byai.manager.domain.operations;

import com.alibaba.fastjson.JSON;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServiceEndpoint;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServiceEndpointResolver;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServiceOperation;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServicePathResolver;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeStatus;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeStatusResult;
import com.iwhalecloud.byai.manager.mapper.operations.EnterpriseStorageMapper;
import com.iwhalecloud.byai.manager.vo.operations.EnterpriseCloudResourceVo;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 企业范围、批量契约与故障不能变成零用量。 @author Codex @since 2026-11-02 */
class EnterpriseStorageServiceTest {
    private final EnterpriseStorageMapper mapper = mock(EnterpriseStorageMapper.class);
    private final FeignPythonBuildService qa = mock(FeignPythonBuildService.class);
    private final KnowledgeServiceEndpointResolver endpoints = mock(KnowledgeServiceEndpointResolver.class);
    private final KnowledgeServicePathResolver paths = mock(KnowledgeServicePathResolver.class);
    private final EnterpriseStorageService service = new EnterpriseStorageService();

    /** 装配只读依赖并设置默认知识服务路由。 */
    @BeforeEach
    void prepare() {
        ReflectionTestUtils.setField(service, "enterpriseStorageMapper", mapper);
        ReflectionTestUtils.setField(service, "feignPythonBuildService", qa);
        ReflectionTestUtils.setField(service, "knowledgeServiceEndpointResolver", endpoints);
        ReflectionTestUtils.setField(service, "knowledgeServicePathResolver", paths);
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        when(mapper.canRead(42, 7)).thenReturn(true);
        when(endpoints.resolveByKnCode(any())).thenReturn(KnowledgeServiceEndpoint.forDiscovery("qa"));
        when(paths.resolveByKnCodeAndOperation(any(), eq(KnowledgeServiceOperation.STATUS)))
            .thenReturn("/api/v1/knowledgeBases/status");
    }

    /** 同库关联只统计一次，响应按编码匹配而不依赖返回顺序。 */
    @Test
    void sumsDecimalKbAndCountsEachCloudOnlyOnce() {
        EnterpriseCloudResourceVo sharedCloud = cloud(3, "a");
        sharedCloud.setCloudResourceId(1L);
        when(mapper.selectClouds(42)).thenReturn(List.of(cloud(1, "a"), cloud(2, "b"), sharedCloud));
        when(qa.knowledgeStatus(any())).thenReturn(response("""
            {"resultCode":"0","resultObject":{"data":[
              {"knCode":"b","fileCount":0,"spaceSize":0},
              {"knCode":"a","fileCount":3,"spaceSize":1024.25}]}}
            """));
        JsonNode result = service.summary(42, 7);
        assertThat(result.path("usedKb").asText()).isEqualTo("1024.25");
        assertThat(result.path("fileCount").asLong()).isEqualTo(3);
        assertThat(result.path("groups").size()).isEqualTo(2);
        ArgumentCaptor<KbKnowledgeStatus> body = ArgumentCaptor.forClass(KbKnowledgeStatus.class);
        verify(qa).knowledgeStatus(body.capture());
        assertThat(body.getValue().getKnCodeList()).containsExactly("a", "b");
        assertThat(JSON.parseObject(JSON.toJSONString(body.getValue())).keySet()).containsExactly("knCodeList");
        assertThat(KnowledgeServiceOperation.STATUS.getLocalPath()).isEqualTo("/api/v1/knowledgeBases/status");
    }

    /** 不同知识服务不混发编码。 */
    @Test
    void queriesDifferentKnowledgeServicesSeparately() {
        when(mapper.selectClouds(42)).thenReturn(List.of(cloud(1, "a"), cloud(2, "b")));
        when(endpoints.resolveByKnCode("b")).thenReturn(KnowledgeServiceEndpoint.forDiscovery("other-qa"));
        when(qa.knowledgeStatus(any())).thenAnswer(invocation -> {
            KbKnowledgeStatus request = invocation.getArgument(0);
            return response("{\"resultCode\":\"0\",\"resultObject\":{\"data\":[{\"knCode\":\""
                + request.getKnCode() + "\",\"fileCount\":1,\"spaceSize\":0.01}]}}");
        });
        assertThat(service.summary(42, 7).path("usedKb").asText()).isEqualTo("0.02");
        ArgumentCaptor<KbKnowledgeStatus> body = ArgumentCaptor.forClass(KbKnowledgeStatus.class);
        verify(qa, times(2)).knowledgeStatus(body.capture());
        assertThat(body.getAllValues()).extracting(KbKnowledgeStatus::getKnCodeList)
            .containsExactly(List.of("a"), List.of("b"));
    }

    /** 无工作组时不发送违反文档约束的空数组。 */
    @Test
    void emptyEnterpriseReturnsZeroWithoutSendingInvalidEmptyBatch() {
        when(mapper.selectClouds(42)).thenReturn(List.of());
        assertThat(service.summary(42, 7).path("usedKb").asText()).isEqualTo("0");
        verifyNoInteractions(qa, endpoints, paths);
    }

    /** 跨企业无权读取时不查询 QA。 */
    @Test
    void deniedEnterpriseNeverQueriesClouds() {
        assertThatThrownBy(() -> service.summary(43, 7)).isInstanceOf(OperationsFailure.class);
        verifyNoInteractions(qa);
    }

    /** 失败、缺项和无效统计不形成部分汇总。 */
    @Test
    void missingNegativeDuplicateAndFailedResultsNeverProducePartialTotals() {
        when(mapper.selectClouds(42)).thenReturn(List.of(cloud(1, "a"), cloud(2, "b")));
        for (String body : List.of(
                "{\"resultCode\":\"-1\",\"resultObject\":{}}",
                "{\"resultCode\":\"0\",\"resultObject\":{\"data\":[]}}",
                "{\"resultCode\":\"0\",\"resultObject\":{\"data\":[{\"knCode\":\"a\",\"fileCount\":1,\"spaceSize\":-1},{\"knCode\":\"b\",\"fileCount\":0,\"spaceSize\":0}]}}",
                "{\"resultCode\":\"0\",\"resultObject\":{\"data\":[{\"knCode\":\"a\",\"fileCount\":1,\"spaceSize\":1},{\"knCode\":\"a\",\"fileCount\":1,\"spaceSize\":1}]}}")) {
            when(qa.knowledgeStatus(any())).thenReturn(response(body));
            assertThatThrownBy(() -> service.summary(42, 7)).isInstanceOf(OperationsFailure.class);
        }
    }

    /** 损坏关联不能伪装为空库。 */
    @Test
    void brokenCloudBindingIsUnavailableRatherThanEmpty() {
        EnterpriseCloudResourceVo broken = cloud(1, "a");
        broken.setKnCode(null);
        when(mapper.selectClouds(42)).thenReturn(List.of(broken));
        assertThatThrownBy(() -> service.summary(42, 7)).isInstanceOf(OperationsFailure.class);
        verifyNoInteractions(qa);
    }


    /** 不同资源使用同一编码会产生路由歧义，不能去重后少算。 */
    @Test
    void conflictingResourceBindingsCannotBeSilentlyDeduplicated() {
        when(mapper.selectClouds(42)).thenReturn(List.of(cloud(1, "a"), cloud(2, "a")));
        assertThatThrownBy(() -> service.summary(42, 7)).isInstanceOf(OperationsFailure.class);
        verifyNoInteractions(qa, endpoints, paths);
    }

    /** JSON 数字的无效尾零不改变实际精度，输出仍遵守内部两位小数契约。 */
    @Test
    void normalizesInsignificantTrailingZeros() {
        when(mapper.selectClouds(42)).thenReturn(List.of(cloud(1, "a")));
        when(qa.knowledgeStatus(any())).thenReturn(response("""
            {"resultCode":"0","resultObject":{"data":[{"knCode":"a","fileCount":1,"spaceSize":1.2300}]}}
            """));
        JsonNode result = service.summary(42, 7);
        assertThat(result.path("usedKb").asText()).isEqualTo("1.23");
        assertThat(result.path("groups").get(0).path("usedKb").asText()).isEqualTo("1.23");
    }

    /** 不同路径即使使用同一知识服务，也不能混成一个请求。 */
    @Test
    void separatesDifferentOperationPaths() {
        when(mapper.selectClouds(42)).thenReturn(List.of(cloud(1, "a"), cloud(2, "b")));
        when(paths.resolveByKnCodeAndOperation("b", KnowledgeServiceOperation.STATUS)).thenReturn("/v2/status");
        when(qa.knowledgeStatus(any())).thenAnswer(invocation -> {
            KbKnowledgeStatus request = invocation.getArgument(0);
            return response("{\"resultCode\":\"0\",\"resultObject\":{\"data\":[{\"knCode\":\""
                + request.getKnCode() + "\",\"fileCount\":1,\"spaceSize\":0.01}]}}");
        });
        assertThat(service.summary(42, 7).path("usedKb").asText()).isEqualTo("0.02");
        verify(qa, times(2)).knowledgeStatus(any());
    }

    /** 创建服务端工作组项目关联。 */
    private EnterpriseCloudResourceVo cloud(long id, String code) {
        EnterpriseCloudResourceVo cloud = new EnterpriseCloudResourceVo();
        cloud.setProjectId(id);
        cloud.setProjectName("Group " + id);
        cloud.setCloudResourceId(id);
        cloud.setKnCode(code);
        return cloud;
    }

    /** 解析文档中的 QA 返回契约。 */
    private PythonBuildResponse<KnowledgeStatusResult> response(String body) {
        return JSON.parseObject(body, new com.alibaba.fastjson.TypeReference<PythonBuildResponse<KnowledgeStatusResult>>() { });
    }
}
