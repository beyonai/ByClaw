package com.iwhalecloud.byai.manager.domain.mail;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.OpenOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.DirectoryStream;
import java.nio.file.SecureDirectoryStream;
import java.nio.file.NoSuchFileException;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Comparator;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.Objects;
import java.util.UUID;
import java.util.Map;
import java.util.HashMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;
import java.security.SecureRandom;
import java.util.Base64;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.util.StringUtils;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialProjectionEvent;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;

/** Produces the single private byCLI mail account projection. */
@Service
public class MailAccountProjectionService {
    public static final String PROJECTION_PATH = "/by/.connector-auth/.mail/accounts.json";
    private static final long MAX_BYTES = 64 * 1024L;
    private static final Set<PosixFilePermission> PRIVATE_PERMISSIONS = Set.of(
        PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);
    private static final Logger log = LoggerFactory.getLogger(MailAccountProjectionService.class);
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();

    private final ConnectorCredentialWorkspaceService workspaceService;
    private final MailCredentialResolver credentialResolver;
    private final MailAccountProjectionStateService stateService;
    private final MailAccountProjectionLeaseService leaseService;
    private final MailAccountMetadataCacheService metadataCacheService;
    private final ObjectMapper objectMapper;
    private final FileOperations fileOperations;
    private final AtomicLong databaseSweepCursor = new AtomicLong();

    @Autowired
    public MailAccountProjectionService(ConnectorCredentialWorkspaceService workspaceService,
            MailCredentialResolver credentialResolver, MailAccountProjectionStateService stateService,
            MailAccountProjectionLeaseService leaseService, MailAccountMetadataCacheService metadataCacheService,
            ObjectMapper objectMapper) {
        this(workspaceService, credentialResolver, stateService, leaseService, metadataCacheService,
            objectMapper, new NioFileOperations());
    }

    MailAccountProjectionService(ConnectorCredentialWorkspaceService workspaceService,
            MailCredentialResolver credentialResolver, MailAccountProjectionStateService stateService,
            MailAccountProjectionLeaseService leaseService, MailAccountMetadataCacheService metadataCacheService,
            ObjectMapper objectMapper, FileOperations fileOperations) {
        this.workspaceService = workspaceService;
        this.credentialResolver = credentialResolver;
        this.stateService = stateService;
        this.leaseService = leaseService;
        this.metadataCacheService = metadataCacheService;
        this.objectMapper = objectMapper;
        this.fileOperations = fileOperations;
    }

    public void sync(Long userId) {
        sync(userId, Set.of());
    }

    public void sync(Long userId, Set<Long> affectedAccountIds) {
        sync(userId, affectedAccountIds, Reconciliation.NONE, null);
    }

