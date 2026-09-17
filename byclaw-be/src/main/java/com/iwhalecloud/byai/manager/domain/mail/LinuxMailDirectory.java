package com.iwhalecloud.byai.manager.domain.mail;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.ReadableByteChannel;
import java.nio.channels.WritableByteChannel;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.locks.ReentrantLock;

import com.sun.jna.Library;
import com.sun.jna.Memory;
import com.sun.jna.Native;
import com.sun.jna.Platform;
import com.sun.jna.Pointer;

/** Linux descriptor-relative fallback. statx uses the fixed Linux UAPI layout on 64-bit platforms. */
final class LinuxMailDirectory implements MailAccountProjectionService.AnchoredDirectory {
    // Linux UAPI arch/arm64/include/uapi/asm/fcntl.h overrides these two generic flags.
    private static final int NOFOLLOW = Platform.isARM() ? 0x8000 : 0x20000;
    private static final int DIRECTORY = Platform.isARM() ? 0x4000 : 0x10000;
    private static final int CLOEXEC = 0x80000;
    private static final int RDWR = 2, CREATE = 0x40, EXCLUSIVE = 0x80, NONBLOCK = 0x800;
    private static final int NOFOLLOW_AT = 0x100, ENOENT = 2, EINTR = 4, EEXIST = 17;
    private static final ConcurrentHashMap<Identity, ReentrantLock> LOCKS = new ConcurrentHashMap<>();
    private final int directoryFd;
    private final Path displayPath;
    private final Identity identity;
    private final MailAccountProjectionService.NioFileOperations hooks;
    private final MailAccountProjectionService.ChannelWriter writer;
    private boolean closed;

    private LinuxMailDirectory(int fd, Path path, Identity identity,
            MailAccountProjectionService.NioFileOperations hooks, MailAccountProjectionService.ChannelWriter writer) {
        this.directoryFd = fd;
        this.displayPath = path;
        this.identity = identity;
        this.hooks = hooks;
        this.writer = writer;
    }

    static LinuxMailDirectory open(Path path, MailAccountProjectionService.ParentIdentity expected,
            MailAccountProjectionService.NioFileOperations hooks, MailAccountProjectionService.ChannelWriter writer)
            throws IOException {
        if (!Platform.isLinux() || !Platform.is64Bit() || !(Platform.isIntel() || Platform.isARM()))
            throw new IOException("Unsupported Linux native platform");
        if (expected.device() == null || expected.inode() == null) throw new IOException("Missing Linux directory identity");
        int fd = libc().open(path.toString(), DIRECTORY | NOFOLLOW | CLOEXEC, 0);
        if (fd < 0) throw error("open directory");
        try {
            Stat stat = stat(fd);
            Identity identity = stat.identity();
            if ((stat.mode & 0170000) != 0040000 || (stat.mode & 07777) != 0700 || stat.uid != libc().geteuid()
                    || identity.device() != expected.device() || identity.inode() != expected.inode()) {
                throw new IOException("Projection parent identity or private permissions changed");
            }
            return new LinuxMailDirectory(fd, path, identity, hooks, writer);
        } catch (IOException | RuntimeException | LinkageError e) {
            libc().close(fd);
            throw e;
        }
    }

    @Override
    public MailAccountProjectionService.ProjectionLock lock() throws IOException {
        validateParent();
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
            validatePrivate(statAt(Path.of(".mail-projection.lock")), stat(fd).identity());
            int result;
            do { result = libc().flock(fd, 2); } while (result < 0 && Native.getLastError() == EINTR);
            if (result < 0) throw error("lock projection");
            validateParent();
            validatePrivate(stat(fd), null);
            validatePrivate(statAt(Path.of(".mail-projection.lock")), stat(fd).identity());
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
        validateParent();
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
                validatePrivate(stat(fd), stat.identity());
                if (stat(fd).size != stat.size) throw new IOException("Mail projection changed during read");
                validatePrivate(statAt(path), stat.identity());
                validateParent();
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
        } catch (IOException | RuntimeException | LinkageError e) {
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
        Stat targetStat = statAtIfExists(target);
        if (targetStat != null) validatePrivate(targetStat, null);
        validatePrivate(statAt(source.path()), source.identity());
        if (libc().renameat(directoryFd, name(source.path()), directoryFd, name(target)) < 0) {
            throw error("atomically replace projection");
        }
        validatePrivate(statAt(target), source.identity());
        forceDirectory();
    }

