package com.iwhalecloud.byai.gateway.channels.service.feishu;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuUserDetail;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class FeishuUserServiceTest {

    private final FeishuUserService service = new FeishuUserService(
            new ObjectMapper(),
            mock(UserService.class),
            mock(UserExternalSystemService.class),
            mock(EnterpriseInfoService.class),
            mock(SuasSuperassistService.class),
            mock(SequenceService.class),
            mock(FeishuTokenService.class),
            mock(FeishuReplyDispatcher.class)
    );

    @Test
    void resolveMobileCandidates_keepsRawMobileAndAddsMainlandChinaLocalNumber() {
        List<String> candidates = ReflectionTestUtils.invokeMethod(
                service,
                "resolveMobileCandidates",
                "+8615920550664"
        );

        assertEquals(List.of("+8615920550664", "8615920550664", "15920550664"), candidates);
    }

    @Test
    void resolveEmployeeNoCandidates_usesUserIdWhenEmployeeNoIsMissing() {
        FeishuUserDetail userDetail = new FeishuUserDetail();
        userDetail.setUserId("0027023754");

        List<String> candidates = ReflectionTestUtils.invokeMethod(
                service,
                "resolveEmployeeNoCandidates",
                userDetail
        );

        assertEquals(List.of("0027023754"), candidates);
    }
}