    private void sync(Long userId, Set<Long> affectedAccountIds,
            Reconciliation reconciliation, Long connectorId) {
        Set<Long> affected = new LinkedHashSet<>(affectedAccountIds == null ? Set.of() : affectedAccountIds);
        try {
            leaseService.trigger(userId);
        } catch (RuntimeException e) {
            markFailedAfterTriggerError(userId, affected, reconciliation, connectorId);
            throw e;
        }
        Optional<MailAccountProjectionLeaseService.Lease> lease;
        try {
            lease = leaseService.tryAcquire(userId);
        } catch (RuntimeException e) {
            markFailedAfterTriggerError(userId, affected, reconciliation, connectorId);
            throw e;
        }
        if (lease.isEmpty()) return;
        MailAccountProjectionLeaseService.Lease owner = lease.orElseThrow();
        boolean[] failureHandled = {false};
        try {
            Path target = workspaceService.resolveProjectionFile(userId, PROJECTION_PATH);
            ParentIdentity parentIdentity = validatePrivateParent(userId, target);
            try (AnchoredDirectory directory = fileOperations.openDirectory(target.getParent(), parentIdentity)) {
                leaseService.assertOwnedAndRenew(owner);
                try (ProjectionLock ignored = directory.lock()) {
                    Map<LocatorKeyContext, String> locatorKeys = existingLocatorKeys(directory, target.getFileName());
                    for (int pass = 0; pass < 3; pass++) {
                        long generation = leaseService.generation(userId);
                        List<UserMailAccount> snapshot = List.of();
                        Set<Long> recovery = new LinkedHashSet<>(affected);
                        Set<Long> restored = Set.of();
                        try {
                            leaseService.assertOwnedAndRenew(owner);
                            if (reconciliation == Reconciliation.ALL) {
                                affected.addAll(stateService.reconcileCurrentBindings(userId));
                            } else if (reconciliation == Reconciliation.CONNECTOR) {
                                affected.addAll(stateService.reconcileCurrentBinding(userId, connectorId));
                            }
                            recovery.addAll(stateService.loadProjectionRecoveryIds(userId));
                            snapshot = stateService.loadActiveSnapshot(userId);
                            PreparedProjection prepared = prepareSnapshot(snapshot);
                            Set<Long> successIds = new LinkedHashSet<>(recovery);
                            successIds.removeAll(prepared.failedAccountIds());
                            leaseService.assertOwnedAndRenew(owner);
                            restored = stateService.markProjectionSucceeded(userId, successIds);
                            leaseService.assertOwnedAndRenew(owner);
                            stateService.markProjectionFailed(userId, prepared.failedAccountIds());
                            leaseService.assertOwnedAndRenew(owner);
                            String json = serializePrepared(prepared, locatorKeys);
                            writePrepared(userId, directory, target.getFileName(), json,
                                () -> leaseService.assertOwnedAndRenew(owner));
                            leaseService.assertOwnedAndRenew(owner);
                            try {
                                metadataCacheService.refreshRequired(userId);
                            } catch (IOException e) {
                                throw new IllegalStateException("Mail metadata refresh failed", e);
                            }
                        } catch (MailAccountProjectionLeaseService.LeaseLostException e) {
                            throw e;
                        } catch (RuntimeException e) {
                            Set<Long> failureScope = new LinkedHashSet<>(recovery);
                            failureScope.addAll(restored);
                            snapshot.stream().map(UserMailAccount::getAccountId)
                                .filter(Objects::nonNull).forEach(failureScope::add);
                            markFailedIfOwner(userId, failureScope, owner);
                            failureHandled[0] = true;
                            throw e;
                        }
                        if (leaseService.generation(userId) == generation) {
                            leaseService.assertOwnedAndRenew(owner);
                            leaseService.markClean(userId, generation);
                            return;
                        }
                    }
                }
            }
        } catch (MailAccountProjectionLeaseService.LeaseLostException e) {
            throw e;
        } catch (IOException e) {
            if (!failureHandled[0]) {
                expandGlobalFailureScope(userId, affected);
                markFailedIfOwner(userId, affected, owner);
            }
            throw new IllegalStateException("Unable to lock mail account projection", e);
        } catch (RuntimeException e) {
            if (!failureHandled[0]) {
                expandGlobalFailureScope(userId, affected);
                markFailedIfOwner(userId, affected, owner);
            }
            throw e;
        } finally {
            leaseService.release(owner);
        }
    }

    private PreparedProjection prepareSnapshot(List<UserMailAccount> snapshot) {
        List<UserMailAccount> accounts = new ArrayList<>(snapshot);
        accounts.sort(Comparator
            .comparing((UserMailAccount account) -> "Y".equals(account.getDefaultFlag())).reversed()
            .thenComparing(UserMailAccount::getUpdateTime,
                Comparator.nullsLast(Comparator.reverseOrder()))
            .thenComparing(UserMailAccount::getAccountId, Comparator.nullsLast(Comparator.reverseOrder())));
        List<PreparedAccount> preparedAccounts = new ArrayList<>();
        Set<Long> failedAccountIds = new LinkedHashSet<>();
        Set<LocatorKeyContext> locatorContexts = new LinkedHashSet<>();
        for (UserMailAccount account : accounts) {
            locatorContexts.add(locatorContext(account));
            try {
                credentialResolver.resolve(account)
                    .ifPresent(auth -> preparedAccounts.add(new PreparedAccount(account, auth)));
            } catch (MailCredentialResolutionException e) {
                failedAccountIds.add(recoverableFailureAccountId(account, e));
            }
        }
        return new PreparedProjection(List.copyOf(preparedAccounts), Set.copyOf(failedAccountIds),
            Set.copyOf(locatorContexts));
    }

