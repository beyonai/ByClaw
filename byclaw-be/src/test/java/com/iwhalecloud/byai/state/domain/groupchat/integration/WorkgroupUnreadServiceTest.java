package com.iwhalecloud.byai.state.domain.groupchat.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;
import org.junit.jupiter.api.Test;

class WorkgroupUnreadServiceTest {
    @Test
    void countsAllSharedGroupsAndCapsOnlyTheDisplayedBadge() {
        var modes = mock(TenantModeService.class);
        var groups = mock(ByaiGroupChatMentionMapper.class);
        var first = new GroupChatListItemResponse();
        first.setUnreadMessageCount(7);
        var second = new GroupChatListItemResponse();
        second.setUnreadMessageCount(5);
        when(modes.isSharedDataTenant(1)).thenReturn(true);
        when(groups.selectMyGroups(22L, 1L)).thenReturn(List.of(first, second));
        var badge = new WorkgroupUnreadService(modes, mock(TenantNodeClient.class), groups);
        assertThat(badge.count(22, 1)).isEqualTo(12);
        second.setUnreadMessageCount(20000);
        assertThat(badge.count(22, 1)).isEqualTo(9999);
    }

    @Test
    void oldNodeWithoutAnAggregateDoesNotPretendTheFirstPageIsTheTotal() throws Exception {
        var node = mock(TenantNodeClient.class);
        org.mockito.Mockito.doReturn(new com.fasterxml.jackson.databind.ObjectMapper().readTree("{\"list\":[],\"total\":50}"))
            .when(node).request(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.eq("GET"),
                org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.isNull(), org.mockito.ArgumentMatchers.any());
        var badge = new WorkgroupUnreadService(mock(TenantModeService.class), node, mock(ByaiGroupChatMentionMapper.class));
        assertThatThrownBy(() -> badge.count(22, 10)).isInstanceOf(IllegalStateException.class);
    }
}
