package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.event.devloop.GitHubTokenConfiguredEvent;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.manager.dto.users.UserPrivateParamDTO;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.manager.vo.users.UserPrivateParamVO;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.util.ReflectionTestUtils;

class UserPrivateParamApplicationServiceTest {

    private UserPrivateParamMapper mapper;
    private UserPrivateParamApplicationService service;

    @BeforeEach
    void setUp() {
        mapper = mock(UserPrivateParamMapper.class);
        service = new UserPrivateParamApplicationService();
        ReflectionTestUtils.setField(service, "userPrivateParamMapper", mapper);
        SequenceService sequenceService = mock(SequenceService.class);
        when(sequenceService.nextVal()).thenReturn(8001L);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        loginInfo.setUserCode("tester");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void managedConnectorParamCannotBeEditedDeletedOrEnabledThroughUserApi() {
        UserPrivateParam managed = managedParam();
        when(mapper.selectOne(any())).thenReturn(managed);

        UserPrivateParamDTO edit = new UserPrivateParamDTO();
        edit.setParamId(managed.getParamId());
        edit.setKey(managed.getParamKey());
        edit.setValue("tampered");
        assertThatThrownBy(() -> service.save(edit))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("系统托管");

        UserPrivateParamDTO mutation = new UserPrivateParamDTO();
        mutation.setParamId(managed.getParamId());
        mutation.setEnabled(false);
        assertThatThrownBy(() -> service.delete(mutation))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("系统托管");
        assertThatThrownBy(() -> service.enable(mutation))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("系统托管");
    }

    @Test
    @SuppressWarnings("unchecked")
    void listMarksConnectorParamAsManagedAndNonMutable() {
        UserPrivateParam managed = managedParam();
        when(mapper.selectPage(any(Page.class), any())).thenAnswer(invocation -> {
            Page<UserPrivateParam> page = invocation.getArgument(0);
            page.setRecords(List.of(managed));
            page.setTotal(1L);
            return page;
        });
        when(mapper.selectList(any())).thenReturn(List.of());

        Map<String, Object> result = service.list(new UserPrivateParamDTO());

        UserPrivateParamVO vo = ((List<UserPrivateParamVO>) result.get("list")).getFirst();
        assertThat(vo.getSource()).isEqualTo("CONNECTOR");
        assertThat(vo.getSourceRef()).isEqualTo("dingtalk");
        assertThat(vo.getManaged()).isTrue();
        assertThat(vo.getEditable()).isFalse();
        assertThat(vo.getDeletable()).isFalse();
        assertThat(vo.getEnableable()).isFalse();
    }

    @Test
    void legacyManifestShapedKeyIsNotReservedBecauseOwnershipUsesParamSource() {
        UserPrivateParamDTO request = new UserPrivateParamDTO();
        request.setKey("CONNECTOR_LARK_MANIFEST");
        request.setValue("{}");

        UserPrivateParamVO saved = service.save(request);

        assertThat(saved.getKey()).isEqualTo("CONNECTOR_LARK_MANIFEST");
        assertThat(saved.getSource()).isEqualTo("USER");
    }

    @Test
    void publishesProjectManifestSyncEventWhenGitHubTokenIsSaved() {
        ApplicationEventPublisher eventPublisher = mock(ApplicationEventPublisher.class);
        ReflectionTestUtils.setField(service, "eventPublisher", eventPublisher);
        UserPrivateParamDTO request = new UserPrivateParamDTO();
        request.setKey("GH_TOKEN");
        request.setValue("token-value");

        service.save(request);

        verify(eventPublisher).publishEvent(any(GitHubTokenConfiguredEvent.class));
    }

    @Test
    @SuppressWarnings("unchecked")
    void refreshFullyReplacesRedisSnapshot() throws Exception {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        ValueOperations<String, String> valueOperations = mock(ValueOperations.class);
        ReflectionTestUtils.setField(service, "stringRedisTemplate", redisTemplate);
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(mapper.selectList(any())).thenReturn(List.of(credential("API_KEY", "new-value")));

        assertThat(service.refreshPrivateParamCacheNow(1001L, "tester", 9001L)).isTrue();

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(eq("byai:user:private_params:tester"), payload.capture());
        assertThat(new ObjectMapper().readTree(payload.getValue()).path("params").path("API_KEY").textValue())
            .isEqualTo("new-value");
    }

    @Test
    @SuppressWarnings("unchecked")
    void privateParamCacheIncludesImaConnectorCredentialsForSandboxInjection() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        ValueOperations<String, String> valueOperations = mock(ValueOperations.class);
        ReflectionTestUtils.setField(service, "stringRedisTemplate", redisTemplate);
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(mapper.selectList(any())).thenReturn(List.of(
            credential("IMA_OPENAPI_CLIENTID", "client-id"),
            credential("IMA_OPENAPI_APIKEY", "api-key"),
            credential("OTHER_VALUE", "kept")
        ));

        assertThat(service.refreshPrivateParamCacheNow(1001L, "tester", 9001L)).isTrue();

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(eq("byai:user:private_params:tester"), payload.capture());
        assertThat(payload.getValue())
            .contains("OTHER_VALUE", "kept", "IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY", "client-id", "api-key");
    }

    @Test
    @SuppressWarnings("unchecked")
    void reconciliationScansConnectorManagedUsersInBatchesAndRebuildsCurrentSnapshots() {
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        ValueOperations<String, String> valueOperations = mock(ValueOperations.class);
        ReflectionTestUtils.setField(service, "stringRedisTemplate", redisTemplate);
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        Users first = user(1001L, "first");
        Users second = user(1002L, "second");
        when(mapper.selectConnectorManagedUsersAfter(0L, 2)).thenReturn(List.of(first, second));
        when(mapper.selectConnectorManagedUsersAfter(1002L, 2)).thenReturn(List.of());
        when(mapper.selectList(any())).thenReturn(List.of());

        assertThat(service.reconcileConnectorManagedCaches(2)).isEqualTo(2);

        verify(mapper).selectConnectorManagedUsersAfter(0L, 2);
        verify(mapper).selectConnectorManagedUsersAfter(1002L, 2);
    }

    private Users user(Long userId, String userCode) {
        Users user = new Users();
        user.setUserId(userId);
        user.setUserCode(userCode);
        return user;
    }

    private UserPrivateParam managedParam() {
        UserPrivateParam managed = new UserPrivateParam();
        managed.setParamId(7001L);
        managed.setUserId(1001L);
        managed.setParamKey("DWS_HOME");
        managed.setParamSource("CONNECTOR");
        managed.setSourceRef("dingtalk");
        managed.setStatus("NORMAL");
        managed.setDeleteFlag("0");
        return managed;
    }

    private UserPrivateParam credential(String key, String value) {
        UserPrivateParam param = managedParam();
        param.setParamKey(key);
        param.setParamValueCipher(Sm4Util.encrypt(value));
        param.setSourceRef("ima-openapi");
        return param;
    }
}
