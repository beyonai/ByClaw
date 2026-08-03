package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.users.UserPrivateParamDTO;
import com.iwhalecloud.byai.manager.entity.users.UserPrivateParam;
import com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper;
import com.iwhalecloud.byai.manager.vo.users.UserPrivateParamVO;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
}
