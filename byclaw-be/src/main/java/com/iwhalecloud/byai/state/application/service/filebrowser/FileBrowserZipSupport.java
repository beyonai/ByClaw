package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

final class FileBrowserZipSupport {

    private FileBrowserZipSupport() {
    }

    static void writeArchive(OutputStream outputStream, ZipArchiveWriter writer) throws IOException {
        Path archivePath = Files.createTempFile("byclaw-filebrowser-", ".zip");
        try {
            try (OutputStream archiveOutputStream = Files.newOutputStream(archivePath);
                 ZipOutputStream zipOutputStream = new ZipOutputStream(archiveOutputStream)) {
                writer.write(zipOutputStream);
                zipOutputStream.finish();
            }
            Files.copy(archivePath, outputStream);
            outputStream.flush();
        }
        finally {
            Files.deleteIfExists(archivePath);
        }
    }

    static void writeEntry(ZipOutputStream zipOutputStream, String entryName, InputStream inputStream,
        byte[] buffer, Long expectedSize) throws IOException {
        zipOutputStream.putNextEntry(new ZipEntry(entryName));
        try {
            long writtenSize = 0L;
            int length;
            while ((length = inputStream.read(buffer)) != -1) {
                if (length == 0) {
                    continue;
                }
                zipOutputStream.write(buffer, 0, length);
                writtenSize += length;
            }
            if (expectedSize != null && expectedSize >= 0 && writtenSize != expectedSize) {
                throw new IOException("文件流长度不完整: entry=" + entryName + ", expected=" + expectedSize
                    + ", actual=" + writtenSize);
            }
        }
        finally {
            zipOutputStream.closeEntry();
        }
    }

    @FunctionalInterface
    interface ZipArchiveWriter {

        void write(ZipOutputStream zipOutputStream) throws IOException;
    }
}
