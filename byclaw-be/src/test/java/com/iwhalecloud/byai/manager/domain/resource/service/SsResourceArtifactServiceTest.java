package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceArtifact;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceArtifactMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class SsResourceArtifactServiceTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void invalidateArtifactsByResourceId_removesExistingInvalidRecordBeforeInvalidatingActiveRecord() {
        SsResourceArtifactMapper mapper = mock(SsResourceArtifactMapper.class);
        SsResourceArtifactService service = new SsResourceArtifactService();
        ReflectionTestUtils.setField(service, "ssResourceArtifactMapper", mapper);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(100L);
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResourceArtifact activeArtifact = new SsResourceArtifact();
        activeArtifact.setArtifactId(10L);
        activeArtifact.setResourceId(200L);
        activeArtifact.setArtifactType("STANDARD_JSON");
        activeArtifact.setArtifactPath("object/OBJECT_200.json");
        activeArtifact.setStatusCd("A");
        when(mapper.selectList(any())).thenReturn(List.of(activeArtifact));

        service.invalidateArtifactsByResourceId(200L);

        InOrder inOrder = inOrder(mapper);
        inOrder.verify(mapper).selectList(any());
        inOrder.verify(mapper).delete(any());
        inOrder.verify(mapper).updateById(activeArtifact);
        assertThat(activeArtifact.getStatusCd()).isEqualTo("X");
        assertThat(activeArtifact.getUpdateBy()).isEqualTo(100L);
        assertThat(activeArtifact.getUpdateTime()).isNotNull();
    }
}