    private Long recoverableFailureAccountId(UserMailAccount account,
                                               MailCredentialResolutionException failure) {
        return switch (failure.code()) {
            case CORRUPT_CREDENTIAL -> {
                if (account.getAccountId() == null) throw failure;
                yield account.getAccountId();
            }
            case INFRASTRUCTURE -> throw failure;
        };
    }

    private String serializePrepared(PreparedProjection prepared, Map<LocatorKeyContext, String> locatorKeys) {
        ObjectNode root = objectMapper.createObjectNode();
        root.put("schemaVersion", 1);
        locatorKeys.keySet().retainAll(prepared.activeLocatorContexts());
        prepared.activeLocatorContexts().forEach(context -> locatorKeys.computeIfAbsent(context, ignored -> newLocatorKey()));
        ArrayNode keyring = root.putArray("locatorKeyring");
        locatorKeys.entrySet().stream()
            .sorted(Map.Entry.comparingByKey(Comparator.comparing(LocatorKeyContext::accountId)
                .thenComparing(LocatorKeyContext::provider).thenComparing(LocatorKeyContext::email)))
            .forEach(entry -> {
                ObjectNode key = keyring.addObject();
                key.put("accountId", entry.getKey().accountId());
                key.put("provider", entry.getKey().provider());
                key.put("email", entry.getKey().email());
                key.put("key", entry.getValue());
            });
        ArrayNode output = root.putArray("accounts");
        for (PreparedAccount account : prepared.accounts()) {
            String targetStatus = MailAccountProjectionStateService.expectedProjectionStatus(account.account());
            output.add(accountJson(account.account(), account.auth(), targetStatus, locatorKeys));
        }
        return serialize(root);
    }

    private void writePrepared(Long userId, AnchoredDirectory directory, Path targetName,
            String json, Runnable beforeMove) {
        write(userId, directory, targetName, json, beforeMove);
    }

    private void markFailedAfterTriggerError(Long userId, Set<Long> affected,
            Reconciliation reconciliation, Long connectorId) {
        try {
            if (affected.isEmpty() && reconciliation == Reconciliation.CONNECTOR) {
                affected.addAll(stateService.loadAccountIdsForConnector(userId, connectorId));
            } else if (affected.isEmpty() && reconciliation == Reconciliation.ALL) {
                affected.addAll(stateService.loadAllAccountIds(userId));
            }
            if (!affected.isEmpty()) stateService.markProjectionFailed(userId, affected);
        } catch (RuntimeException markError) {
            log.warn("Mail projection failure status update failed for userId={}: {}",
                userId, markError.getMessage());
        }
        metadataCacheService.refresh(userId);
    }

    private void markFailedIfOwner(Long userId, Set<Long> affected,
            MailAccountProjectionLeaseService.Lease owner) {
        try {
            leaseService.assertOwnedAndRenew(owner);
            if (!affected.isEmpty()) stateService.markProjectionFailed(userId, affected);
            leaseService.assertOwnedAndRenew(owner);
            metadataCacheService.refresh(userId);
        } catch (MailAccountProjectionLeaseService.LeaseLostException e) {
            log.warn("Stale mail projection writer discarded for userId={}", userId);
        } catch (RuntimeException e) {
            log.warn("Mail projection failure status update failed for userId={}: {}", userId, e.getMessage());
        }
    }

