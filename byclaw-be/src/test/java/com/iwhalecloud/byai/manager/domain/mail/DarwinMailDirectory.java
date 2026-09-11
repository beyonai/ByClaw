package com.iwhalecloud.byai.manager.domain.mail;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.ReadableByteChannel;
import java.nio.channels.WritableByteChannel;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

import com.sun.jna.FunctionMapper;
import com.sun.jna.Library;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Platform;
import com.sun.jna.Pointer;
import com.sun.jna.Structure;

/**
 * Darwin's JDK does not implement SecureDirectoryStream. Use descriptor-relative system calls instead.
 * Constants and stat layout follow Darwin sys/fcntl.h and __DARWIN_STRUCT_STAT64 (LP64 arm64/x86_64).
 * Never fall back to resolving child paths after the directory descriptor has been opened.
 */
final class DarwinMailDirectory implements MailAccountProjectionService.AnchoredDirectory {
    private static final int NOFOLLOW = 0x100, DIRECTORY = 0x100000, CLOEXEC = 0x1000000;
    private static final int RDWR = 2, CREATE = 0x200, EXCLUSIVE = 0x800, NONBLOCK = 4;
    private static final int NOFOLLOW_AT = 0x20, ENOENT = 2, EINTR = 4, EEXIST = 17;
    private static final ConcurrentHashMap<Identity, ReentrantLock> LOCKS = new ConcurrentHashMap<>();
    private final int directoryFd;
    private final Path displayPath;
    private final Identity identity;
    private final MailAccountProjectionService.NioFileOperations hooks;
    private final MailAccountProjectionService.ChannelWriter writer;
    private boolean closed;

    private DarwinMailDirectory(int fd, Path path, Identity identity,
            MailAccountProjectionService.NioFileOperations hooks, MailAccountProjectionService.ChannelWriter writer) {
        this.directoryFd = fd;
        this.displayPath = path;
        this.identity = identity;
        this.hooks = hooks;
        this.writer = writer;
    }

    static DarwinMailDirectory open(Path path, MailAccountProjectionService.ParentIdentity expected,
            MailAccountProjectionService.NioFileOperations hooks, MailAccountProjectionService.ChannelWriter writer)
            throws IOException {
        if (expected.device() == null || expected.inode() == null) throw new IOException("Missing Darwin directory identity");
        int fd = libc().open(path.toString(), DIRECTORY | NOFOLLOW | CLOEXEC, 0);
        if (fd < 0) throw error("open directory");
        try {
            Stat stat = stat(fd);
            Identity identity = stat.identity();
            if ((stat.mode & 0170000) != 0040000 || (stat.mode & 077) != 0
                    || identity.device() != (expected.device() & 0xffffffffL) || identity.inode() != expected.inode()) {
                throw new IOException("Projection parent identity or private permissions changed");
            }
            return new DarwinMailDirectory(fd, path, identity, hooks, writer);
        } catch (IOException | RuntimeException e) {
            libc().close(fd);
            throw e;
        }
    }

    @Override
    public MailAccountProjectionService.ProjectionLock lock() throws IOException {
        ReentrantLock local = LOCKS.computeIfAbsent(identity, ignored -> new ReentrantLock());
        local.lock();
        int fd = -1;
        try {
            fd = libc().openat(directoryFd, ".mail-projection.lock", RDWR | CREATE | EXCLUSIVE | NOFOLLOW | CLOEXEC, 0600);
            if (fd < 0 && Native.getLastError() == EEXIST) {
                fd = libc().openat(directoryFd, ".mail-projection.lock", RDWR | NOFOLLOW | CLOEXEC | NONBLOCK, 0);
            }
            if (fd < 0) throw error("open lock");
            validatePrivate(stat(fd), null);
            int result;
            do { result = libc().flock(fd, 2); } while (result < 0 && Native.getLastError() == EINTR);
            if (result < 0) throw error("lock projection");
            int heldFd = fd;
            return () -> {
                try {
                    // Closing also releases flock, including when an explicit unlock fails.
                    libc().flock(heldFd, 8);
                    libc().close(heldFd);
                } finally {
                    local.unlock();
                }
            };
        } catch (IOException | RuntimeException e) {
            if (fd >= 0) libc().close(fd);
            local.unlock();
            throw e;
        }
    }

