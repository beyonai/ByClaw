package com.iwhalecloud.byai.manager.interfaces.controller.skillgroup;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.skillgroup.SkillGroupApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCreateQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCandidatePageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupIdQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupInstallQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupMemberChangeQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupPageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupUpdateQo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupInstallResultVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupVo;
import jakarta.validation.Valid;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

class SkillGroupControllerTest {

    private static final Map<String, EndpointContract> ENDPOINTS = endpoints();

    @Test
    void exposesExactlyTenValidatedPostEndpointsWithMutationAuditLogs() throws Exception {
        assertThat(SkillGroupController.class).hasAnnotation(RestController.class);
        assertThat(SkillGroupController.class.getAnnotation(RequestMapping.class).value())
                .containsExactly("/skillGroup");
        assertThat(SkillGroupController.class.getDeclaredMethods()).hasSize(10);

        for (Map.Entry<String, EndpointContract> entry : ENDPOINTS.entrySet()) {
            Method method = SkillGroupController.class.getDeclaredMethod(
                    entry.getKey(), entry.getValue().requestType());
            assertThat(method.getAnnotation(PostMapping.class).value())
                    .as(entry.getKey() + " endpoint path")
                    .containsExactly(entry.getValue().path());

            Parameter parameter = method.getParameters()[0];
            assertThat(parameter.isAnnotationPresent(Valid.class)).isTrue();
            assertThat(parameter.isAnnotationPresent(RequestBody.class)).isTrue();
            assertThat(parameter.getAnnotation(RequestBody.class).required()).isTrue();

            if (entry.getValue().mutation()) {
                assertThat(method.isAnnotationPresent(ManageLogAnnotation.class)).isTrue();
            }
            else {
                assertThat(method.isAnnotationPresent(ManageLogAnnotation.class)).isFalse();
            }
        }
    }

    @Test
    void delegatesEachEndpointOnceAndWrapsServiceResultsWithLocalizedMessages() {
        SkillGroupApplicationService service = mock(SkillGroupApplicationService.class);
        SkillGroupController controller = new SkillGroupController(service);
        SkillGroupCreateQo createQo = new SkillGroupCreateQo();
        SkillGroupUpdateQo updateQo = new SkillGroupUpdateQo();
        SkillGroupIdQo idQo = new SkillGroupIdQo();
        SkillGroupPageQo pageQo = new SkillGroupPageQo();
        SkillGroupCandidatePageQo candidateQo = new SkillGroupCandidatePageQo();
        SkillGroupMemberChangeQo addQo = new SkillGroupMemberChangeQo();
        SkillGroupMemberChangeQo removeQo = new SkillGroupMemberChangeQo();
        SkillGroupInstallQo installQo = new SkillGroupInstallQo();
        SkillGroupInstallQo uninstallQo = new SkillGroupInstallQo();
        SkillGroupVo created = new SkillGroupVo();
        SkillGroupVo updated = new SkillGroupVo();
        SkillGroupVo detail = new SkillGroupVo();
        @SuppressWarnings("unchecked")
        PageInfo<SkillGroupVo> page = mock(PageInfo.class);
        @SuppressWarnings("unchecked")
        PageInfo<SkillGroupMemberVo> candidates = mock(PageInfo.class);
        SkillGroupInstallResultVo installed = new SkillGroupInstallResultVo();
        SkillGroupInstallResultVo uninstalled = new SkillGroupInstallResultVo();
        MessageSource originalMessageSource =
                (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        MessageSource messageSource = mock(MessageSource.class);

        when(service.create(createQo)).thenReturn(created);
        when(service.update(updateQo)).thenReturn(updated);
        when(service.page(pageQo)).thenReturn(page);
        when(service.pageMemberCandidates(candidateQo)).thenReturn(candidates);
        when(service.detail(idQo)).thenReturn(detail);
        when(service.install(installQo)).thenReturn(installed);
        when(service.uninstall(uninstallQo)).thenReturn(uninstalled);
        when(messageSource.getMessage(anyString(), any(Object[].class), any(Locale.class)))
                .thenAnswer(invocation -> invocation.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);

        try {
            assertResponse(controller.create(createQo), "skillgroup.create.success", created);
            assertResponse(controller.update(updateQo), "skillgroup.update.success", updated);
            assertResponse(controller.delete(idQo), "skillgroup.delete.success", null);
            assertResponse(controller.page(pageQo), "skillgroup.page.query.success", page);
            assertResponse(controller.pageMemberCandidates(candidateQo),
                    "skillgroup.member.candidates.query.success", candidates);
            assertResponse(controller.detail(idQo), "skillgroup.detail.query.success", detail);
            assertResponse(controller.addMembers(addQo), "skillgroup.member.add.success", null);
            assertResponse(controller.removeMembers(removeQo), "skillgroup.member.remove.success", null);
            assertResponse(controller.install(installQo), "skillgroup.install.success", installed);
            assertResponse(controller.uninstall(uninstallQo), "skillgroup.uninstall.success", uninstalled);
        }
        finally {
            ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        }

        verify(service, times(1)).create(createQo);
        verify(service, times(1)).update(updateQo);
        verify(service, times(1)).delete(idQo);
        verify(service, times(1)).page(pageQo);
        verify(service, times(1)).pageMemberCandidates(candidateQo);
        verify(service, times(1)).detail(idQo);
        verify(service, times(1)).addMembers(addQo);
        verify(service, times(1)).removeMembers(removeQo);
        verify(service, times(1)).install(installQo);
        verify(service, times(1)).uninstall(uninstallQo);
        verifyNoMoreInteractions(service);
    }

    private static void assertResponse(ResponseUtil<?> response, String message, Object data) {
        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        assertThat(response.getMsg()).isEqualTo(message);
        assertThat(response.getData()).isSameAs(data);
    }

    private static Map<String, EndpointContract> endpoints() {
        Map<String, EndpointContract> endpoints = new LinkedHashMap<>();
        endpoints.put("create", new EndpointContract("/create", SkillGroupCreateQo.class, true,
                "skillgroup.create.success"));
        endpoints.put("update", new EndpointContract("/update", SkillGroupUpdateQo.class, true,
                "skillgroup.update.success"));
        endpoints.put("delete", new EndpointContract("/delete", SkillGroupIdQo.class, true,
                "skillgroup.delete.success"));
        endpoints.put("page", new EndpointContract("/page", SkillGroupPageQo.class, false,
                "skillgroup.page.query.success"));
        endpoints.put("detail", new EndpointContract("/detail", SkillGroupIdQo.class, false,
                "skillgroup.detail.query.success"));
        endpoints.put("pageMemberCandidates", new EndpointContract("/member/candidates",
                SkillGroupCandidatePageQo.class, false, "skillgroup.member.candidates.query.success"));
        endpoints.put("addMembers", new EndpointContract("/member/add", SkillGroupMemberChangeQo.class, true,
                "skillgroup.member.add.success"));
        endpoints.put("removeMembers", new EndpointContract("/member/remove", SkillGroupMemberChangeQo.class, true,
                "skillgroup.member.remove.success"));
        endpoints.put("install", new EndpointContract("/install", SkillGroupInstallQo.class, true,
                "skillgroup.install.success"));
        endpoints.put("uninstall", new EndpointContract("/uninstall", SkillGroupInstallQo.class, true,
                "skillgroup.uninstall.success"));
        return endpoints;
    }

    private record EndpointContract(String path, Class<?> requestType, boolean mutation, String messageKey) {}
}