    private void expandGlobalFailureScope(Long userId, Set<Long> affected) {
        try {
            affected.addAll(stateService.loadProjectionRecoveryIds(userId));
        } catch (RuntimeException e) {
            log.warn("Unable to determine complete mail projection failure scope for userId={}: {}",
                userId, e.getMessage());
        }
    }

    /** Binds a saved OAuth mail account when an enabled authorization already exists. */
    public void bindAvailableOAuth(UserMailAccount account) {
        stateService.prepareOAuthBinding(account);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void handle(ConnectorCredentialProjectionEvent event) {
        if (event == null || event.userId() == null || event.connectorId() == null) {
            return;
        }
        try {
            if (!stateService.recognizesMailConnector(event.connectorId())) return;
            sync(event.userId(), Set.of(), Reconciliation.CONNECTOR, event.connectorId());
        } catch (RuntimeException e) {
            log.warn("Mail credential projection failed for userId={}, connectorId={}: {}",
                event.userId(), event.connectorId(), e.getMessage());
        }
    }

    public void markProjectionFailed(Long userId, Long accountId) {
        stateService.markProjectionFailed(userId, accountId == null ? Set.of() : Set.of(accountId));
    }

    @Scheduled(initialDelayString = "${mail.projection-reconcile-initial-delay-ms:90000}",
        fixedDelayString = "${mail.projection-reconcile-delay-ms:300000}")
    public void reconcileDirtyUsers() {
        for (Long userId : leaseService.dirtyUsers(100)) {
            try {
                sync(userId, stateService.loadAllAccountIds(userId), Reconciliation.ALL, null);
            } catch (RuntimeException e) {
                log.warn("Scheduled mail projection reconciliation failed for userId={}: {}",
                    userId, e.getMessage());
            }
        }
        long cursor = databaseSweepCursor.get();
        try {
            MailAccountProjectionStateService.ProjectionUserBatch batch =
                stateService.scanProjectionUsersAfter(cursor, 100);
            for (Long userId : batch.userIds()) {
                try {
                    sync(userId, stateService.loadAllAccountIds(userId), Reconciliation.ALL, null);
                } catch (RuntimeException e) {
                    log.warn("Database mail projection reconciliation failed for userId={}: {}",
                        userId, e.getMessage());
                }
            }
            databaseSweepCursor.set(batch.hasMore() ? batch.nextAccountId() : 0L);
        } catch (RuntimeException e) {
            log.warn("Database mail projection sweep failed: {}", e.getMessage());
        }
    }

    private ObjectNode accountJson(UserMailAccount account, MailCredentialResolver.ResolvedAuth auth,
            String targetStatus, Map<LocatorKeyContext, String> locatorKeys) {
        ObjectNode item = objectMapper.createObjectNode();
        item.put("accountId", String.valueOf(account.getAccountId()));
        item.put("provider", account.getProviderCode());
        item.put("email", account.getEmail());
        item.put("displayName", account.getDisplayName() == null ? "" : account.getDisplayName());
        item.put("default", "Y".equals(account.getDefaultFlag()));
        item.put("status", targetStatus);
        item.put("locatorKey", locatorKey(account, locatorKeys));
        ArrayNode capabilities = item.putArray("capabilities");
        var provider = MailProviderCatalog.require(account.getProviderCode());
        provider.getCapabilities().forEach(capabilities::add);
        ObjectNode capabilityStatus = item.putObject("capabilityStatus");
        provider.getCapabilityStatus().forEach(capabilityStatus::put);
        ArrayNode setupRequirements = item.putArray("setupRequirements");
        provider.getSetupRequirements().forEach(setupRequirements::add);
        ObjectNode authJson = item.putObject("auth");
        authJson.put("type", auth.type());
        put(authJson, "username", auth.username());
        put(authJson, "secret", auth.secret());
        put(authJson, "accessToken", auth.accessToken());
        put(authJson, "tokenType", auth.tokenType());
        if (auth.scopes() != null && !auth.scopes().isEmpty()) {
            ArrayNode scopes = authJson.putArray("scopes");
            auth.scopes().forEach(scopes::add);
        }
        if (auth.accessExpiresAt() != null) {
            authJson.put("accessExpiresAt", auth.accessExpiresAt().toInstant().toString());
        }
        ObjectNode server = objectMapper.createObjectNode();
        addServer(server, "imap", account.getImapHost(), account.getImapPort(), account.getImapEncryption());
        addServer(server, "smtp", account.getSmtpHost(), account.getSmtpPort(), account.getSmtpEncryption());
        if (!server.isEmpty()) {
            item.set("server", server);
        }
        return item;
    }

    private String locatorKey(UserMailAccount account, Map<LocatorKeyContext, String> locatorKeys) {
        return locatorKeys.computeIfAbsent(locatorContext(account), ignored -> newLocatorKey());
    }

    private String newLocatorKey() {
        byte[] key = new byte[32];
        SECURE_RANDOM.nextBytes(key);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(key);
    }

    private LocatorKeyContext locatorContext(UserMailAccount account) {
        return new LocatorKeyContext(String.valueOf(account.getAccountId()), account.getProviderCode(),
            account.getEmail().trim().toLowerCase(java.util.Locale.ROOT));
    }

    private Map<LocatorKeyContext, String> existingLocatorKeys(AnchoredDirectory directory, Path targetName) {
        Map<LocatorKeyContext, String> keys = new HashMap<>();
        try {
            byte[] previous = directory.readPrivateIfExists(targetName, (int) MAX_BYTES);
            if (previous == null) return keys;
            JsonNode root = objectMapper.readTree(previous);
            if (root == null || !root.isObject()) return keys;
            JsonNode keyring = root.path("locatorKeyring");
            JsonNode accounts = keyring != null && keyring.isArray() ? keyring : root.path("accounts");
            if (!accounts.isArray() || accounts.size() > 1000) return keys;
            for (JsonNode account : accounts) {
                String accountId = account.path("accountId").asText(null);
                String provider = account.path("provider").asText(null);
                String email = account.path("email").asText(null);
                String key = account.path(keyring != null && keyring.isArray() ? "key" : "locatorKey").asText(null);
                if (accountId != null && provider != null && email != null && key != null
                        && accountId.length() <= 128 && provider.length() <= 64 && email.length() <= 320
                        && key.matches("[A-Za-z0-9_-]{43}")) {
                    keys.put(new LocatorKeyContext(accountId, provider,
                        email.trim().toLowerCase(java.util.Locale.ROOT)), key);
                }
            }
            return keys;
        } catch (IOException e) {
            return keys;
        }
    }

    private void addServer(ObjectNode root, String name, String host, Integer port, String encryption) {
        if (!StringUtils.hasText(host) && port == null && !StringUtils.hasText(encryption)) {
            return;
        }
        ObjectNode server = root.putObject(name);
        put(server, "host", host);
        if (port != null) server.put("port", port);
        put(server, "encryption", encryption);
    }

    private String serialize(ObjectNode root) {
        try {
            return objectMapper.writeValueAsString(root);
        } catch (IOException e) {
            throw new IllegalStateException("Unable to serialize mail account projection", e);
        }
    }

    private void write(Long userId, AnchoredDirectory directory, Path targetName,
            String json, Runnable beforeMove) {
        byte[] content = json.getBytes(StandardCharsets.UTF_8);
        if (content.length > MAX_BYTES) {
            throw new IllegalStateException("Mail account projection exceeds 64KiB");
        }
        OpenedPrivateFile temporary = null;
        try {
            temporary = directory.openPrivateTemp();
            directory.writeAndForce(temporary, content);
            directory.validateIdentity(temporary, temporary.path());
            beforeMove.run();
            directory.moveAtomic(temporary, targetName);
            directory.validateIdentity(temporary, targetName);
            temporary.close();
            temporary = null;
        } catch (IOException | SecurityException e) {
            throw new IllegalStateException("Unable to write mail account projection", e);
        } finally {
            if (temporary != null) {
                Path path = temporary.path();
                try {
                    temporary.close();
                    directory.deleteIfExists(path);
                } catch (IOException ignored) {
                    // Private workspace reconciliation can remove an abandoned temp file.
                }
            }
        }
    }

    private ParentIdentity validatePrivateParent(Long userId, Path target) {
        try {
            Path expected = workspaceService.resolveProjectionFile(userId, PROJECTION_PATH);
            if (!expected.equals(target)) throw new IOException("Projection target changed");
            Path parent = target.getParent();
            BasicFileAttributes attributes = Files.readAttributes(
                parent, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            if (!attributes.isDirectory() || Files.isSymbolicLink(parent)
                    || !parent.toRealPath(LinkOption.NOFOLLOW_LINKS).equals(
                        expected.getParent().toRealPath(LinkOption.NOFOLLOW_LINKS))) {
                throw new IOException("Projection parent is not trusted");
            }
            PosixFileAttributeView view = Files.getFileAttributeView(
                parent, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
            if (view == null) throw new IOException("POSIX projection permissions unavailable");
            Set<PosixFilePermission> permissions = view.readAttributes().permissions();
            if (permissions.stream().anyMatch(permission -> permission.name().startsWith("GROUP_")
                    || permission.name().startsWith("OTHERS_"))) {
                throw new IOException("Projection parent permissions are not private");
            }
            if (attributes.fileKey() == null) throw new IOException("Projection parent identity unavailable");
            return new ParentIdentity(attributes.fileKey());
        } catch (IOException | SecurityException e) {
            throw new IllegalStateException("Unable to validate mail projection parent", e);
        }
    }

    private void put(ObjectNode node, String key, String value) {
        if (StringUtils.hasText(value)) node.put(key, value);
    }

    private enum Reconciliation { NONE, ALL, CONNECTOR }

    record ParentIdentity(Object fileKey) { }

    record PreparedProjection(List<PreparedAccount> accounts, Set<Long> failedAccountIds,
                              Set<LocatorKeyContext> activeLocatorContexts) { }

    record PreparedAccount(UserMailAccount account, MailCredentialResolver.ResolvedAuth auth) { }

    record LocatorKeyContext(String accountId, String provider, String email) { }

    interface FileOperations {
        AnchoredDirectory openDirectory(Path directory, ParentIdentity expectedIdentity) throws IOException;
    }

    interface AnchoredDirectory extends AutoCloseable {
        ProjectionLock lock() throws IOException;
        byte[] readPrivateIfExists(Path file, int maximumBytes) throws IOException;
        OpenedPrivateFile openPrivateTemp() throws IOException;
        void writeAndForce(OpenedPrivateFile file, byte[] content) throws IOException;
        void validateIdentity(OpenedPrivateFile file, Path path) throws IOException;
        void moveAtomic(OpenedPrivateFile source, Path target) throws IOException;
        void deleteIfExists(Path file) throws IOException;
        @Override
        void close() throws IOException;
    }

    record OpenedPrivateFile(Path path, FileChannel channel, Object identity) implements AutoCloseable {
        @Override
        public void close() throws IOException {
            channel.close();
        }
    }

    interface ProjectionLock extends AutoCloseable {
        @Override
        void close() throws IOException;
    }

    static class NioFileOperations implements FileOperations {
        private static final int MAX_CONSECUTIVE_ZERO_WRITES = 16;
        private static final ConcurrentHashMap<Path, ReentrantLock> JVM_LOCKS = new ConcurrentHashMap<>();
        private final ChannelWriter channelWriter;

        NioFileOperations() {
            this(FileChannel::write);
        }

        NioFileOperations(ChannelWriter channelWriter) {
            this.channelWriter = channelWriter;
        }

        @Override
        @SuppressWarnings("unchecked")
        public AnchoredDirectory openDirectory(Path directory, ParentIdentity expectedIdentity) throws IOException {
            beforeOpenDirectory(directory);
            DirectoryStream<Path> opened = Files.newDirectoryStream(directory);
            if (!(opened instanceof SecureDirectoryStream<?>)) {
                opened.close();
                throw new IOException("Secure directory operations unavailable");
            }
            SecureDirectoryStream<Path> secure = (SecureDirectoryStream<Path>) opened;
            try {
                BasicFileAttributes attributes = secure
                    .getFileAttributeView(Path.of("."), BasicFileAttributeView.class, LinkOption.NOFOLLOW_LINKS)
                    .readAttributes();
                if (!attributes.isDirectory() || !expectedIdentity.fileKey().equals(attributes.fileKey())) {
                    throw new IOException("Projection parent identity changed");
                }
                PosixFileAttributeView permissions = secure
                    .getFileAttributeView(Path.of("."), PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
                if (permissions == null || permissions.readAttributes().permissions().stream()
                        .anyMatch(permission -> permission.name().startsWith("GROUP_")
                            || permission.name().startsWith("OTHERS_"))) {
                    throw new IOException("Projection parent permissions are not private");
                }
                return new NioAnchoredDirectory(directory.toAbsolutePath().normalize(), secure);
            } catch (IOException | RuntimeException e) {
                secure.close();
                throw e;
            }
        }

        protected void beforeOpenDirectory(Path directory) throws IOException { }
        protected void beforeOpenTemp(Path directory) throws IOException { }
        protected void beforeMove(Path directory, OpenedPrivateFile source, Path target) throws IOException { }
        protected void beforeValidateIdentity(Path directory, OpenedPrivateFile file, Path path) throws IOException { }

        private class NioAnchoredDirectory implements AnchoredDirectory {
            private final Path directory;
            private final SecureDirectoryStream<Path> secure;

            NioAnchoredDirectory(Path directory, SecureDirectoryStream<Path> secure) {
                this.directory = directory;
                this.secure = secure;
            }

            @Override
            public ProjectionLock lock() throws IOException {
                Path relative = Path.of(".mail-projection.lock");
                Path lockKey = directory.resolve(relative);
                ReentrantLock local = JVM_LOCKS.computeIfAbsent(lockKey, ignored -> new ReentrantLock());
                local.lock();
                FileChannel channel = null;
                FileLock lock = null;
                try {
                    try {
                        channel = openNewPrivate(relative);
                    } catch (FileAlreadyExistsException e) {
                        validatePrivatePath(relative, null);
                        channel = asFileChannel(secure.newByteChannel(relative,
                            Set.of(StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS)));
                    }
                    validatePrivatePath(relative, null);
                    lock = channel.lock();
                    FileChannel heldChannel = channel;
                    FileLock heldLock = lock;
                    return () -> {
                        try {
                            heldLock.release();
                        } finally {
                            try {
                                heldChannel.close();
                            } finally {
                                local.unlock();
                            }
                        }
                    };
                } catch (IOException | RuntimeException e) {
                    if (lock != null) try { lock.release(); } catch (IOException ignored) { }
                    if (channel != null) try { channel.close(); } catch (IOException ignored) { }
                    local.unlock();
                    throw e;
                }
            }

            @Override
            public byte[] readPrivateIfExists(Path file, int maximumBytes) throws IOException {
                try {
                    BasicFileAttributes attributes = validatePrivatePath(file, null);
                    if (attributes.size() > maximumBytes) throw new IOException("Mail projection exceeds read limit");
                    try (SeekableByteChannel channel = secure.newByteChannel(file,
                            Set.of(StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS))) {
                        ByteBuffer buffer = ByteBuffer.allocate((int) attributes.size());
                        while (buffer.hasRemaining()) {
                            int read = channel.read(buffer);
                            if (read < 0) break;
                            if (read == 0) throw new IOException("Mail projection read made no progress");
                        }
                        if (buffer.hasRemaining()) throw new IOException("Mail projection changed during read");
                        return buffer.array();
                    }
                } catch (NoSuchFileException e) {
                    return null;
                }
            }

        @Override
        public OpenedPrivateFile openPrivateTemp() throws IOException {
            beforeOpenTemp(directory);
            Path path = Path.of(".mail-accounts-" + UUID.randomUUID() + ".tmp");
            FileChannel channel = openNewPrivate(path);
            try {
                BasicFileAttributes attributes = validatePrivatePath(path, null);
                if (attributes.fileKey() == null) throw new IOException("Mail projection identity unavailable");
                return new OpenedPrivateFile(path, channel, attributes.fileKey());
            } catch (IOException | RuntimeException e) {
                channel.close();
                deleteIfExists(path);
                throw e;
            }
        }

        @Override
        public void writeAndForce(OpenedPrivateFile file, byte[] content) throws IOException {
            ByteBuffer buffer = ByteBuffer.wrap(content);
            int consecutiveZeroWrites = 0;
            while (buffer.hasRemaining()) {
                int written = channelWriter.write(file.channel(), buffer);
                if (written < 0) throw new IOException("Unexpected end while writing mail projection");
                if (written == 0) {
                    if (++consecutiveZeroWrites >= MAX_CONSECUTIVE_ZERO_WRITES) {
                        throw new IOException("Mail projection write made no progress");
                    }
                } else {
                    consecutiveZeroWrites = 0;
                }
            }
            file.channel().force(true);
        }

        @Override
        public void validateIdentity(OpenedPrivateFile file, Path path) throws IOException {
            beforeValidateIdentity(directory, file, path);
            validatePrivatePath(path, file.identity());
        }

        @Override
        public void moveAtomic(OpenedPrivateFile source, Path target) throws IOException {
            beforeMove(directory, source, target);
            secure.move(source.path(), secure, target);
        }

        @Override
        public void deleteIfExists(Path file) throws IOException {
            try {
                secure.deleteFile(file);
            } catch (NoSuchFileException ignored) {
                // Already absent.
            }
        }

        private FileChannel openNewPrivate(Path path) throws IOException {
            Set<OpenOption> options = Set.of(
                StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE, LinkOption.NOFOLLOW_LINKS);
            return asFileChannel(secure.newByteChannel(path, options,
                PosixFilePermissions.asFileAttribute(PRIVATE_PERMISSIONS)));
        }

        private BasicFileAttributes validatePrivatePath(Path path, Object expectedIdentity) throws IOException {
            BasicFileAttributes attributes = secure
                .getFileAttributeView(path, BasicFileAttributeView.class, LinkOption.NOFOLLOW_LINKS)
                .readAttributes();
            if (!attributes.isRegularFile()) {
                throw new IOException("Mail projection is not a regular private file");
            }
            PosixFileAttributeView view = secure
                .getFileAttributeView(path, PosixFileAttributeView.class, LinkOption.NOFOLLOW_LINKS);
            if (view == null || !view.readAttributes().permissions().equals(PRIVATE_PERMISSIONS)) {
                throw new IOException("Mail projection permissions are not private");
            }
            if (expectedIdentity != null && !expectedIdentity.equals(attributes.fileKey())) {
                throw new IOException("Mail projection file identity changed");
            }
            return attributes;
        }

        private FileChannel asFileChannel(SeekableByteChannel channel) throws IOException {
            if (channel instanceof FileChannel fileChannel) return fileChannel;
            channel.close();
            throw new IOException("File locking channel unavailable");
        }

        @Override
        public void close() throws IOException {
            secure.close();
        }
        }
    }

    @FunctionalInterface
    interface ChannelWriter {
        int write(FileChannel channel, ByteBuffer buffer) throws IOException;
    }
}
