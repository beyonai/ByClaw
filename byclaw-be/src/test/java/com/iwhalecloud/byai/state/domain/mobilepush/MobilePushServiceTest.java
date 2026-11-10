package com.iwhalecloud.byai.state.domain.mobilepush;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.config.TransactionAdviceConfig;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;

class MobilePushServiceTest {
    private final MobilePushProperties properties = new MobilePushProperties();
    private final MobilePushStore store = mock(MobilePushStore.class);
    private final MobilePushAuthority authority = mock(MobilePushAuthority.class);
    private final TencentPushClient client = mock(TencentPushClient.class);
    private final MobilePushRateLimiter rateLimiter = mock(MobilePushRateLimiter.class);
    private final List<Runnable> work = new ArrayList<>();
    private final MobilePushService service = new MobilePushService(properties, store, authority, client,
        rateLimiter, work::add);
    private final PushDeviceBinding device = new PushDeviceBinding("installation-test-device", 1,
        "registration", "ios", "en");
    private final PushNotification notification = PushNotification.create("123:production", 1, 30, 40, 23, device);

    private void enable() {
        properties.setEnabled(true);
        properties.setSdkAppId(123);
        properties.setClientAppKey("test-client-key");
        properties.setSecretKey("test-server-key");
        when(store.devices(23)).thenReturn(List.of(device));
        when(store.device(any())).thenReturn(device);
        when(authority.allowed(any())).thenReturn(true);
        when(rateLimiter.awaitSlot()).thenReturn(true);
        when(rateLimiter.firstAttempt(anyString())).thenReturn(true);
    }

    private JSONObject message() {
        return new JSONObject(Map.of("event", "MESSAGE_CREATED", "sessionId", "30", "messageId", "40",
            "creatorId", "22", "speaker", Map.of("type", "USER")));
    }

    @Test
    void globalServiceAdviceDoesNotWrapNotificationOrNodeIoInATransaction() throws Exception {
        var configuration = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(configuration, "transactionManager", mock(DataSourceTransactionManager.class));
        var attributes = configuration.getAdvisor().getTransactionAttributeSource();
        assertThat(attributes).isNotNull();
        var publish = attributes.getTransactionAttribute(MobilePushService.class.getMethod("notifyMembers",
            long.class, JSONObject.class, List.class), MobilePushService.class);
        var permission = attributes.getTransactionAttribute(MobilePushAuthority.class.getMethod("allowed",
            PushNotification.class), MobilePushAuthority.class);
        assertThat(publish.getPropagationBehavior()).isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
        assertThat(permission.getPropagationBehavior()).isEqualTo(TransactionDefinition.PROPAGATION_NOT_SUPPORTED);
    }

    @Test
    void disabledByDefaultWithoutTouchingDatabaseOrVendor() {
        service.notifyMembers(1, message(), List.of(23L));
        assertThat(work).isEmpty();
        verifyNoInteractions(store, client, authority, rateLimiter);
    }

    @Test
    void onlyNewFinalMessagesNotifyOtherHumanMembersOnceAndSnapshotMutableEvents() {
        enable();
        JSONObject event = message();
        List<Long> recipients = new ArrayList<>(List.of(22L, 23L, 23L));
        service.notifyMembers(1, event, recipients);
        assertThat(work).hasSize(1);
        verifyNoInteractions(store, client);
        event.put("messageId", "41");
        recipients.clear();
        work.removeFirst().run();
        verify(store).devices(23);
        verify(store, never()).devices(22);
        verify(client).send(notification, device);
        event.put("event", "AGENT_STREAM");
        service.notifyMembers(1, event, List.of(24L));
        assertThat(work).isEmpty();
    }

    @Test
    void agentCreatorIdentityDoesNotExcludeAHumanWithTheSameId() {
        enable();
        when(store.devices(22)).thenReturn(List.of(device));
        JSONObject event = message();
        event.put("speaker", Map.of("type", "AGENT"));
        service.notifyMembers(1, event, List.of(22L));
        work.removeFirst().run();
        verify(client).send(PushNotification.create("123:production", 1, 30, 40, 22, device), device);
    }

    @Test
    void rejectedExecutorNeverFallsBackToSendingOnTheChatThread() {
        enable();
        Executor saturated = mock(Executor.class);
        doThrow(new RejectedExecutionException("full")).when(saturated).execute(any());
        var limited = new MobilePushService(properties, store, authority, client, rateLimiter, saturated);
        assertThatCode(() -> limited.notifyMembers(1, message(), List.of(23L))).doesNotThrowAnyException();
        verifyNoInteractions(store, client, authority, rateLimiter);
    }

