package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberQueryQo;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlGenerateRequest;
import com.iwhalecloud.byai.state.domain.resource.qo.ResourceDetailQo;
import java.util.Locale;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

class ResourcePermissionI18nTest extends I18nTestSupport {
    @ParameterizedTest
    @CsvSource(value = {
        "zh-CN|无权查看资源基础信息|无权读取或调试资源内容|无权查看资源内容及成员配置",
        "en-US|You do not have permission to view basic resource information|You do not have permission to read or debug resource content|You do not have permission to view resource content or member settings"
    }, delimiter = '|')
    void permissionFailuresRemainDistinctAndUseTheRequestLocale(
        String language, String metadataMessage, String debugMessage, String membersMessage) {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        SsResource resource = new SsResource();
        resource.setResourceId(42L);
        resource.setResourceBizType("TOOLKIT");
        resource.setViewAuthControlled(true);
        var resources = mock(SsResourceService.class);
        when(resources.findByIdOrCode(42L, null)).thenReturn(resource);
        when(resources.findById(42L)).thenReturn(resource);
        var auth = mock(AuthApplicationService.class);

        var detail = new ResourceApplicationService();
        ReflectionTestUtils.setField(detail, "ssResourceService", resources);
        ReflectionTestUtils.setField(detail, "authApplicationService", auth);
        var query = new ResourceDetailQo();
        query.setResourceId(42L);
        assertThatThrownBy(() -> detail.queryResourceDetail(query))
            .isInstanceOf(IllegalArgumentException.class).hasMessage(metadataMessage);

        var curl = new ResourceCurlService();
        ReflectionTestUtils.setField(curl, "ssResourceService", resources);
        ReflectionTestUtils.setField(curl, "authApplicationService", auth);
        var debug = new ResourceCurlGenerateRequest();
        debug.setResourceId(42L);
        assertThatThrownBy(() -> curl.generateResourceCurl(debug))
            .isInstanceOf(IllegalArgumentException.class).hasMessage(debugMessage);

        var members = spy(new AuthApplicationService());
        var mapper = mock(SsResourceMapper.class);
        when(mapper.selectById(42L)).thenReturn(resource);
        ReflectionTestUtils.setField(members, "ssResourceMapper", mapper);
        doReturn(false).when(members).hasResourceAccessPermission(resource);
        var memberQuery = new ResourceMemberQueryQo();
        memberQuery.setResourceId(42L);
        assertThatThrownBy(() -> members.queryResourceMembers(memberQuery))
            .isInstanceOf(BaseException.class).hasMessage(membersMessage);
    }
}
