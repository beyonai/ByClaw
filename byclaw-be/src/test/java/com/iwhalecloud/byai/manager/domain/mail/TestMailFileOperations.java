package com.iwhalecloud.byai.manager.domain.mail;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.channels.FileChannel;

/** Local macOS support is deliberately excluded from the production artifact. */
class TestMailFileOperations extends MailAccountProjectionService.NioFileOperations {
    private final MailAccountProjectionService.ChannelWriter writer;
    TestMailFileOperations() { this(FileChannel::write); }
    TestMailFileOperations(MailAccountProjectionService.ChannelWriter writer) {
        super(writer);
        this.writer = writer;
    }
    @Override
    public MailAccountProjectionService.AnchoredDirectory openDirectory(Path directory,
            MailAccountProjectionService.ParentIdentity identity) throws IOException {
        if (com.sun.jna.Platform.isMac()) {
            beforeOpenDirectory(directory);
            return DarwinMailDirectory.open(directory, identity, this, writer);
        }
        return super.openDirectory(directory, identity);
    }
}
