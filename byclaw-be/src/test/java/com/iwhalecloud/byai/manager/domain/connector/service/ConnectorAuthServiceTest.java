package com.iwhalecloud.byai.manager.domain.connector.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorEnableStateDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;

import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;

import java.util.Optional;

class ConnectorAuthServiceTest {

    private ConnectorAuthMapper connectorAuthMapper;
    private ConnectorInfoMapper connectorInfoMapper;
    private ConnectorConnectionStateService connectionStateService;
    private RedisAuthorizationSessionRepository sessionRepository;
    private ConnectorAuthService service;

    @BeforeEach
    void setUp() {
        connectorAuthMapper = mock(ConnectorAuthMapper.class);
        connectorInfoMapper = mock(ConnectorInfoMapper.class);
        connectionStateService = mock(ConnectorConnectionStateService.class);
        sessionRepository = mock(RedisAuthorizationSessionRepository.class);
        service = new ConnectorAuthService();
        ReflectionTestUtils.setField(service, "connectorAuthMapper", connectorAuthMapper);
        ReflectionTestUtils.setField(service, "connectorInfoMapper", connectorInfoMapper);
        ReflectionTestUtils.setField(service, "connectionStateService", connectionStateService);
        ReflectionTestUtils.setField(service, "sessionRepository", sessionRepository);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void findById_onlyReadsActiveAuthorizationOwnedByCurrentUser() {
        when(connectorAuthMapper.selectOne(any())).thenReturn(null);

        service.findById(2001L);

        ArgumentCaptor<QueryWrapper<ConnectorAuth>> captor = ArgumentCaptor.forClass(QueryWrapper.class);
        verify(connectorAuthMapper).selectOne(captor.capture());
        QueryWrapper<ConnectorAuth> query = captor.getValue();
        assertThat(query.getSqlSegment()).contains("auth_id", "user_id", "status_cd");
        assertThat(query.getParamNameValuePairs().values()).contains(2001L, "1001", "00A");
    }

    @Test
    void update_onlyUpdatesAuthorizationOwnedByCurrentUser() {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setAuthId(2001L);
        auth.setConnectorId(3001L);
        auth.setUserId("different-user");
        ConnectorInfo connectorInfo = new ConnectorInfo();
        connectorInfo.setConnectorId(3001L);
        connectorInfo.setStatusCd("00A");
        connectorInfo.setAuthMode("NONE");
        when(connectorInfoMapper.selectById(3001L)).thenReturn(connectorInfo);
        when(connectorAuthMapper.update(any(ConnectorAuth.class), any())).thenReturn(1);

        service.update(auth);

        assertThat(auth.getUserId()).isEqualTo("1001");
        ArgumentCaptor<Wrapper<ConnectorAuth>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(connectorAuthMapper).update(any(ConnectorAuth.class), captor.capture());
        QueryWrapper<ConnectorAuth> query = (QueryWrapper<ConnectorAuth>) captor.getValue();
        assertThat(query.getSqlSegment()).contains("auth_id", "user_id", "status_cd");
        assertThat(query.getParamNameValuePairs().values()).contains(2001L, "1001", "00A");
    }

    @Test
    void updateEnableFlagUsesTheSharedOperationLockBeforeChangingState() {
        when(sessionRepository.tryAcquireStartLock(org.mockito.ArgumentMatchers.eq("1001"),
            org.mockito.ArgumentMatchers.eq(3001L), org.mockito.ArgumentMatchers.any()))
            .thenReturn(Optional.of("lock-token"));

        service.updateEnableFlag(3001L, true);

        verify(connectionStateService).updateEnableFlag("1001", 3001L, true);
        verify(sessionRepository).releaseStartLock("1001", 3001L, "lock-token");
    }

    @Test
    void updateEnableFlagRejectsAConcurrentConnectorOperation() {
        when(sessionRepository.tryAcquireStartLock(org.mockito.ArgumentMatchers.eq("1001"),
            org.mockito.ArgumentMatchers.eq(3001L), org.mockito.ArgumentMatchers.any()))
            .thenReturn(Optional.empty());

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.updateEnableFlag(3001L, false))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("进行中的授权任务");

        verifyNoInteractions(connectionStateService);
    }

    @Test
    void updateEnableFlagKeepsTheCommittedStateWhenLockReleaseFails() {
        when(sessionRepository.tryAcquireStartLock(org.mockito.ArgumentMatchers.eq("1001"),
            org.mockito.ArgumentMatchers.eq(3001L), org.mockito.ArgumentMatchers.any()))
            .thenReturn(Optional.of("lock-token"));
        doThrow(new IllegalStateException("redis unavailable"))
            .when(sessionRepository).releaseStartLock("1001", 3001L, "lock-token");

        service.updateEnableFlag(3001L, true);

        verify(connectionStateService).updateEnableFlag("1001", 3001L, true);
    }

    @Test
    void findConnectorEnableStatesReturnsAuthorizedConnectorsIncludingDisabledState() {
        when(connectorAuthMapper.selectConnectorEnableStates("1001"))
            .thenReturn(java.util.List.of(
                state("dingtalk", "dws", true),
                state("lark", "fws", false)));

        assertThat(service.findConnectorEnableStates(1001L))
            .containsExactly(
                Map.entry("dws", true),
                Map.entry("fws", false));
        verify(connectorAuthMapper).selectConnectorEnableStates("1001");
    }

    @Test
    void findConnectorEnableStatesIgnoresConnectorWhenSkillCodeIsMissing() {
        when(connectorAuthMapper.selectConnectorEnableStates("1001"))
            .thenReturn(java.util.List.of(state("custom", null, true)));

        assertThat(service.findConnectorEnableStates(1001L)).isEmpty();
    }

    @Test
    void findConnectorEnableStatesKeepsSharedSkillEnabledWhenAnyConnectorIsEnabled() {
        when(connectorAuthMapper.selectConnectorEnableStates("1001"))
            .thenReturn(java.util.List.of(
                state("weixin-official-api", "wechat-api", true),
                state("weixin-open-platform", "wechat-api", false)));

        assertThat(service.findConnectorEnableStates(1001L))
            .containsExactly(Map.entry("wechat-api", true));
    }

    @Test
    void findConnectorEnableStatesReturnsEmptyMapForInvalidUser() {
        assertThat(service.findConnectorEnableStates(null)).isEmpty();
        assertThat(service.findConnectorEnableStates(0L)).isEmpty();
        verifyNoInteractions(connectorAuthMapper);
    }

    private ConnectorEnableStateDto state(String connectorCode, String skillCode, boolean enabled) {
        ConnectorEnableStateDto state = new ConnectorEnableStateDto();
        state.setConnectorCode(connectorCode);
        state.setSkillCode(skillCode);
        state.setEnabled(enabled);
        return state;
    }
}
