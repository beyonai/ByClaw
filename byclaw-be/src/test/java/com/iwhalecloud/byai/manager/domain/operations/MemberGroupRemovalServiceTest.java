package com.iwhalecloud.byai.manager.domain.operations;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.operations.MemberGroupRemovalMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoInteractions;

/** 核验自动接任顺序、无候选兜底与确认版本，不需要真实租户。 @author Codex @since 2026-10-27 */
class MemberGroupRemovalServiceTest {
    private final ObjectMapper json = new ObjectMapper();
    private MemberGroupRemovalMapper members;
    private TenantNodeClient nodes;
    private MemberGroupRemovalService service;

    /** 构造当前所有者和真实企业候选人。 */
    @BeforeEach
    void prepare() {
        members = mock(MemberGroupRemovalMapper.class);
        nodes = mock(TenantNodeClient.class);
        service = new MemberGroupRemovalService();
        ReflectionTestUtils.setField(service, "members", members);
        ReflectionTestUtils.setField(service, "tenants", mock(TenantAdminTenantMapper.class));
        ReflectionTestUtils.setField(service, "nodes", nodes);
        ReflectionTestUtils.setField(service, "sessions", mock(SessionService.class));
        ReflectionTestUtils.setField(service, "json", json);
        when(members.actor(1, 7)).thenReturn(Map.of("userId", "7", "name", "当前所有者"));
        when(members.candidates(1)).thenReturn(List.of(
            Map.of("userId", "8", "name", "早期普通成员"),
            Map.of("userId", "10", "name", "后任管理员"),
            Map.of("userId", "11", "name", "先任管理员")));
    }

    /** 管理员优先且按任命先后，不使用早入群的普通成员或已停用成员。 */
    @Test
    void selectsEarliestEligibleAdministratorAndRequiresConfirmation() {
        when(members.snapshot(1, 9)).thenReturn(List.of(
            row("9", "OWNER", 1), row("8", "MEMBER", 2), row("10", "ADMIN", 5),
            row("11", "ADMIN", 4), row("12", "ADMIN", 0)));
        JsonNode plan = service.execute("preview", input(), "7");
        assertThat(plan.path("groupCount").asInt()).isEqualTo(1);
        assertThat(plan.path("transfers").get(0).path("userId").asText()).isEqualTo("11");
        assertThatThrownBy(() -> service.execute("apply", input().put("expectedGroupRevision", plan.path("revision").asText()), "7"))
            .isInstanceOf(OperationsFailure.class);
        verifyNoInteractions(nodes);
    }

    /** 无其他真人候选时阻止移除；名单变更必须重新确认，不能解散或随意指定群外人员。 */
    @Test
    void requiresEligibleMemberAndRejectsChangedPlan() {
        when(members.snapshot(1, 9)).thenReturn(List.of(row("9", "OWNER", 1)));
        assertThatThrownBy(() -> service.execute("preview", input(), "7")).isInstanceOf(OperationsFailure.class);
        when(members.snapshot(1, 9)).thenReturn(List.of(row("9", "OWNER", 1), row("8", "MEMBER", 2)));
        JsonNode plan = service.execute("preview", input(), "7");
        when(members.snapshot(1, 9)).thenReturn(List.of(row("9", "OWNER", 1), row("8", "MEMBER", 2), row("10", "ADMIN", 3)));
        assertThatThrownBy(() -> service.execute("apply", input().put("expectedGroupRevision", plan.path("revision").asText())
            .put("confirmOwnershipTransfer", true), "7")).isInstanceOf(OperationsFailure.class);
    }

    /** 普通成员没有群主交接；权限撤销立即拒绝，不能降级为无群主直接移除。 */
    @Test
    void ordinaryMemberHasNoTransfersAndRevokedActorIsDenied() {
        when(members.snapshot(1, 9)).thenReturn(List.of(row("9", "MEMBER", 1)));
        assertThat(service.execute("preview", input(), "7").path("transfers").isEmpty()).isTrue();
        when(members.actor(1, 7)).thenReturn(null);
        assertThatThrownBy(() -> service.execute("preview", input(), "7")).isInstanceOf(OperationsFailure.class);
    }

    /** @return 服务端当前企业范围 */
    private ObjectNode input() {
        return json.createObjectNode().put("enterpriseId", "1").put("userId", "9");
    }

    /** @return 按任命时间构造的稳定群成员快照 */
    private Map<String, Object> row(String userId, String role, long time) {
        return Map.of("sessionId", "101", "groupName", "研究组", "memberId", "20" + userId,
            "userId", userId, "role", role, "joinedAt", time, "adminSince", Long.toString(time));
    }
}
