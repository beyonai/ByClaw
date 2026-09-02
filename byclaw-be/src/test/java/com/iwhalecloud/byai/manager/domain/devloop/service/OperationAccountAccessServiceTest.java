package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.manager.entity.devloop.OperationAccount;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class OperationAccountAccessServiceTest {

    private OperationAccountService operationAccountService;
    private SsSandboxRecordMapper sandboxRecordMapper;
    private OperationAccountAccessService accessService;

    @BeforeEach
    void setUp() {
        operationAccountService = mock(OperationAccountService.class);
        sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        accessService = new OperationAccountAccessService();
        ReflectionTestUtils.setField(accessService, "operationAccountService", operationAccountService);
        ReflectionTestUtils.setField(accessService, "sandboxRecordMapper", sandboxRecordMapper);
    }

    @Test
    void allowsCurrentUsersAccountInRequestedProject() {
        OperationAccount account = account(100L, 10L);

        assertThat(accessService.canAccess(account, 100L, 10L)).isTrue();
        assertThat(account.getCreateBy()).isEqualTo(10L);
    }

    @Test
    void allowsLegacySharedAccountInRequestedProjectForAuthenticatedUser() {
        OperationAccount account = account(100L, null);

        assertThat(accessService.canAccess(account, 100L, 10L)).isTrue();
        assertThat(account.getCreateBy()).isNull();
    }

    @Test
    void rejectsAnotherUsersPrivateAccount() {
        assertThat(accessService.canAccess(account(100L, 20L), 100L, 10L)).isFalse();
    }

    @Test
    void rejectsAccountFromAnotherProject() {
        assertThat(accessService.canAccess(account(200L, 10L), 100L, 10L)).isFalse();
    }

    @Test
    void allowsGlobalAccountOnlyForItsCreator() {
        assertThat(accessService.canAccess(account(null, 10L), null, 10L)).isTrue();
        assertThat(accessService.canAccess(account(null, 10L), null, 11L)).isFalse();
        assertThat(accessService.canAccess(account(null, null), null, 10L)).isFalse();
    }

    @Test
    void rejectsAccessWhenRequiredIdentityOrProjectDataIsMissing() {
        assertThat(accessService.canAccess(null, 100L, 10L)).isFalse();
        assertThat(accessService.canAccess(account(100L, 10L), null, 10L)).isFalse();
        assertThat(accessService.canAccess(account(null, 10L), 100L, 10L)).isTrue();
        assertThat(accessService.canAccess(account(100L, 10L), 100L, null)).isFalse();
        assertThat(accessService.canAccess(account(100L, null), 100L, null)).isFalse();
    }

    @Test
    void findsEffectiveAccountAndReturnsItOnlyWhenAccessible() {
        OperationAccount accessible = account(100L, 10L);
        when(operationAccountService.findById(1L)).thenReturn(accessible);

        assertThat(accessService.findAccessible(1L, 100L, 10L)).isSameAs(accessible);
        verify(operationAccountService).findById(1L);
    }

    @Test
    void rejectsMissingDeletedOrInaccessibleAccountReturnedByLookup() {
        OperationAccount inaccessible = account(100L, 20L);
        when(operationAccountService.findById(1L)).thenReturn(null);
        when(operationAccountService.findById(2L)).thenReturn(inaccessible);

        assertThat(accessService.findAccessible(1L, 100L, 10L)).isNull();
        assertThat(accessService.findAccessible(2L, 100L, 10L)).isNull();
    }

    @Test
    void rejectsMissingLookupInputsWithoutQuerying() {
        assertThat(accessService.findAccessible(null, 100L, 10L)).isNull();
        assertThat(accessService.findAccessible(1L, null, 10L)).isNull();
        assertThat(accessService.findAccessible(2L, 100L, null)).isNull();

        verifyNoInteractions(operationAccountService);
    }

    @Test
    void delegatesAccessibleAccountListing() {
        List<OperationAccount> expected = List.of(account(100L, 10L));
        when(operationAccountService.listAccessibleByProjectId(100L, 10L)).thenReturn(expected);

        assertThat(accessService.listAccessible(100L, 10L)).isSameAs(expected);
        verify(operationAccountService).listAccessibleByProjectId(100L, 10L);
    }

    @Test
    void returnsEmptyListForMissingProjectOrUserWithoutQuerying() {
        assertThat(accessService.listAccessible(null, 10L)).isEmpty();
        assertThat(accessService.listAccessible(100L, null)).isEmpty();

        verify(operationAccountService, never()).listAccessibleByProjectId(null, 10L);
        verify(operationAccountService, never()).listAccessibleByProjectId(100L, null);
    }

    @Test
    void keepsLegacyAccountsUsableWhenSandboxIsNotConfigured() {
        OperationAccount nullConfig = account(100L, null);
        OperationAccount blankConfig = account(100L, null);
        blankConfig.setConfig("   ");
        OperationAccount missingSandbox = account(100L, null);
        missingSandbox.setConfig("{\"other\":\"value\"}");
        OperationAccount blankSandbox = account(100L, null);
        blankSandbox.setConfig("{\"browserSandboxId\":\"  \"}");

        assertThat(accessService.hasUsableSandbox(nullConfig, null)).isTrue();
        assertThat(accessService.hasUsableSandbox(blankConfig, null)).isTrue();
        assertThat(accessService.hasUsableSandbox(missingSandbox, null)).isTrue();
        assertThat(accessService.hasUsableSandbox(blankSandbox, null)).isTrue();
        assertThat(nullConfig.getCreateBy()).isNull();
        assertThat(blankConfig.getCreateBy()).isNull();
        assertThat(missingSandbox.getCreateBy()).isNull();
        assertThat(blankSandbox.getCreateBy()).isNull();
        verify(sandboxRecordMapper, never()).selectRunningByUser(null);
    }

    @Test
    void acceptsConfiguredSandboxOnlyWhenCurrentUserHasMatchingRunningRecord() {
        OperationAccount account = account(100L, null);
        account.setConfig("{\"browserSandboxId\":\" sandbox-1 \"}");
        SsSandboxRecord different = sandbox("sandbox-2");
        SsSandboxRecord matching = sandbox("sandbox-1");
        when(sandboxRecordMapper.selectRunningByUser("user-1")).thenReturn(List.of(different, matching));

        assertThat(accessService.hasUsableSandbox(account, "user-1")).isTrue();
        assertThat(account.getCreateBy()).isNull();
        verify(sandboxRecordMapper).selectRunningByUser("user-1");
    }

    @Test
    void rejectsConfiguredSandboxWithoutValidUserOrRunningRecords() {
        OperationAccount account = account(100L, 10L);
        account.setConfig("{\"browserSandboxId\":\"sandbox-1\"}");
        when(sandboxRecordMapper.selectRunningByUser("null-records")).thenReturn(null);
        when(sandboxRecordMapper.selectRunningByUser("empty-records")).thenReturn(List.of());
        when(sandboxRecordMapper.selectRunningByUser("different-record"))
            .thenReturn(List.of(sandbox("sandbox-2")));

        assertThat(accessService.hasUsableSandbox(account, null)).isFalse();
        assertThat(accessService.hasUsableSandbox(account, " ")).isFalse();
        assertThat(accessService.hasUsableSandbox(account, "null-records")).isFalse();
        assertThat(accessService.hasUsableSandbox(account, "empty-records")).isFalse();
        assertThat(accessService.hasUsableSandbox(account, "different-record")).isFalse();
        assertThat(account.getCreateBy()).isEqualTo(10L);
        verify(sandboxRecordMapper, never()).selectRunningByUser(null);
        verify(sandboxRecordMapper, never()).selectRunningByUser(" ");
    }

    @Test
    void treatsInvalidConfigAsUnusableWithoutQueryingSandboxRecords() {
        OperationAccount account = account(100L, null);
        account.setConfig("not-json");

        assertThat(accessService.hasUsableSandbox(account, "user-1")).isFalse();
        assertThat(account.getCreateBy()).isNull();
        verify(sandboxRecordMapper, never()).selectRunningByUser("user-1");
    }

    @Test
    void rejectsMissingAccountForSandboxCheck() {
        assertThat(accessService.hasUsableSandbox(null, "user-1")).isFalse();
    }

    private OperationAccount account(Long projectId, Long createBy) {
        OperationAccount account = new OperationAccount();
        account.setProjectId(projectId);
        account.setCreateBy(createBy);
        return account;
    }

    private SsSandboxRecord sandbox(String sandboxId) {
        SsSandboxRecord record = new SsSandboxRecord();
        record.setSandboxId(sandboxId);
        return record;
    }
}
