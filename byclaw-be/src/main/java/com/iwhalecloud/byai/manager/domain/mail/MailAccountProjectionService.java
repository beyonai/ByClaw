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

/** Produces independent private mail connector projections. */
@Service
public class MailAccountProjectionService {
    public static final String PROJECTION_PATH = "/by/.connector-auth/.mail/qq-mail.json";
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

    private static final Map<String, String> CONNECTOR_PROVIDERS = Map.of(
        "qq-mail", "qq", "netease-163-mail", "netease-163", "gmail-mail", "gmail",
        "custom-imap-mail", "custom-imap");
    private static final Set<String> RECOGNIZED_CONNECTORS = Set.of(
        "qq-mail", "netease-163-mail", "gmail-mail", "custom-imap-mail",
        "aliyun-mail", "microsoft-mail", "fastmail-mail");

    private void sync(Long userId, Set<Long> affectedAccountIds,
            Reconciliation reconciliation, Long connectorId) {
        Set<Long> affected = new LinkedHashSet<>(affectedAccountIds == null ? Set.of() : affectedAccountIds);
        if (connectorId != null) affected.add(connectorId);
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
        var owner = lease.orElseThrow();
        String phase = "validation";
        try {
            Path target = workspaceService.resolveProjectionFile(userId, PROJECTION_PATH);
            ParentIdentity identity = validatePrivateParent(userId, target);
            phase = "secure-filesystem";
            try (AnchoredDirectory directory = fileOperations.openDirectory(target.getParent(), identity)) {
                phase = "locking";
                try (ProjectionLock ignored = directory.lock()) {
                for (int pass = 0; pass < 3; pass++) {
                    phase = "snapshot-validation";
                    leaseService.assertOwnedAndRenew(owner);
                    long generation = leaseService.generation(userId);
                    boolean full = reconciliation == Reconciliation.ALL || affected.isEmpty() || pass > 0;
                    Set<Long> reconciliationFailures = new LinkedHashSet<>();
                    if (full) affected.addAll(stateService.loadAllAccountIds(userId));
                    for (Long id : Set.copyOf(affected)) {
                        if (!full && reconciliation != Reconciliation.CONNECTOR) continue;
                        try { stateService.reconcileCurrentBinding(userId, id); }
                        catch (RuntimeException e) {
                            reconciliationFailures.add(id);
                            logFailure(userId, id, "mail", "binding-reconciliation", e);
                        }
                    }
                    List<UserMailAccount> snapshot = stateService.loadActiveSnapshot(userId);
                    Map<String, PreparedAccount> desired = new HashMap<>();
                    Set<String> failedConnectors = new LinkedHashSet<>();
                    Set<Long> failedIds = new LinkedHashSet<>(reconciliationFailures);
                    Set<Long> invalidIds = stateService.invalidProjectionIds(userId);
                    if (full) failedIds.addAll(invalidIds);
                    else invalidIds.stream().filter(affected::contains).forEach(failedIds::add);
                    Set<Long> successIds = new LinkedHashSet<>(affected);
                    Map<String, Long> connectorIds = new HashMap<>();
                    for (Long id : affected) {
                        String code = stateService.connectorCode(id);
                        if (code == null) code = stateService.storedConnectorCode(userId, id);
                        if (RECOGNIZED_CONNECTORS.contains(code == null ? "" : code)) connectorIds.put(code, id);
                    }
                    // Resolve each account independently; unavailable and unauthorized bindings are deletions.
                    for (UserMailAccount account : snapshot) {
                        var provider = MailProviderCatalog.require(account.getProviderCode());
                        String code = provider.getConnectorCode();
                        connectorIds.put(code, account.getAccountId());
                        if (!full && !affected.contains(account.getAccountId())) continue;
                        successIds.add(account.getAccountId());
                        if (reconciliationFailures.contains(account.getAccountId())) {
                            failedConnectors.add(code);
                            continue;
                        }
                        if (!account.getProviderCode().equals(CONNECTOR_PROVIDERS.get(code))) continue;
                        try {
                            var connector = stateService.findActiveConnector(code);
                            if (connector == null || !"00A".equals(connector.getStatusCd())
                                    || !Objects.equals(account.getConnectorId(), connector.getConnectorId())) continue;
                            Optional<MailCredentialResolver.ResolvedAuth> auth = credentialResolver.resolve(account);
                            if (auth.isPresent()) {
                                if (desired.put(code, new PreparedAccount(account, auth.orElseThrow())) != null) {
                                    throw new IllegalStateException("Duplicate mail connector account");
                                }
                            }
                        } catch (RuntimeException e) {
                            failedConnectors.add(code);
                            failedIds.add(account.getAccountId());
                            logFailure(userId, account.getAccountId(), code, "credential-resolution", e);
                        }
                    }
                    // Remove revoked credentials before any writes; do not parse the obsolete aggregate.
                    if (full) directory.deleteIfExists(Path.of("accounts.json"));
                    for (String code : RECOGNIZED_CONNECTORS) {
                        Long id = connectorIds.get(code);
                        boolean selected = full || (id != null && affected.contains(id));
                        if (!selected && connectorId != null) {
                            selected = code.equals(stateService.connectorCode(connectorId));
                        }
                        if (!selected || desired.containsKey(code) || failedConnectors.contains(code)) continue;
                        try {
                            leaseService.assertOwnedAndRenew(owner);
                            directory.deleteIfExists(Path.of(code + ".json"));
                        } catch (IOException | RuntimeException e) {
                            if (e instanceof MailAccountProjectionLeaseService.LeaseLostException lost) throw lost;
                            if (id != null) failedIds.add(id);
                            else failedIds.addAll(affected);
                            failedConnectors.add(code);
                            logFailure(userId, id, code, "deletion", e);
                        }
                    }
                    for (var entry : desired.entrySet()) {
                        String code = entry.getKey();
                        PreparedAccount prepared = entry.getValue();
                        try {
                            Path filename = Path.of(code + ".json");
                            Map<LocatorKeyContext, String> keys = existingLocatorKeys(directory, filename);
                            ObjectNode root = objectMapper.createObjectNode();
                            root.put("schemaVersion", 2);
                            root.put("connectorCode", code);
                            root.set("account", accountJson(prepared.account(), prepared.auth(),
                                MailAccountProjectionStateService.expectedProjectionStatus(prepared.account()), keys));
                            write(userId, directory, filename, serialize(root),
                                () -> leaseService.assertOwnedAndRenew(owner));
                        } catch (RuntimeException e) {
                            if (e instanceof MailAccountProjectionLeaseService.LeaseLostException lost) throw lost;
                            failedIds.add(prepared.account().getAccountId());
                            failedConnectors.add(code);
                            logFailure(userId, prepared.account().getAccountId(), code, "write", e);
                        }
                    }
                    successIds.removeAll(failedIds);
                    leaseService.assertOwnedAndRenew(owner);
                    phase = "status-update";
                    stateService.markProjectionSucceeded(userId, successIds);
                    stateService.markProjectionFailed(userId, failedIds);
                    metadataCacheService.refreshRequired(userId);
                    if (!failedConnectors.isEmpty() || !failedIds.isEmpty()) return; // Keep the durable dirty marker for retry.
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
        } catch (IOException | RuntimeException e) {
            logFailure(userId, connectorId, "mail", phase, e);
            expandGlobalFailureScope(userId, affected);
            markFailedIfOwner(userId, affected, owner);
            throw new IllegalStateException("Mail projection failed", e);
        } finally {
            leaseService.release(owner);
        }
    }

    private void logFailure(Long userId, Long connectorId, String code, String phase, Exception error) {
        log.warn("Mail projection failed userId={} connectorId={} connectorCode={} filename={} phase={} category={}",
            userId, connectorId, code, RECOGNIZED_CONNECTORS.contains(code) ? code + ".json" : ".mail",
            error instanceof ProjectionFailure failure ? failure.phase : phase, error.getClass().getSimpleName());
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
                userId, markError.getClass().getSimpleName());
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
            log.warn("Mail projection failure status update failed for userId={}: {}", userId, e.getClass().getSimpleName());
        }
    }

    private void expandGlobalFailureScope(Long userId, Set<Long> affected) {
        try {
            affected.addAll(stateService.loadProjectionRecoveryIds(userId));
        } catch (RuntimeException e) {
            log.warn("Unable to determine complete mail projection failure scope for userId={}: {}",
                userId, e.getClass().getSimpleName());
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
            if (!stateService.recognizesMailConnector(event.connectorId())
                    && stateService.loadAccountIdsForConnector(event.userId(), event.connectorId()).isEmpty()) return;
            sync(event.userId(), Set.of(), Reconciliation.CONNECTOR, event.connectorId());
        } catch (RuntimeException e) {
            log.warn("Mail credential projection failed for userId={}, connectorId={}: {}",
                event.userId(), event.connectorId(), e.getClass().getSimpleName());
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
                    userId, e.getClass().getSimpleName());
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
                        userId, e.getClass().getSimpleName());
                }
            }
            databaseSweepCursor.set(batch.hasMore() ? batch.nextAccountId() : 0L);
        } catch (RuntimeException e) {
            log.warn("Database mail projection sweep failed: {}", e.getClass().getSimpleName());
        }
    }

    private ObjectNode accountJson(UserMailAccount account, MailCredentialResolver.ResolvedAuth auth,
            String targetStatus, Map<LocatorKeyContext, String> locatorKeys) {
        ObjectNode item = objectMapper.createObjectNode();
        item.put("accountId", String.valueOf(account.getAccountId()));
        item.put("provider", account.getProviderCode());
        item.put("email", account.getEmail());
        item.put("displayName", account.getDisplayName() == null ? "" : account.getDisplayName());
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
            String code = root.path("connectorCode").asText();
            if (root.path("schemaVersion").asInt() != 2 || !targetName.toString().equals(code + ".json")) return keys;
            JsonNode account = root.path("account");
            String accountId = account.path("accountId").asText(null);
            String provider = account.path("provider").asText(null);
            String email = account.path("email").asText(null);
            String key = account.path("locatorKey").asText(null);
            if (accountId != null && email != null && key != null
                    && Objects.equals(CONNECTOR_PROVIDERS.get(code), provider)
                    && accountId.length() <= 128 && email.length() <= 320
                    && key.matches("[A-Za-z0-9_-]{43}")) {
                keys.put(new LocatorKeyContext(accountId, provider,
                    email.trim().toLowerCase(java.util.Locale.ROOT)), key);
            }
            return keys;
        } catch (IOException e) {
            throw new ProjectionFailure("read-validation", e);
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
            throw new ProjectionFailure("serialization", e);
        }
    }

    private void write(Long userId, AnchoredDirectory directory, Path targetName,
            String json, Runnable beforeMove) {
        byte[] content = json.getBytes(StandardCharsets.UTF_8);
        if (content.length > MAX_BYTES) {
            throw new IllegalStateException("Mail account projection exceeds 64KiB");
        }
        OpenedPrivateFile temporary = null;
        String phase = "temporary-create";
        try {
            temporary = directory.openPrivateTemp();
            phase = "write-fsync";
            directory.writeAndForce(temporary, content);
            phase = "validation";
            directory.validateIdentity(temporary, temporary.path());
            beforeMove.run();
            phase = "rename-fsync";
            directory.moveAtomic(temporary, targetName);
            directory.validateIdentity(temporary, targetName);
            temporary.close();
            temporary = null;
        } catch (IOException | SecurityException e) {
            throw new ProjectionFailure(phase, e);
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
            if (!permissions.equals(PosixFilePermissions.fromString("rwx------"))
                    || !view.readAttributes().owner().equals(parent.getFileSystem().getUserPrincipalLookupService()
                        .lookupPrincipalByName(System.getProperty("user.name")))) {
                throw new IOException("Projection parent permissions are not private");
            }
            if (attributes.fileKey() == null) throw new IOException("Projection parent identity unavailable");
            if (com.sun.jna.Platform.isMac() || com.sun.jna.Platform.isLinux()) {
                Map<String, Object> unix = Files.readAttributes(parent, "unix:dev,ino,fileKey", LinkOption.NOFOLLOW_LINKS);
                if (!attributes.fileKey().equals(unix.get("fileKey"))) throw new IOException("Projection parent changed");
                return new ParentIdentity(attributes.fileKey(), ((Number) unix.get("dev")).longValue(),
                    ((Number) unix.get("ino")).longValue());
            }
            return new ParentIdentity(attributes.fileKey(), null, null);
        } catch (IOException | SecurityException e) {
            throw new IllegalStateException("Unable to validate mail projection parent", e);
        }
    }

    private void put(ObjectNode node, String key, String value) {
        if (StringUtils.hasText(value)) node.put(key, value);
    }

    private static final class ProjectionFailure extends IllegalStateException {
        private final String phase;
        ProjectionFailure(String phase, Throwable cause) {
            super("Mail projection " + phase + " failed", cause);
            this.phase = phase;
        }
    }

    private enum Reconciliation { NONE, ALL, CONNECTOR }

    record ParentIdentity(Object fileKey, Long device, Long inode) {
        ParentIdentity(Object fileKey) { this(fileKey, null, null); }
    }

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
                if (com.sun.jna.Platform.isLinux()) {
                    try {
                        return LinuxMailDirectory.open(directory, expectedIdentity, this, channelWriter);
                    } catch (LinkageError e) {
                        throw new IOException("Secure Linux native filesystem operations unavailable");
                    }
                }
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
                return new NioAnchoredDirectory(directory.toAbsolutePath().normalize(), secure, expectedIdentity.fileKey());
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
            private final Object parentKey;

            NioAnchoredDirectory(Path directory, SecureDirectoryStream<Path> secure, Object parentKey) {
                this.directory = directory;
                this.secure = secure;
                this.parentKey = parentKey;
            }

            @Override
            public ProjectionLock lock() throws IOException {
                validateParent();
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
                    validateParent();
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
                        validateParent();
                        validatePrivatePath(file, attributes.fileKey());
                        if (channel.size() != attributes.size()) throw new IOException("Mail projection changed during read");
                        return buffer.array();
                    }
                } catch (NoSuchFileException e) {
                    return null;
                }
            }

        @Override
        public OpenedPrivateFile openPrivateTemp() throws IOException {
            beforeOpenTemp(directory);
            validateParent();
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
            validateParent();
            validatePrivatePath(path, file.identity());
        }

        @Override
        public void moveAtomic(OpenedPrivateFile source, Path target) throws IOException {
            beforeMove(directory, source, target);
            validateParent();
            validatePrivatePath(source.path(), source.identity());
            try { validatePrivatePath(target, null); } catch (NoSuchFileException ignored) { }
            secure.move(source.path(), secure, target);
            forceDirectory();
        }

        @Override
        public void deleteIfExists(Path file) throws IOException {
            try {
                validateParent();
                validatePrivatePath(file, null);
                secure.deleteFile(file);
                forceDirectory();
            } catch (NoSuchFileException ignored) {
                // Already absent.
            }
        }

        private void validateParent() throws IOException {
            var named = Files.readAttributes(directory, java.nio.file.attribute.PosixFileAttributes.class,
                LinkOption.NOFOLLOW_LINKS);
            var held = secure.getFileAttributeView(Path.of("."), PosixFileAttributeView.class,
                LinkOption.NOFOLLOW_LINKS).readAttributes();
            var owner = directory.getFileSystem().getUserPrincipalLookupService()
                .lookupPrincipalByName(System.getProperty("user.name"));
            if (!named.isDirectory() || !parentKey.equals(named.fileKey()) || !parentKey.equals(held.fileKey())
                    || !named.permissions().equals(PosixFilePermissions.fromString("rwx------"))
                    || !held.permissions().equals(named.permissions())
                    || !named.owner().equals(owner) || !held.owner().equals(owner)) {
                throw new IOException("Projection parent identity, owner or permissions changed");
            }
        }

        private void forceDirectory() throws IOException {
            validateParent();
            try (FileChannel channel = FileChannel.open(directory, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
                validateParent();
                channel.force(true);
            }
            validateParent();
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
            if (view == null || !view.readAttributes().permissions().equals(PRIVATE_PERMISSIONS)
                    || !view.readAttributes().owner().equals(directory.getFileSystem().getUserPrincipalLookupService()
                        .lookupPrincipalByName(System.getProperty("user.name")))) {
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