    @Override
    public void deleteIfExists(Path path) throws IOException {
        validateParent();
        Stat before = statAtIfExists(path);
        if (before == null) return;
        validatePrivate(before, null);
        if (libc().unlinkat(directoryFd, name(path), 0) < 0 && Native.getLastError() != ENOENT) {
            throw error("unlink private file");
        }
        forceDirectory();
    }

    private void forceDirectory() throws IOException {
        if (libc().fsync(directoryFd) < 0) throw error("sync directory");
        validateParent();
    }

    private void validateParent() throws IOException {
        Stat held = stat(directoryFd);
        Stat named = statAt(-100, displayPath.toString(), NOFOLLOW_AT);
        if (!identity.equals(held.identity()) || !identity.equals(named.identity())
                || (held.mode & 0177777) != 0040700 || (named.mode & 0177777) != 0040700
                || held.uid != libc().geteuid() || named.uid != libc().geteuid()) {
            throw new IOException("Projection parent identity, owner or permissions changed");
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
        Stat result = statAtIfExists(path);
        if (result == null) throw new java.nio.file.NoSuchFileException("Private mail file");
        return result;
    }

    private Stat statAtIfExists(Path path) throws IOException {
        try {
            return statAt(directoryFd, name(path), NOFOLLOW_AT);
        } catch (java.nio.file.NoSuchFileException e) {
            return null;
        }
    }

    private static Stat stat(int fd) throws IOException {
        return statAt(fd, "", 0x1000 | NOFOLLOW_AT);
    }

    private static Stat statAt(int fd, String name, int flags) throws IOException {
        // struct statx is a fixed 256-byte UAPI record, independent of libc's struct stat ABI.
        try (Memory memory = new Memory(256)) {
            memory.clear();
            if (libc().statx(fd, name, flags, 0x7ff, memory) < 0) {
                if (Native.getLastError() == ENOENT) throw new java.nio.file.NoSuchFileException("Private mail file");
                throw error("inspect private file");
            }
            if ((memory.getInt(0) & 0x30f) != 0x30f) throw new IOException("Required file attributes unavailable");
            long major = Integer.toUnsignedLong(memory.getInt(136));
            long minor = Integer.toUnsignedLong(memory.getInt(140));
            long device = (minor & 0xff) | ((major & 0xfff) << 8)
                | ((minor & ~0xffL) << 12) | ((major & ~0xfffL) << 32);
            return new Stat(device, memory.getShort(28) & 0xffff, memory.getInt(16),
                memory.getLong(32), memory.getInt(20), memory.getLong(40));
        } catch (LinkageError e) {
            throw new IOException("Linux anchored file operations unavailable");
        }
    }

    private static void validatePrivate(Stat stat, Object expected) throws IOException {
        if ((stat.mode & 0170000) != 0100000 || (stat.mode & 07777) != 0600 || stat.links != 1 || stat.uid != libc().geteuid()) {
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
        return new IOException("Linux mail file operation failed: " + action + " (errno=" + Native.getLastError() + ")");
    }

    private record Identity(long device, long inode) { }

    private static LibC libc() { return Holder.INSTANCE; }

    private static class Holder {
        private static final LibC INSTANCE = Native.load(Platform.C_LIBRARY_NAME, LibC.class);
    }

    public interface LibC extends Library {
        int open(String path, int flags, Object... mode);
        int openat(int directory, String path, int flags, Object... mode);
        int statx(int directory, String path, int flags, int mask, Pointer buffer);
        int geteuid();
        int flock(int fd, int operation);
        int renameat(int sourceDirectory, String source, int targetDirectory, String target);
        int unlinkat(int directory, String path, int flags);
        long read(int fd, Pointer buffer, long count);
        long write(int fd, byte[] buffer, long count);
        int fsync(int fd);
        int close(int fd);
    }

    private record Stat(long device, int mode, int links, long inode, int uid, long size) {
        Identity identity() { return new Identity(device, inode); }
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