    @Override
    public byte[] readPrivateIfExists(Path path, int maximumBytes) throws IOException {
        int fd = libc().openat(directoryFd, name(path), NOFOLLOW | CLOEXEC | NONBLOCK, 0);
        if (fd < 0) {
            if (Native.getLastError() == ENOENT) return null;
            throw error("open projection for reading");
        }
        try {
            Stat stat = stat(fd);
            validatePrivate(stat, null);
            if (stat.size < 0 || stat.size > maximumBytes) throw new IOException("Mail projection exceeds read limit");
            if (stat.size == 0) return new byte[0];
            try (Memory buffer = new Memory(stat.size)) {
                long offset = 0;
                while (offset < stat.size) {
                    long count = libc().read(fd, buffer.share(offset), stat.size - offset);
                    if (count < 0 && Native.getLastError() == EINTR) continue;
                    if (count <= 0) throw new IOException("Mail projection read failed or changed");
                    offset += count;
                }
                return buffer.getByteArray(0, (int) stat.size);
            }
        } finally {
            libc().close(fd);
        }
    }

    @Override
    public MailAccountProjectionService.OpenedPrivateFile openPrivateTemp() throws IOException {
        hooks.beforeOpenTemp(displayPath);
        validateParent();
        Path path = Path.of(".mail-accounts-" + UUID.randomUUID() + ".tmp");
        int fd = libc().openat(directoryFd, name(path), RDWR | CREATE | EXCLUSIVE | NOFOLLOW | CLOEXEC, 0600);
        if (fd < 0) throw error("create private temporary file");
        try {
            Stat stat = stat(fd);
            validatePrivate(stat, null);
            return new MailAccountProjectionService.OpenedPrivateFile(path, new NativeChannel(fd), stat.identity());
        } catch (IOException | RuntimeException e) {
            libc().close(fd);
            deleteIfExists(path);
            throw e;
        }
    }

    @Override
    public void writeAndForce(MailAccountProjectionService.OpenedPrivateFile file, byte[] content) throws IOException {
        ByteBuffer buffer = ByteBuffer.wrap(content);
        int zeroWrites = 0;
        while (buffer.hasRemaining()) {
            int written = writer.write(file.channel(), buffer);
            if (written < 0) throw new IOException("Unexpected end while writing mail projection");
            if (written == 0) {
                if (++zeroWrites >= 16) throw new IOException("Mail projection write made no progress");
            } else {
                zeroWrites = 0;
            }
        }
        file.channel().force(true);
    }

    @Override
    public void validateIdentity(MailAccountProjectionService.OpenedPrivateFile file, Path path) throws IOException {
        hooks.beforeValidateIdentity(displayPath, file, path);
        validateParent();
        validatePrivate(statAt(path), file.identity());
    }

    @Override
    public void moveAtomic(MailAccountProjectionService.OpenedPrivateFile source, Path target) throws IOException {
        hooks.beforeMove(displayPath, source, target);
        validateParent();
        validateTargetIfExists(target);
        validatePrivate(statAt(source.path()), source.identity());
        if (libc().renameat(directoryFd, name(source.path()), directoryFd, name(target)) < 0) {
            throw error("atomically replace projection");
        }
    }

    @Override
    public void deleteIfExists(Path path) throws IOException {
        validateParent();
        validateTargetIfExists(path);
        if (libc().unlinkat(directoryFd, name(path), 0) < 0 && Native.getLastError() != ENOENT) {
            throw error("unlink private file");
        }
    }

    private void validateTargetIfExists(Path path) throws IOException {
        Stat stat = new Stat();
        if (libc().fstatat(directoryFd, name(path), stat, NOFOLLOW_AT) < 0) {
            if (Native.getLastError() == ENOENT) return;
            throw error("inspect target");
        }
        validatePrivate(stat, null);
    }

    private void validateParent() throws IOException {
        var values = java.nio.file.Files.readAttributes(displayPath, "unix:dev,ino,mode", java.nio.file.LinkOption.NOFOLLOW_LINKS);
        if (((Number) values.get("dev")).longValue() != identity.device()
                || ((Number) values.get("ino")).longValue() != identity.inode()
                || (((Number) values.get("mode")).intValue() & 0177777) != 0040700) {
            throw new IOException("Projection parent changed");
        }
    }

    @Override
    public void close() {
        if (!closed) {
            closed = true;
            libc().close(directoryFd);
        }
    }

    private Stat statAt(Path path) throws IOException {
        Stat stat = new Stat();
        if (libc().fstatat(directoryFd, name(path), stat, NOFOLLOW_AT) < 0) throw error("inspect private file");
        return stat;
    }

    private static Stat stat(int fd) throws IOException {
        Stat stat = new Stat();
        if (libc().fstat(fd, stat) < 0) throw error("inspect descriptor");
        return stat;
    }

