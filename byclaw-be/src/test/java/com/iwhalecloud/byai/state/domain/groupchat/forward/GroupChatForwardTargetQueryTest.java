package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupChatForwardQueryMapper;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardTargetQueryService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardEligibility;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardEligibility.GroupIdentity;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.junit.jupiter.api.Test;

class GroupChatForwardTargetQueryTest {
    private final ForwardActor actor = new ForwardActor(30, 1);
    private final SessionService sessions = mock(SessionService.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final GroupChatForwardQueryMapper mapper = mock(GroupChatForwardQueryMapper.class);
    private final GroupChatForwardTargetQueryService service = new GroupChatForwardTargetQueryService(sessions, authorization, mapper);

    @Test
    void tenantOneIsStillStrict() {
        source(1L, null);
        when(mapper.selectTargets(30L, 1L, 1000L, null, 20, 0L)).thenReturn(
            List.of(new ForwardDtos.TargetItem("2001", "team", "1", "4001", "MEMBER")));
        when(mapper.countTargets(30L, 1L, 1000L, null)).thenReturn(1L);
        var page = service.listTargets(actor, 1000);
        assertThat(page.getList()).extracting(ForwardDtos.TargetItem::sessionId).containsExactly("2001");
        assertThat(page.getTotal()).isEqualTo(1);
        assertThat(page.getPageSize()).isEqualTo(20);
        assertThat(page.getTotalPages()).isEqualTo(1);
        assertThat(page.getList().getFirst().enterpriseId()).isEqualTo("1");
    }

    @Test
    void rejectsInvalidPaginationAndKeywordInsteadOfSilentlyDefaulting() {
        for (int[] value : new int[][] {{0,20},{1,0},{1,101},{-1,20}}) {
            assertThatIllegalArgumentException().isThrownBy(() -> service.listTargets(actor, 1000, value[0], value[1], null))
                .withMessage("FORWARD_INVALID_REQUEST");
        }
        assertThatIllegalArgumentException().isThrownBy(() -> service.listTargets(actor, 1000, 1, 20, "x".repeat(101)));
        source(1L, null);
        when(mapper.selectTargets(30L, 1L, 1000L, "%a\\%\\_\\\\%", 100, 100L)).thenReturn(List.of());
        var page = service.listTargets(actor, 1000, 2, 100, " A%_\\ ");
        assertThat(page.getPageNum()).isEqualTo(2);
        assertThat(page.getPageSize()).isEqualTo(100);
        verify(mapper).countTargets(30L, 1L, 1000L, "%a\\%\\_\\\\%");
    }

    @Test
    void rejectsNonmemberSourceBeforeQueryingTargets() {
        when(authorization.requireUserMember(1000L, 30L)).thenThrow(new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE"));
        assertThatIllegalArgumentException().isThrownBy(() -> service.listTargets(actor, 1000));
        verifyNoInteractions(mapper);
    }

    @Test
    void sourceOutsideCurrentEnterpriseReturnsEmptyPage() {
        source(2L, null);
        var page = service.listTargets(actor, 1000, 2, 10, "team");
        assertThat(page.getPageNum()).isEqualTo(2);
        assertThat(page.getPageSize()).isEqualTo(10);
        assertThat(page.getTotal()).isZero();
        assertThat(page.getTotalPages()).isZero();
        assertThat(page.getList()).isEmpty();
        verifyNoInteractions(mapper);
    }

    @Test
    void unresolvedSourceTenantAndClosedSourceFailBeforeTargetQuery() {
        source(null, null);
        assertThatIllegalArgumentException().isThrownBy(() -> service.listTargets(actor, 1000))
            .withMessage("FORWARD_TENANT_UNRESOLVED");
        for (String state : List.of("CLOSED", "GROUP_DISSOLVED", "GROUP_CHAT_ROUTING", "GROUP_CHAT_DISPATCH")) {
            source(1L, state);
            assertThatIllegalArgumentException().isThrownBy(() -> service.listTargets(actor, 1000));
        }
        verifyNoInteractions(mapper);
    }

    @Test
    void reusableEligibilityMatchesTheSharedQualificationFixture() throws Exception {
        var source = new GroupIdentity(1000, 1L, "hs_as", null);
        for (JsonNode row : new ObjectMapper().readTree(Files.readString(Path.of("../byclaw-qa/fixtures/group-chat-forward/eligibility.json")))) {
            var target = new GroupIdentity(row.path("sessionId").asLong(), row.path("enterpriseId").isNull() ? null : row.path("enterpriseId").asLong(), row.path("sessionType").asText(), row.path("state").isNull() ? null : row.path("state").asText());
            if (row.path("eligible").asBoolean()) {
                assertThatCode(() -> ForwardEligibility.requireTarget(actor, source, target, row.path("member").asBoolean())).doesNotThrowAnyException();
            } else {
                assertThatIllegalArgumentException().isThrownBy(() -> ForwardEligibility.requireTarget(actor, source, target, row.path("member").asBoolean()));
            }
        }
        assertThatIllegalArgumentException().isThrownBy(() -> ForwardEligibility.requireSource(actor, source, false));
    }

    private void source(Long tenant, String state) {
        var group = new ByaiSession();
        group.setSessionId(1000L); group.setEnterpriseId(tenant); group.setSessionType("hs_as"); group.setState(state);
        var member = new ByaiSessionMember(); member.setMemObjType("USER"); member.setMemObjId(30L);
        when(sessions.findById(1000L)).thenReturn(group);
        when(authorization.requireUserMember(1000L, 30L)).thenReturn(member);
    }
}
