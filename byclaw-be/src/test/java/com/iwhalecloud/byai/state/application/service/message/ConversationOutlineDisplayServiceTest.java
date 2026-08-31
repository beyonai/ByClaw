package com.iwhalecloud.byai.state.application.service.message;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.message.entity.ConversationOutlineItem;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class ConversationOutlineDisplayServiceTest {

    private SsResourceService ssResourceService;

    private ConversationOutlineDisplayService service;

    @BeforeEach
    void setUp() {
        ssResourceService = mock(SsResourceService.class);
        service = new ConversationOutlineDisplayService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
    }

    @Test
    void enrich_resolvesDigitalEmployeeFromRelatedResources() {
        ConversationOutlineItem item = item("请找{{DIG_EMPLOYEE_11105921}}处理");
        item.setRelatedResources("{\"resourceList\":[{\"id\":\"DIG_EMPLOYEE_11105921\","
            + "\"resourceId\":\"11105921\",\"resourceName\":\"百应操作员\","
            + "\"resourceType\":\"DIG_EMPLOYEE\"}]}");

        service.enrich(List.of(item));

        assertThat(item.getContent()).isEqualTo("请找{{DIG_EMPLOYEE_11105921}}处理");
        assertThat(item.getDisplayContent()).isEqualTo("请找@百应操作员 处理");
        verifyNoInteractions(ssResourceService);
    }

    @Test
    void enrich_batchLoadsLegacyDigitalEmployeeResources() {
        ConversationOutlineItem item = item("请找{{DIG_EMPLOYEE_11105921}}处理");
        SsResource resource = new SsResource();
        resource.setResourceId(11105921L);
        resource.setResourceBizType("DIG_EMPLOYEE");
        resource.setResourceName("百应操作员");
        when(ssResourceService.findByIdList(Set.of(11105921L))).thenReturn(List.of(resource));

        service.enrich(List.of(item));

        assertThat(item.getDisplayContent()).isEqualTo("请找@百应操作员 处理");
        verify(ssResourceService).findByIdList(Set.of(11105921L));
    }

    @Test
    void enrich_resolvesDigitalEmployeeSkillFromRelatedResources() {
        ConversationOutlineItem item = item("使用{{DIG_EMPLOYEE_11105921#SKILL_22001}}");
        item.setRelatedResources("{\"resourceList\":["
            + "{\"id\":\"DIG_EMPLOYEE_11105921\",\"resourceId\":\"11105921\","
            + "\"resourceName\":\"百应操作员\",\"resourceType\":\"DIG_EMPLOYEE\"},"
            + "{\"id\":\"SKILL_22001\",\"resourceId\":\"22001\","
            + "\"resourceName\":\"周报技能\",\"resourceType\":\"SKILL\"}]}");

        service.enrich(List.of(item));

        assertThat(item.getDisplayContent()).isEqualTo("使用#百应操作员#周报技能");
        verifyNoInteractions(ssResourceService);
    }

    @Test
    void enrich_hidesAnUnresolvedProtocolIdentifier() {
        ConversationOutlineItem item = item("请找{{DIG_EMPLOYEE_legacy-code}}处理");

        service.enrich(List.of(item));

        assertThat(item.getDisplayContent()).isEqualTo("请找@数字员工 处理");
        verifyNoInteractions(ssResourceService);
    }

    private ConversationOutlineItem item(String content) {
        ConversationOutlineItem item = new ConversationOutlineItem();
        item.setMessageId(12L);
        item.setContent(content);
        return item;
    }
}
