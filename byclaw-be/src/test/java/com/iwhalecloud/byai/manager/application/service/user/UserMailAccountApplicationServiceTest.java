package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;

import java.util.List;
import java.util.Date;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.users.MailServerConfigDTO;
import com.iwhalecloud.byai.manager.dto.users.UserMailAccountDTO;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.domain.mail.MailAccountProjectionService;
import com.iwhalecloud.byai.manager.domain.mail.MailAccountMetadataCacheService;
import com.iwhalecloud.byai.manager.domain.mail.MailAccountMetadataCacheTransactionService;
import com.iwhalecloud.byai.manager.domain.mail.MailConnectionCheckLeaseService;
import com.iwhalecloud.byai.manager.domain.mail.MailConnectionCheckAdmissionService;
import com.iwhalecloud.byai.manager.domain.mail.MailRuntimeProbe;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.mail.MailPrivateParamStore;
import com.iwhalecloud.byai.manager.vo.users.UserMailAccountVO;
import com.iwhalecloud.byai.manager.vo.users.MailConnectionCheckResultVO;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class UserMailAccountApplicationServiceTest {

    private MailPrivateParamStore mapper;
    private UserMailAccountApplicationService service;
    private MailAccountProjectionService projectionService;
    private MailAccountMetadataCacheService metadataCacheService;
    private MailRuntimeProbe runtimeProbe;
    private MailConnectionCheckLeaseService checkLeaseService;
    private MailConnectionCheckAdmissionService admissionService;
    private MailConnectionCheckAdmissionService.Admission admission;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        if (TableInfoHelper.getTableInfo(UserMailAccount.class) == null) {
            TableInfoHelper.initTableInfo(
                new MapperBuilderAssistant(new MybatisConfiguration(), ""), UserMailAccount.class);
        }
        mapper = mock(MailPrivateParamStore.class);
        service = new UserMailAccountApplicationService();
        ReflectionTestUtils.setField(service, "mailPrivateParamStore", mapper);
        doAnswer(call -> {
            UserMailAccount account = call.getArgument(0);
            account.setAccountId(8001L);
            account.setConnectorId(8001L);
            return null;
        }).when(mapper).initialize(any());
        projectionService = mock(MailAccountProjectionService.class);
        ReflectionTestUtils.setField(service, "mailAccountProjectionService", projectionService);
        metadataCacheService = mock(MailAccountMetadataCacheService.class);
        ReflectionTestUtils.setField(service, "mailAccountMetadataCacheService", metadataCacheService);
        runtimeProbe = mock(MailRuntimeProbe.class);
        ReflectionTestUtils.setField(service, "mailRuntimeProbe", runtimeProbe);
        checkLeaseService = mock(MailConnectionCheckLeaseService.class);
        ReflectionTestUtils.setField(service, "mailConnectionCheckLeaseService", checkLeaseService);
        admissionService = mock(MailConnectionCheckAdmissionService.class);
        admission = mock(MailConnectionCheckAdmissionService.Admission.class);
        when(admissionService.acquire(1001L)).thenReturn(admission);
        ReflectionTestUtils.setField(service, "mailConnectionCheckAdmissionService", admissionService);
        when(mapper.active(any())).thenReturn(List.of());

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        loginInfo.setUserCode("tester");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void knownProviderFillsServersAndPersistsCatalogAuthentication() {
        UserMailAccountDTO request = baseRequest("qq", "qq-app-password");

        UserMailAccountVO result = service.save(request);

        ArgumentCaptor<UserMailAccount> saved = ArgumentCaptor.forClass(UserMailAccount.class);
        verify(mapper).save(saved.capture());
        assertThat(saved.getValue().getProviderCode()).isEqualTo("qq");
        assertThat(saved.getValue().getAuthType()).isEqualTo("APP_PASSWORD");
        assertThat(saved.getValue().getImapHost()).isEqualTo("imap.qq.com");
        assertThat(saved.getValue().getImapPort()).isEqualTo(993);
        assertThat(saved.getValue().getSmtpHost()).isEqualTo("smtp.qq.com");
        assertThat(saved.getValue().getSmtpPort()).isEqualTo(465);
        assertThat(result.getCapabilities()).containsExactly(
            "list", "get", "search", "downloadAttachment", "send", "reply"
        );
        assertThat(result.getCapabilityStatus().get("delete")).isEqualTo("CONDITIONAL_MOVE_OR_UIDPLUS");
        assertThat(result.getSetupRequirements()).containsExactly("ENABLE_IMAP_SMTP", "USE_AUTHORIZATION_CODE");
    }

    @Test
    void checkRequiresOwnedActiveAccountAndPersistsSafeStatusWithLastCheckTime() {
        UserMailAccount existing = existingQqAccount();
        existing.setUpdateTime(new Date(1_000L));
        when(mapper.find(any(), any())).thenReturn(existing);
        MailConnectionCheckLeaseService.Lease lease = new MailConnectionCheckLeaseService.Lease(7001L, "owner");
        when(checkLeaseService.tryAcquire(7001L)).thenReturn(Optional.of(lease));
        when(runtimeProbe.check(1001L, 7001L)).thenReturn(new MailRuntimeProbe.Result(
            MailRuntimeProbe.Status.PARTIAL, 12L, Map.ofEntries(
                Map.entry("list", "YES"),
                Map.entry("get", "YES"),
                Map.entry("search", "CONDITIONAL_SERVER_SEARCH"),
                Map.entry("downloadAttachment", "YES"),
                Map.entry("send", "YES"),
                Map.entry("reply", "YES"),
                Map.entry("delete", "NO")), "safe"));
        when(mapper.updateCheck(any(), any(), any())).thenReturn(true);

        MailConnectionCheckResultVO result = service.check(7001L);

        assertThat(result.getConnectionState()).isEqualTo("READY");
        assertThat(result.getStatus()).isEqualTo("PARTIAL");
        assertThat(result.getLastCheckTime()).isNotNull();
        assertThat(result.getCapabilityStatus()).containsExactly(
            org.assertj.core.data.MapEntry.entry("list", "YES"),
            org.assertj.core.data.MapEntry.entry("get", "YES"),
            org.assertj.core.data.MapEntry.entry("search", "CONDITIONAL_SERVER_SEARCH"),
            org.assertj.core.data.MapEntry.entry("downloadAttachment", "YES"),
            org.assertj.core.data.MapEntry.entry("send", "YES"),
            org.assertj.core.data.MapEntry.entry("reply", "YES"),
            org.assertj.core.data.MapEntry.entry("delete", "NO"));
        assertThatThrownBy(() -> result.getCapabilityStatus().put("subject", "message-secret"))
            .isInstanceOf(UnsupportedOperationException.class);
        ArgumentCaptor<UserMailAccount> checked = ArgumentCaptor.forClass(UserMailAccount.class);
        verify(mapper).updateCheck(checked.capture(), org.mockito.ArgumentMatchers.eq("NORMAL"),
            org.mockito.ArgumentMatchers.eq(new Date(1_000L)));
        assertThat(checked.getValue().getStatus()).isEqualTo("PARTIAL");
        assertThat(checked.getValue().getLastCheckTime()).isEqualTo(result.getLastCheckTime());
        verify(checkLeaseService).assertOwnedAndRenew(lease);
        verify(admission).assertOwnedAndRenew();
        verify(admission).close();
        verify(checkLeaseService).release(lease);
    }

    @Test
    void checkRejectsMissingOwnershipAndConcurrentLeaseBeforeRunningRuntime() {
        when(mapper.find(any(), any())).thenReturn(null);
        assertThatThrownBy(() -> service.check(7001L))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("不存在");
        verify(runtimeProbe, never()).check(any(), any());

        UserMailAccount deleted = existingQqAccount();
        deleted.setStatus("DELETED");
        when(mapper.find(any(), any())).thenReturn(deleted);
        assertThatThrownBy(() -> service.check(7001L))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("不存在");
        verify(checkLeaseService, never()).tryAcquire(7001L);

        UserMailAccount projectionFailed = existingQqAccount();
        projectionFailed.setStatus("PROJECTION_FAILED");
        when(mapper.find(any(), any())).thenReturn(projectionFailed);
        assertThatThrownBy(() -> service.check(7001L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageNotContaining("projection");
        verify(checkLeaseService, never()).tryAcquire(7001L);

        UserMailAccount existing = existingQqAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        when(checkLeaseService.tryAcquire(7001L)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.check(7001L))
            .isInstanceOf(MailConnectionCheckAdmissionService.BusyException.class)
            .hasMessageNotContaining("owner");
        verify(runtimeProbe, never()).check(any(), any());
    }

    @Test
    void checkAlwaysReleasesLeaseAndRejectsStalePersistence() {
        UserMailAccount existing = existingQqAccount();
        existing.setUpdateTime(new Date(1_000L));
        when(mapper.find(any(), any())).thenReturn(existing);
        MailConnectionCheckLeaseService.Lease lease = new MailConnectionCheckLeaseService.Lease(7001L, "owner");
        when(checkLeaseService.tryAcquire(7001L)).thenReturn(Optional.of(lease));
        when(runtimeProbe.check(1001L, 7001L)).thenReturn(new MailRuntimeProbe.Result(
            MailRuntimeProbe.Status.NORMAL, 5L, Map.of("list", "YES"), null));
        when(mapper.updateCheck(any(), any(), any())).thenReturn(false);

        assertThatThrownBy(() -> service.check(7001L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageNotContaining("owner");
        verify(checkLeaseService).release(lease);
    }

    @Test
    void checkDiscardsResultWhenLeaseExpiredOrHasANewOwner() {
        UserMailAccount existing = existingQqAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        MailConnectionCheckLeaseService.Lease lease = new MailConnectionCheckLeaseService.Lease(7001L, "old-owner");
        when(checkLeaseService.tryAcquire(7001L)).thenReturn(Optional.of(lease));
        when(runtimeProbe.check(1001L, 7001L)).thenReturn(new MailRuntimeProbe.Result(
            MailRuntimeProbe.Status.NORMAL, 5L, Map.of(), null));
        doThrow(new MailConnectionCheckLeaseService.LeaseLostException())
            .when(checkLeaseService).assertOwnedAndRenew(lease);

        assertThatThrownBy(() -> service.check(7001L))
            .isInstanceOf(MailConnectionCheckLeaseService.LeaseLostException.class)
            .hasMessageNotContaining("old-owner");
        verify(mapper, never()).updateCheck(any(), any(), any());
        verify(checkLeaseService).release(lease);
    }

    @Test
    void checkReleasesLeaseWhenProbeUnexpectedlyFailsWithoutPersisting() {
        UserMailAccount existing = existingQqAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        MailConnectionCheckLeaseService.Lease lease = new MailConnectionCheckLeaseService.Lease(7001L, "owner");
        when(checkLeaseService.tryAcquire(7001L)).thenReturn(Optional.of(lease));
        when(runtimeProbe.check(1001L, 7001L)).thenThrow(new IllegalStateException("process-secret"));

        assertThatThrownBy(() -> service.check(7001L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageNotContaining("process-secret");
        verify(mapper, never()).updateCheck(any(), any(), any());
        verify(checkLeaseService).release(lease);
    }

    @Test
    void checkMapsAuthenticationAndUnavailableStatusesToFailedConnectionState() {
        UserMailAccount existing = existingQqAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        MailConnectionCheckLeaseService.Lease lease = new MailConnectionCheckLeaseService.Lease(7001L, "owner");
        when(checkLeaseService.tryAcquire(7001L)).thenReturn(Optional.of(lease));
        when(mapper.updateCheck(any(), any(), any())).thenReturn(true);
        when(runtimeProbe.check(1001L, 7001L))
            .thenReturn(new MailRuntimeProbe.Result(
                MailRuntimeProbe.Status.AUTH_REQUIRED, null, Map.of(), "safe"))
            .thenReturn(new MailRuntimeProbe.Result(
                MailRuntimeProbe.Status.UNAVAILABLE, null, Map.of(), "safe"));

        MailConnectionCheckResultVO authentication = service.check(7001L);
        existing.setStatus("NORMAL"); // Independent check scenario after credentials have been restored.
        MailConnectionCheckResultVO unavailable = service.check(7001L);

        assertThat(authentication.getConnectionState()).isEqualTo("FAILED");
        assertThat(authentication.getStatus()).isEqualTo("AUTH_REQUIRED");
        assertThat(authentication.getCapabilityStatus()).isEmpty();
        assertThat(unavailable.getConnectionState()).isEqualTo("FAILED");
        assertThat(unavailable.getStatus()).isEqualTo("UNAVAILABLE");
        assertThat(unavailable.getCapabilityStatus()).isEmpty();
    }

    @Test
    void browserSsoAccountCanRunItsFirstCheckAfterExternalLogin() {
        UserMailAccountDTO request = baseRequest("iwhalecloud", null);
        service.save(request);
        ArgumentCaptor<UserMailAccount> saved = ArgumentCaptor.forClass(UserMailAccount.class);
        verify(mapper).save(saved.capture());
        assertThat(saved.getValue().getStatus()).isEqualTo("AUTH_REQUIRED");
        when(mapper.find(any(), any())).thenReturn(saved.getValue());
        MailConnectionCheckLeaseService.Lease lease =
            new MailConnectionCheckLeaseService.Lease(saved.getValue().getAccountId(), "owner");
        when(checkLeaseService.tryAcquire(saved.getValue().getAccountId())).thenReturn(Optional.of(lease));
        when(runtimeProbe.check(1001L, saved.getValue().getAccountId())).thenReturn(new MailRuntimeProbe.Result(
            MailRuntimeProbe.Status.NORMAL, 5L, Map.of(), null));
        when(mapper.updateCheck(any(), any(), any())).thenReturn(true);

        assertThat(service.check(saved.getValue().getAccountId()).getStatus()).isEqualTo("NORMAL");
    }

    @Test
    void kerberosAccountCanRunCheckFromAuthRequiredButPasswordAccountCannot() {
        UserMailAccount kerberos = existingQqAccount();
        kerberos.setProviderCode("iwhalecloud");
        kerberos.setAuthType("KERBEROS");
        kerberos.setStatus("AUTH_REQUIRED");
        when(mapper.find(any(), any())).thenReturn(kerberos);
        MailConnectionCheckLeaseService.Lease lease =
            new MailConnectionCheckLeaseService.Lease(kerberos.getAccountId(), "owner");
        when(checkLeaseService.tryAcquire(kerberos.getAccountId())).thenReturn(Optional.of(lease));
        when(runtimeProbe.check(1001L, kerberos.getAccountId())).thenReturn(new MailRuntimeProbe.Result(
            MailRuntimeProbe.Status.NORMAL, 5L, Map.of(), null));
        when(mapper.updateCheck(any(), any(), any())).thenReturn(true);

        assertThat(service.check(kerberos.getAccountId()).getStatus()).isEqualTo("NORMAL");

        UserMailAccount gmailPassword = existingQqAccount();
        gmailPassword.setProviderCode("gmail");
        gmailPassword.setAuthType("APP_PASSWORD");
        gmailPassword.setStatus("AUTH_REQUIRED");
        when(mapper.find(any(), any())).thenReturn(gmailPassword);
        assertThatThrownBy(() -> service.check(gmailPassword.getAccountId()))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("尚未准备好");
    }

    @Test
    void nonIWhaleLegacyBrowserSsoAndKerberosAccountsCannotBypassAuthRequired() {
        UserMailAccount malformedBrowser = existingQqAccount();
        malformedBrowser.setProviderCode("gmail");
        malformedBrowser.setAuthType("BROWSER_SSO");
        malformedBrowser.setStatus("AUTH_REQUIRED");
        when(mapper.find(any(), any())).thenReturn(malformedBrowser);

        assertThatThrownBy(() -> service.check(malformedBrowser.getAccountId()))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("尚未准备好");

        UserMailAccount malformedKerberos = existingQqAccount();
        malformedKerberos.setProviderCode("custom-imap");
        malformedKerberos.setAuthType("KERBEROS");
        malformedKerberos.setStatus("AUTH_REQUIRED");
        when(mapper.find(any(), any())).thenReturn(malformedKerberos);

        assertThatThrownBy(() -> service.check(malformedKerberos.getAccountId()))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("尚未准备好");
        verify(checkLeaseService, never()).tryAcquire(malformedBrowser.getAccountId());
    }

    @Test
    void iWhaleCloudAcceptsExplicitNtlmEnterpriseAuthentication() {
        UserMailAccountDTO request = baseRequest("iwhalecloud", "enterprise-secret");
        request.setAuthType("NTLM");

        service.save(request);

        ArgumentCaptor<UserMailAccount> saved = ArgumentCaptor.forClass(UserMailAccount.class);
        verify(mapper).save(saved.capture());
        assertThat(saved.getValue().getAuthType()).isEqualTo("NTLM");
        assertThat(saved.getValue().getAuthCodeCipher()).isNotBlank();
    }

    @Test
    void rejectsIncompleteCustomServersAndMismatchedAuthenticationType() {
        UserMailAccountDTO missingServers = baseRequest(null, "secret-value");
        assertThatThrownBy(() -> service.save(missingServers))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("IMAP");

        UserMailAccountDTO mismatched = baseRequest("qq", "secret-value");
        mismatched.setAuthType("OAUTH2");
        assertThatThrownBy(() -> service.save(mismatched))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("authType");
    }

    @Test
    void customImapRejectsMissingEncryption() {
        UserMailAccountDTO request = customRequest("secret-value");
        request.getImap().setEncryption(null);

        assertThatThrownBy(() -> service.save(request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("IMAP")
            .hasMessageContaining("加密方式");
    }

    @Test
    void customImapRejectsUnsupportedEncryption() {
        UserMailAccountDTO request = customRequest("secret-value");
        request.getImap().setEncryption("plain-text");

        assertThatThrownBy(() -> service.save(request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("IMAP")
            .hasMessageContaining("加密方式");
    }

    @Test
    void customSmtpRejectsMissingEncryption() {
        UserMailAccountDTO request = customRequest("secret-value");
        request.getSmtp().setEncryption(" ");

        assertThatThrownBy(() -> service.save(request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("SMTP")
            .hasMessageContaining("加密方式");
    }

    @Test
    void customSmtpRejectsUnsupportedEncryption() {
        UserMailAccountDTO request = customRequest("secret-value");
        request.getSmtp().setEncryption("auto");

        assertThatThrownBy(() -> service.save(request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("SMTP")
            .hasMessageContaining("加密方式");
    }

    @Test
    void customServersRejectPlaintextNoneEncryption() {
        UserMailAccountDTO imapNone = customRequest("secret-value");
        imapNone.getImap().setEncryption("none");
        assertThatThrownBy(() -> service.save(imapNone))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("IMAP")
            .hasMessageContaining("加密方式");

        UserMailAccountDTO smtpNone = customRequest("secret-value");
        smtpNone.getSmtp().setEncryption("NONE");
        assertThatThrownBy(() -> service.save(smtpNone))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("SMTP")
            .hasMessageContaining("加密方式");
    }

    @Test
    void oauthRejectsAuthCodeButCanBeCreatedPendingAuthorization() {
        UserMailAccountDTO withSecret = baseRequest("gmail", "must-not-be-accepted");
        assertThatThrownBy(() -> service.save(withSecret))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("authCode");

        UserMailAccountDTO withoutSecret = baseRequest("gmail", null);
        UserMailAccountVO result = service.save(withoutSecret);

        ArgumentCaptor<UserMailAccount> saved = ArgumentCaptor.forClass(UserMailAccount.class);
        verify(mapper).save(saved.capture());
        assertThat(saved.getValue().getStatus()).isEqualTo("AUTH_REQUIRED");
        assertThat(saved.getValue().getAuthCodeCipher()).isNull();
        assertThat(result.getConnectionState()).isEqualTo("FAILED");
    }

    @Test
    void oauthSaveAutomaticallyPersistsAnAvailableOwnedBinding() {
        doAnswer(invocation -> {
            UserMailAccount account = invocation.getArgument(0);
            account.setCredentialRef("owned-ref");
            account.setStatus("NORMAL");
            return null;
        }).when(projectionService).bindAvailableOAuth(any(UserMailAccount.class));

        UserMailAccountVO result = service.save(baseRequest("gmail", null));

        ArgumentCaptor<UserMailAccount> saved = ArgumentCaptor.forClass(UserMailAccount.class);
        verify(mapper).save(saved.capture());
        assertThat(saved.getValue().getCredentialRef()).isEqualTo("owned-ref");
        assertThat(result.getStatus()).isEqualTo("NORMAL");
    }

    @Test
    void passwordAndApiTokenProvidersRequireSecretOnCreate() {
        assertThatThrownBy(() -> service.save(baseRequest("qq", null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("授权码");
        assertThatThrownBy(() -> service.save(baseRequest("fastmail", null)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("授权码");
    }

    @Test
    void blankSecretOnEditKeepsExistingCiphertext() {
        UserMailAccount existing = existingCustomAccount();
        existing.setAuthCodeCipher("existing-ciphertext");
        existing.setAuthCodeLast4("1234");
        when(mapper.find(any(), any())).thenReturn(existing);
        UserMailAccountDTO edit = customRequest(null);
        edit.setAccountId(7001L);

        service.save(edit);

        assertThat(existing.getAuthCodeCipher()).isEqualTo("existing-ciphertext");
        assertThat(existing.getAuthCodeLast4()).isEqualTo("1234");
    }

    @Test
    void sameProviderFreshSecretClearsProbeFailureAndAllowsSuccessfulRecheck() {
        UserMailAccount existing = existingQqAccount();
        existing.setStatus("AUTH_REQUIRED");
        existing.setAuthCodeCipher(Sm4Util.encrypt("old-secret"));
        when(mapper.find(any(), any())).thenReturn(existing);
        when(mapper.updateCheck(any(), any(), any())).thenReturn(true);
        UserMailAccountDTO edit = baseRequest("qq", "new-secret");
        edit.setAccountId(existing.getAccountId());

        UserMailAccountVO saved = service.save(edit);

        assertThat(saved.getStatus()).isEqualTo("NORMAL");
        assertThat(existing.getCredentialRef()).isNull();
        verify(projectionService).sync(1001L, Set.of(existing.getAccountId()));

        MailConnectionCheckLeaseService.Lease lease =
            new MailConnectionCheckLeaseService.Lease(existing.getAccountId(), "owner");
        when(checkLeaseService.tryAcquire(existing.getAccountId())).thenReturn(Optional.of(lease));
        when(runtimeProbe.check(1001L, existing.getAccountId())).thenReturn(new MailRuntimeProbe.Result(
            MailRuntimeProbe.Status.NORMAL, 1L, Map.of(), null));

        assertThat(service.check(existing.getAccountId()).getStatus()).isEqualTo("NORMAL");
    }

    @Test
    void noSecretMaskedOrUnchangedSecretEditRetainsProbeFailureState() {
        for (String submitted : java.util.Arrays.asList(null, "********", "abc****1234", "same-secret")) {
            UserMailAccount existing = existingQqAccount();
            existing.setStatus("AUTH_REQUIRED");
            existing.setAuthCodeCipher(Sm4Util.encrypt("same-secret"));
            when(mapper.find(any(), any())).thenReturn(existing);
            UserMailAccountDTO edit = baseRequest("qq", submitted);
            edit.setAccountId(existing.getAccountId());

            assertThat(service.save(edit).getStatus()).isEqualTo("AUTH_REQUIRED");
            assertThat(Sm4Util.decrypt(existing.getAuthCodeCipher())).isEqualTo("same-secret");
        }
    }

    @Test
    void freshSecretDoesNotClearDurableProjectionFailure() {
        UserMailAccount existing = existingQqAccount();
        existing.setStatus("PROJECTION_FAILED");
        existing.setAuthCodeCipher(Sm4Util.encrypt("old-secret"));
        when(mapper.find(any(), any())).thenReturn(existing);
        UserMailAccountDTO edit = baseRequest("qq", "new-secret");
        edit.setAccountId(existing.getAccountId());

        assertThat(service.save(edit).getStatus()).isEqualTo("PROJECTION_FAILED");
    }

    @Test
    void editWithoutProviderKeepsExistingProviderAndCatalogServers() {
        UserMailAccount existing = existingQqAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        UserMailAccountDTO edit = baseRequest(null, null);
        edit.setAccountId(existing.getAccountId());

        UserMailAccountVO result = service.save(edit);

        assertThat(result.getProviderCode()).isEqualTo("qq");
        assertThat(result.getAuthType()).isEqualTo("APP_PASSWORD");
        assertThat(result.getImap().getHost()).isEqualTo("imap.qq.com");
        assertThat(result.getSmtp().getHost()).isEqualTo("smtp.qq.com");
        assertThat(existing.getStatus()).isEqualTo("NORMAL");
        assertThat(existing.getCredentialRef()).isEqualTo("existing-reference");
    }

    @Test
    @SuppressWarnings({ "rawtypes", "unchecked" })
    void switchingQqToGmailRequiresSeparateAccount() {
        UserMailAccount existing = existingQqAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        UserMailAccountDTO edit = baseRequest("gmail", null);
        edit.setAccountId(existing.getAccountId());
        assertThatThrownBy(() -> service.save(edit)).isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("独立管理");
        verify(mapper, never()).save(any());
    }

    @Test
    void switchingGmailToQqRequiresSeparateAccount() {
        UserMailAccount existing = existingGmailAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        UserMailAccountDTO edit = baseRequest("qq", "fresh-secret");
        edit.setAccountId(existing.getAccountId());
        assertThatThrownBy(() -> service.save(edit)).isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("独立管理");
        verify(mapper, never()).save(any());
    }

    @Test
    void iWhaleCloudNtlmAndKerberosTransitionsNeverReuseStaleSecret() {
        UserMailAccount existing = existingQqAccount();
        existing.setProviderCode("iwhalecloud");
        existing.setAuthType("NTLM");
        existing.setAuthCodeCipher("stale-ciphertext");
        existing.setAuthCodeLast4("old4");
        when(mapper.find(any(), any())).thenReturn(existing);

        UserMailAccountDTO kerberos = baseRequest("iwhalecloud", null);
        kerberos.setAccountId(existing.getAccountId());
        kerberos.setAuthType("KERBEROS");
        service.save(kerberos);
        assertThat(existing.getAuthType()).isEqualTo("KERBEROS");
        assertThat(existing.getAuthCodeCipher()).isNull();
        assertThat(existing.getAuthCodeLast4()).isNull();

        existing.setAuthCodeCipher("must-not-be-reused");
        UserMailAccountDTO missingNtlm = baseRequest("iwhalecloud", null);
        missingNtlm.setAccountId(existing.getAccountId());
        missingNtlm.setAuthType("NTLM");
        assertThatThrownBy(() -> service.save(missingNtlm))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("授权码");

        UserMailAccountDTO freshNtlm = baseRequest("iwhalecloud", "fresh-ntlm-secret");
        freshNtlm.setAccountId(existing.getAccountId());
        freshNtlm.setAuthType("NTLM");
        service.save(freshNtlm);
        assertThat(existing.getAuthCodeCipher()).isNotBlank().isNotEqualTo("must-not-be-reused");
        assertThat(existing.getAuthCodeLast4()).isEqualTo("cret");
    }

    @Test
    void saveRefreshesRedisOnlyAfterTransactionCommit() {
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.save(baseRequest("qq", "secret-value"));

            verify(projectionService, never()).sync(any(), any());
            List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
            assertThat(synchronizations).hasSize(1);
            synchronizations.forEach(TransactionSynchronization::afterCommit);

            verify(projectionService).sync(1001L, Set.of(8001L));
            synchronizations.forEach(item -> item.afterCompletion(TransactionSynchronization.STATUS_COMMITTED));
        }
        finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void projectionFailureAfterCommitMarksChangedAccountAndRefreshesMetadata() {
        TransactionSynchronizationManager.initSynchronization();
        doThrow(new IllegalStateException("write failed")).when(projectionService).sync(1001L, Set.of(8001L));
        try {
            service.save(baseRequest("qq", "secret-value"));
            TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);

            verify(projectionService).sync(1001L, Set.of(8001L));
        }
        finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void deleteProjectsOnlyAfterCommit() {
        UserMailAccount existing = existingCustomAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        UserMailAccountDTO request = accountIdRequest(existing.getAccountId());
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.delete(request);
            verify(projectionService, never()).sync(any(), any());

            TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);

            verify(projectionService).sync(1001L, Set.of(existing.getAccountId()));
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void deleteProjectionFailureMarksDeletedAccountAndRefreshesRedis() {
        UserMailAccount existing = existingCustomAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        doThrow(new IllegalStateException("write failed")).when(projectionService)
            .sync(1001L, Set.of(existing.getAccountId()));
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.delete(accountIdRequest(existing.getAccountId()));
            TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);

            verify(projectionService).sync(1001L, Set.of(existing.getAccountId()));
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void setDefaultProjectsOnlyAfterCommit() {
        UserMailAccount existing = existingCustomAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.setDefault(accountIdRequest(existing.getAccountId()));
            verify(projectionService, never()).sync(any(), any());

            TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);

            verify(projectionService).sync(1001L, Set.of(existing.getAccountId()));
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void setDefaultProjectionFailureMarksChangedAccountAndRefreshesRedis() {
        UserMailAccount existing = existingCustomAccount();
        when(mapper.find(any(), any())).thenReturn(existing);
        doThrow(new IllegalStateException("write failed")).when(projectionService)
            .sync(1001L, Set.of(existing.getAccountId()));
        TransactionSynchronizationManager.initSynchronization();
        try {
            service.setDefault(accountIdRequest(existing.getAccountId()));
            TransactionSynchronizationManager.getSynchronizations()
                .forEach(TransactionSynchronization::afterCommit);

            verify(projectionService).sync(1001L, Set.of(existing.getAccountId()));
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }

    @Test
    void nullProviderOnLegacyEntityIsExposedAsCustomImap() {
        UserMailAccount legacy = existingCustomAccount();
        legacy.setProviderCode(null);
        legacy.setAuthType(null);
        when(mapper.active(any())).thenReturn(List.of(legacy));

        UserMailAccountVO result = service.list().getFirst();

        assertThat(result.getProviderCode()).isEqualTo("custom-imap");
        assertThat(result.getAuthType()).isEqualTo("APP_PASSWORD");
        assertThat(result.getConnectionState()).isEqualTo("READY");
    }

    @Test
    void listMapsPersistedConnectionStatusesWithoutChangingRawStatus() {
        UserMailAccount normal = existingQqAccount();
        normal.setAccountId(1L);
        normal.setStatus("NORMAL");
        UserMailAccount partial = existingQqAccount();
        partial.setAccountId(2L);
        partial.setStatus("PARTIAL");
        UserMailAccount auth = existingGmailAccount();
        auth.setAccountId(3L);
        auth.setStatus("AUTH_REQUIRED");
        UserMailAccount unavailable = existingQqAccount();
        unavailable.setAccountId(4L);
        unavailable.setStatus("UNAVAILABLE");
        UserMailAccount projectionFailed = existingQqAccount();
        projectionFailed.setAccountId(5L);
        projectionFailed.setStatus("PROJECTION_FAILED");
        when(mapper.active(any())).thenReturn(List.of(normal, partial, auth, unavailable, projectionFailed));

        List<UserMailAccountVO> results = service.list();

        assertThat(results).extracting(UserMailAccountVO::getConnectionState)
            .containsExactly("READY", "READY", "FAILED", "FAILED", "FAILED");
        assertThat(results).extracting(UserMailAccountVO::getStatus)
            .containsExactly("NORMAL", "PARTIAL", "AUTH_REQUIRED", "UNAVAILABLE", "PROJECTION_FAILED");
    }

    @Test
    void redisSnapshotContainsRoutingMetadataButNoSecretsOrCredentialReferences() {
        UserMailAccount account = existingCustomAccount();
        account.setAuthCodeCipher("fixture-secret-must-not-leak");
        account.setCredentialRef("credential-ref-must-not-leak");

        MailAccountMetadataCacheTransactionService transactions = new MailAccountMetadataCacheTransactionService(
            mapper, mock(LoginApplicationService.class), mock(StringRedisTemplate.class), new ObjectMapper());
        MailAccountMetadataCacheService cache = new MailAccountMetadataCacheService(transactions);
        String json;
        try {
            json = cache.buildJson(List.of(account));
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) {
            throw new AssertionError(e);
        }

        assertThat(json).contains("account_id", "provider_code", "auth_type", "capabilities", "status",
            "capability_status", "setup_requirements", "CONDITIONAL_MOVE_OR_UIDPLUS",
            "PROVIDE_IMAP_SMTP_SETTINGS", "USE_APP_PASSWORD");
        assertThat(json).doesNotContain("auth_code", "credential_ref", "fixture-secret-must-not-leak",
            "credential-ref-must-not-leak");
    }

    private UserMailAccountDTO baseRequest(String providerCode, String authCode) {
        UserMailAccountDTO request = new UserMailAccountDTO();
        request.setName("Work mail");
        request.setEmail("user@example.com");
        request.setProviderCode(providerCode);
        request.setAuthCode(authCode);
        return request;
    }

    private UserMailAccountDTO accountIdRequest(Long accountId) {
        UserMailAccountDTO request = new UserMailAccountDTO();
        request.setAccountId(accountId);
        return request;
    }

    private UserMailAccountDTO customRequest(String authCode) {
        UserMailAccountDTO request = baseRequest(null, authCode);
        request.setImap(server("imap.example.com", 993));
        request.setSmtp(server("smtp.example.com", 465));
        return request;
    }

    private MailServerConfigDTO server(String host, int port) {
        MailServerConfigDTO server = new MailServerConfigDTO();
        server.setHost(host);
        server.setPort(port);
        server.setEncryption("tls");
        return server;
    }

    private UserMailAccount existingCustomAccount() {
        UserMailAccount account = new UserMailAccount();
        account.setAccountId(7001L);
        account.setUserId(1001L);
        account.setAccountName("Legacy mail");
        account.setEmail("legacy@example.com");
        account.setDefaultFlag("N");
        account.setImapHost("imap.example.com");
        account.setImapPort(993);
        account.setImapEncryption("tls");
        account.setSmtpHost("smtp.example.com");
        account.setSmtpPort(465);
        account.setSmtpEncryption("tls");
        account.setStatus("NORMAL");
        account.setDeleteFlag("0");
        return account;
    }

    private UserMailAccount existingQqAccount() {
        UserMailAccount account = existingCustomAccount();
        account.setProviderCode("qq");
        account.setAuthType("APP_PASSWORD");
        account.setImapHost("imap.qq.com");
        account.setSmtpHost("smtp.qq.com");
        account.setAuthCodeCipher("existing-ciphertext");
        account.setAuthCodeLast4("1234");
        account.setCredentialRef("existing-reference");
        return account;
    }

    private UserMailAccount existingGmailAccount() {
        UserMailAccount account = existingCustomAccount();
        account.setProviderCode("gmail");
        account.setAuthType("OAUTH2");
        account.setImapHost(null);
        account.setImapPort(null);
        account.setImapEncryption(null);
        account.setSmtpHost(null);
        account.setSmtpPort(null);
        account.setSmtpEncryption(null);
        account.setAuthCodeCipher(null);
        account.setAuthCodeLast4(null);
        account.setStatus("AUTH_REQUIRED");
        account.setCredentialRef("oauth-reference");
        return account;
    }
}