    private static void validatePrivate(Stat stat, Object expected) throws IOException {
        if ((stat.mode & 0170000) != 0100000 || (stat.mode & 0777) != 0600 || stat.links != 1) {
            throw new IOException("Mail projection is not a private regular file");
        }
        if (expected != null && !expected.equals(stat.identity())) throw new IOException("Mail projection file identity changed");
    }

    private static String name(Path path) throws IOException {
        if (path.isAbsolute() || path.getNameCount() != 1 || path.toString().equals(".")
                || path.toString().equals("..") || path.toString().isBlank()) throw new IOException("Invalid relative filename");
        return path.toString();
    }

    private static IOException error(String action) {
        return new IOException("Darwin mail file operation failed: " + action + " (errno=" + Native.getLastError() + ")");
    }

    private record Identity(long device, long inode) { }

    private static LibC libc() { return Holder.INSTANCE; }

    private static class Holder {
        private static final LibC INSTANCE = Native.load("System", LibC.class, Map.of(Library.OPTION_FUNCTION_MAPPER,
            (FunctionMapper) (library, method) -> Platform.isIntel()
                && (method.getName().equals("fstat") || method.getName().equals("fstatat"))
                    ? method.getName() + "$INODE64" : method.getName()));
    }

    public interface LibC extends Library {
        int open(String path, int flags, Object... mode);
        int openat(int directory, String path, int flags, Object... mode);
        int fstat(int fd, Stat stat);
        int fstatat(int directory, String path, Stat stat, int flags);
        int flock(int fd, int operation);
        int renameat(int sourceDirectory, String source, int targetDirectory, String target);
        int unlinkat(int directory, String path, int flags);
        long read(int fd, Pointer buffer, long count);
        long write(int fd, byte[] buffer, long count);
        int fsync(int fd);
        int close(int fd);
    }

    @Structure.FieldOrder({"device", "mode", "links", "inode", "uid", "gid", "rdev", "times",
        "size", "blocks", "blockSize", "flags", "generation", "spare", "qspare"})
    public static class Stat extends Structure {
        public int device;
        public short mode, links;
        public long inode;
        public int uid, gid, rdev;
        public long[] times = new long[8]; // atime, mtime, ctime, birthtime: seconds and nanoseconds each.
        public long size, blocks;
        public int blockSize, flags, generation, spare;
        public long[] qspare = new long[2];
        Identity identity() { return new Identity(Integer.toUnsignedLong(device), inode); }
    }

    /** Minimal write channel backed by the already-open descriptor; no pathname is reopened. */
    private static final class NativeChannel extends FileChannel {
        private final int fd;
        NativeChannel(int fd) { this.fd = fd; }

        @Override public int write(ByteBuffer source) throws IOException {
            if (!isOpen()) throw new java.nio.channels.ClosedChannelException();
            byte[] data = new byte[source.remaining()];
            source.duplicate().get(data);
            long count;
            do { count = libc().write(fd, data, data.length); } while (count < 0 && Native.getLastError() == EINTR);
            if (count < 0) throw error("write private file");
            source.position(source.position() + (int) count);
            return (int) count;
        }
        @Override public void force(boolean metadata) throws IOException {
            if (!isOpen()) throw new java.nio.channels.ClosedChannelException();
            if (libc().fsync(fd) < 0) throw error("sync private file");
        }
        @Override protected void implCloseChannel() { libc().close(fd); }
        @Override public int read(ByteBuffer dst) { throw new UnsupportedOperationException(); }
        @Override public long read(ByteBuffer[] dsts, int offset, int length) { throw new UnsupportedOperationException(); }
        @Override public long write(ByteBuffer[] srcs, int offset, int length) { throw new UnsupportedOperationException(); }
        @Override public long position() { throw new UnsupportedOperationException(); }
        @Override public FileChannel position(long position) { throw new UnsupportedOperationException(); }
        @Override public long size() { throw new UnsupportedOperationException(); }
        @Override public FileChannel truncate(long size) { throw new UnsupportedOperationException(); }
        @Override public long transferTo(long position, long count, WritableByteChannel target) { throw new UnsupportedOperationException(); }
        @Override public long transferFrom(ReadableByteChannel src, long position, long count) { throw new UnsupportedOperationException(); }
        @Override public int read(ByteBuffer dst, long position) { throw new UnsupportedOperationException(); }
        @Override public int write(ByteBuffer src, long position) { throw new UnsupportedOperationException(); }
        @Override public MappedByteBuffer map(MapMode mode, long position, long size) { throw new UnsupportedOperationException(); }
        @Override public FileLock lock(long position, long size, boolean shared) { throw new UnsupportedOperationException(); }
        @Override public FileLock tryLock(long position, long size, boolean shared) { throw new UnsupportedOperationException(); }
    }
}
