package com.iwhalecloud.byai.state.application.service.filebrowser;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FileBrowserZipSupportTest extends I18nTestSupport {
    @Test
    void incompleteStreamMessageTranslatesWithoutFormattingFileNamesOrSizes() throws Exception {
        try (ZipOutputStream output = new ZipOutputStream(new ByteArrayOutputStream())) {
            assertThatThrownBy(() -> FileBrowserZipSupport.writeEntry(output, "用户文件", new ByteArrayInputStream(new byte[0]),
                new byte[32], 9007199254740993L)).isInstanceOf(IOException.class)
                .hasMessage("文件流长度不完整: entry=用户文件, expected=9007199254740993, actual=0");
        }
        LocaleContextHolder.setLocale(Locale.US);
        try (ZipOutputStream output = new ZipOutputStream(new ByteArrayOutputStream())) {
            assertThatThrownBy(() -> FileBrowserZipSupport.writeEntry(output, "用户文件", new ByteArrayInputStream(new byte[0]),
                new byte[32], 9007199254740993L)).isInstanceOf(IOException.class)
                .hasMessage("Incomplete file stream: entry=用户文件, expected=9007199254740993, actual=0");
        }
    }
}