    @Test
    void disabledWhileWaitingSkipsAlreadySubmittedWork() {
        enable();
        service.notifyMembers(1, message(), List.of(23L));
        properties.setEnabled(false);
        work.removeFirst().run();
        verifyNoInteractions(store, client, authority, rateLimiter);
    }

    @Test
    void missingDevicesDoNotCallVendorOrRedis() {
        enable();
        when(store.devices(23)).thenReturn(List.of());
        service.notifyMembers(1, message(), List.of(23L));
        work.removeFirst().run();
        verifyNoInteractions(authority, rateLimiter, client);
    }

    @Test
    void revokedMembershipNeverConsumesQuotaOrCallsVendor() {
        enable();
        when(authority.allowed(notification)).thenReturn(false);
        service.notifyMembers(1, message(), List.of(23L));
        work.removeFirst().run();
        verifyNoInteractions(rateLimiter, client);
    }

    @Test
    void deniedRedisSlotSkipsThisNotificationWithoutPersistentRetry() {
        enable();
        when(rateLimiter.awaitSlot()).thenReturn(false);
        service.notifyMembers(1, message(), List.of(23L));
        work.removeFirst().run();
        verifyNoInteractions(client);
        verify(store, never()).device(any());
        assertThat(work).isEmpty();
    }

    @Test
    void changedBindingDuringPermissionOrRateWaitCannotUseOldRegistration() {
        enable();
        when(store.device(notification)).thenReturn(null);
        service.notifyMembers(1, message(), List.of(23L));
        work.removeFirst().run();
        verifyNoInteractions(client);
        verify(rateLimiter, never()).firstAttempt(anyString());
    }

    @Test
    void duplicateBroadcastIsNotSentAgain() {
        enable();
        when(rateLimiter.firstAttempt(notification.notificationId())).thenReturn(false);
        service.notifyMembers(1, message(), List.of(23L));
        work.removeFirst().run();
        verifyNoInteractions(client);
    }

    @Test
    void bothIosAndAndroidDevicesUseTheSameBindingAndSendPath() {
        enable();
        var android = new PushDeviceBinding("installation-test-android", 1, "android-registration", "android", "zh-CN");
        var androidNotification = PushNotification.create("123:production", 1, 30, 40, 23, android);
        when(store.devices(23)).thenReturn(List.of(device, android));
        when(store.device(androidNotification)).thenReturn(android);
        service.notifyMembers(1, message(), List.of(23L));
        work.removeFirst().run();
        verify(client).send(notification, device);
        verify(client).send(androidNotification, android);
    }

    @Test
    void vendorFailureIsAttemptedOnlyOnceAndDoesNotBlockOtherRecipients() {
        enable();
        when(client.send(notification, device)).thenThrow(new IllegalStateException("test failure"));
        when(store.devices(24)).thenReturn(List.of(device));
        var other = PushNotification.create("123:production", 1, 30, 40, 24, device);
        service.notifyMembers(1, message(), List.of(23L, 24L));
        assertThatCode(() -> work.removeFirst().run()).doesNotThrowAnyException();
        verify(client).send(notification, device);
        verify(client).send(other, device);
        assertThat(work).isEmpty();
    }

    @Test
    void oversizedIdsAreIgnoredWithoutEscapingToTheChatRequest() {
        enable();
        JSONObject event = message();
        event.put("messageId", "9999999999999999999");
        assertThatCode(() -> service.notifyMembers(1, event, List.of(23L))).doesNotThrowAnyException();
        assertThat(work).isEmpty();
        verifyNoInteractions(store, client, rateLimiter, authority);
    }

    @Test
    void expiredInMemoryWorkIsDiscardedBeforeReadingBindings() {
        enable();
        long expired = System.nanoTime() - java.time.Duration.ofMinutes(2).toNanos();
        ReflectionTestUtils.invokeMethod(service, "sendToMembers", 1L, 30L, 40L, List.of(23L), expired);
        verifyNoInteractions(store, client, authority, rateLimiter);
    }

    @Test
    void transientVendorResponseDoesNotScheduleAnotherAttempt() {
        enable();
        when(client.send(notification, device)).thenReturn(91000);
        service.notifyMembers(1, message(), List.of(23L));
        work.removeFirst().run();
        verify(client).send(notification, device);
        assertThat(work).isEmpty();
    }
}
