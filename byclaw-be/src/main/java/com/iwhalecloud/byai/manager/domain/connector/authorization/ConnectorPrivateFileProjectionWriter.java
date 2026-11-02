package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;

import org.springframework.stereotype.Component;

/** Safely materializes a private connector payload into a user's mounted workspace. */
@Component
public class ConnectorPrivateFileProjectionWriter {
    @org.springframework.beans.factory.annotation.Autowired
    private com.iwhalecloud.byai.gateway.sandbox.platform.PlatformPrivateFileSystemRouting platformPrivateFiles;



    public static final long MAX_PROJECTION_BYTES = 64 * 1024L;
    private static final Set<PosixFilePermission> PRIVATE_FILE_PERMISSIONS = Set.of(
        PosixFilePermission.OWNER_READ,
        PosixFilePermission.OWNER_WRITE);

    public void write(Path target, String content) {
        if (target == null || content == null) {
            throw new IllegalArgumentException("Projection target and content are required");
        }
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > MAX_PROJECTION_BYTES) {
            throw new IllegalArgumentException("Connector projection exceeds 64 KiB");
        }
        if (platformPrivateFiles.isRemote()) {
            platformPrivateFiles.writeAtomic(target, bytes, ".connector-projection-");
            return;
        }
        if (Files.isSymbolicLink(target)) {
            throw new IllegalStateException("Connector projection target must not be a symbolic link");
        }

        Path directory = target.getParent();
        if (directory == null || !Files.isDirectory(directory)) {
            throw new IllegalStateException("Connector projection directory does not exist");
        }
        Path temporary = null;
        try {
            temporary = Files.createTempFile(directory, ".connector-projection-", ".tmp");
            applyPrivatePermissions(temporary);
            try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
                channel.write(ByteBuffer.wrap(bytes));
                channel.force(true);
            }
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
            temporary = null;
            applyPrivatePermissions(target);
        } catch (IOException | SecurityException e) {
            throw new IllegalStateException("Unable to write connector private projection", e);
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // A later workspace cleanup can remove an abandoned private temporary file.
                }
            }
        }
    }

    public void delete(Path target) {
        if (target == null) {
            throw new IllegalArgumentException("Projection target is required");
        }
        if (platformPrivateFiles.isRemote()) { platformPrivateFiles.delete(target); return; }
        try {
            Files.deleteIfExists(target);
        } catch (IOException | SecurityException e) {
            throw new IllegalStateException("Unable to delete connector private projection", e);
        }
    }

    private void applyPrivatePermissions(Path file) throws IOException {
        if (Files.getFileAttributeView(file, PosixFileAttributeView.class) != null) {
            Files.setPosixFilePermissions(file, PRIVATE_FILE_PERMISSIONS);
        }
    }
}
