package com.iwhalecloud.byai.state.domain.groupchat.forward;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMembershipRow;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.ForwardPlatformPolicy;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import org.junit.jupiter.api.Test;
class GroupChatForwardExecutionContextTest {
  @Test void actualResumeUsesPersistedBindingAndMaintenanceDoesNotBorrowSourcePrivileges() {
    var legacy=mock(com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyGroupChatForwardStore.class);
    var tenant=mock(com.iwhalecloud.byai.manager.domain.tenant.TenantGroupForwardService.class);
    var policy=mock(ForwardPlatformPolicy.class);
    var contexts=new com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardExecutionContextService(legacy,tenant,policy);
    var actor=new ForwardActor(30,1);var locator=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.ForwardOperationLocator(1,100,ForwardBackend.LEGACY);
    var binding=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.OperationBinding(locator,actor,10);
    when(legacy.inspect(locator)).thenReturn(binding);
    assertThat(contexts.resume(locator,ForwardPhase.COPY)).isEqualTo(binding);verify(policy).requireNewWork(actor,ForwardBackend.LEGACY);verifyNoInteractions(tenant);
    clearInvocations(policy);when(legacy.inspectTarget(locator,200)).thenReturn(new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.TargetIdentity(200,20,ForwardState.SUCCEEDED));
    assertThat(contexts.resumeMaintenance(locator,200,ForwardPhase.DELIVERY).target().targetSessionId()).isEqualTo(20);verifyNoInteractions(policy);
    var forged=new TargetLease(100,200,new ForwardActor(31,1),10,20,"worker",1,java.time.Instant.now().plusSeconds(60),ForwardState.COPYING);
    assertThatThrownBy(()->contexts.resume(locator,forged,ForwardPhase.COPY)).hasMessage("FORWARD_LEASE_LOST");verify(legacy,never()).targetWork(any());
  }
  @Test void noHttpThreadContextNeededForResumeAndLegacyOneNeedsNoInventedTenantRow() {
    var users=mock(UserService.class);var enterprises=mock(EnterpriseInfoService.class);var memberships=mock(TenantMembershipMapper.class);
    var user=new Users();user.setState("A");when(users.findById(30L)).thenReturn(user);when(enterprises.findById(1L)).thenReturn(new EnterpriseInfo());
    var policy=new ForwardPlatformPolicy(users,enterprises,memberships,new ObjectMapper());
    assertThatCode(()->policy.requireNewWork(new ForwardActor(30,1),ForwardBackend.LEGACY)).doesNotThrowAnyException();verifyNoInteractions(memberships);
    assertThatThrownBy(()->policy.requireNewWork(new ForwardActor(30,1),ForwardBackend.TENANT)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
  }
  @Test void revokedTenantMembershipBlocksNewWorkAndReadyNeverUsesDevelopmentBypass() {
    var users=mock(UserService.class);var enterprises=mock(EnterpriseInfoService.class);var memberships=mock(TenantMembershipMapper.class);
    var user=new Users();user.setState("A");when(users.findById(30L)).thenReturn(user);when(enterprises.findById(2L)).thenReturn(new EnterpriseInfo());
    var member=new TenantMembershipRow();member.setRole("MEMBER");member.setProvisionStateJson("{\"status\":\"READY\"}");when(memberships.selectActiveMembership(30L,2L)).thenReturn(member);
    var policy=new ForwardPlatformPolicy(users,enterprises,memberships,new ObjectMapper());
    assertThatCode(()->policy.requireNewWork(new ForwardActor(30,2),ForwardBackend.TENANT)).doesNotThrowAnyException();
    member.setProvisionStateJson("{\"status\":\"DELETING\"}");assertThatThrownBy(()->policy.requireNewWork(new ForwardActor(30,2),ForwardBackend.TENANT)).hasMessage("FORWARD_TENANT_NOT_READY");
    assertThatCode(()->policy.requireNewWork(new ForwardActor(30,2),ForwardBackend.LEGACY)).doesNotThrowAnyException();
    when(memberships.selectActiveMembership(30L,2L)).thenReturn(null);assertThatThrownBy(()->policy.requireNewWork(new ForwardActor(30,2),ForwardBackend.LEGACY)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
    user.setState("X");assertThatThrownBy(()->policy.requireNewWork(new ForwardActor(30,1),ForwardBackend.LEGACY)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
  }
}
