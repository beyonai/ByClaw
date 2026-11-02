package com.iwhalecloud.byai.state.application.service.filepreview;

import java.io.InputStream;
import java.util.Locale;
import java.util.Set;

import org.apache.poi.poifs.filesystem.FileMagic;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.state.domain.resource.converter.FileConverterContext;

/** 仅处理调用方已取得的文件内容，不接受远程 URL 或存储路径，转换结果不落库。 */
@Service
public class FilePreviewApplicationService {

    public static final int MAX_FILE_SIZE = 20 * 1024 * 1024;

    private static final Set<String> SUPPORTED_TYPES = Set.of("doc", "ppt");

    private static final Logger LOGGER = LoggerFactory.getLogger(FilePreviewApplicationService.class);

    private final FileConverterContext converter;

    private final MessageSource messageSource;

    public FilePreviewApplicationService(FileConverterContext converter, MessageSource messageSource) {
        this.converter = converter;
        this.messageSource = messageSource;
    }

    public byte[] convert(MultipartFile file) {
        String name = file.getOriginalFilename();
        String extension = name == null ? "" : name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (name == null || !name.contains(".") || !SUPPORTED_TYPES.contains(extension)) {
            throw failure(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "file.preview.unsupported");
        }
        if (file.isEmpty()) {
            throw failure(HttpStatus.BAD_REQUEST, "file.preview.empty");
        }
        if (file.getSize() > MAX_FILE_SIZE) {
            throw failure(HttpStatus.PAYLOAD_TOO_LARGE, "file.preview.too.large");
        }
        try (InputStream input = file.getInputStream()) {
            byte[] bytes = input.readNBytes(MAX_FILE_SIZE + 1);
            if (bytes.length > MAX_FILE_SIZE) {
                throw failure(HttpStatus.PAYLOAD_TOO_LARGE, "file.preview.too.large");
            }
            // 扩展名不能代替格式校验，拒绝改名的 ZIP、HTML 或现代 Office 文件。
            if (FileMagic.valueOf(bytes) != FileMagic.OLE2) {
                throw failure(HttpStatus.UNPROCESSABLE_ENTITY, "file.preview.failed");
            }
            return converter.convertFileToPdf(bytes, "preview." + extension);
        }
        catch (ResponseStatusException e) {
            throw e;
        }
        catch (Exception e) {
            LOGGER.warn("Legacy Office preview conversion failed, type={}", extension, e);
            throw failure(HttpStatus.UNPROCESSABLE_ENTITY, "file.preview.failed");
        }
    }

    private ResponseStatusException failure(HttpStatus status, String key) {
        return new ResponseStatusException(status, messageSource.getMessage(key, null, LocaleContextHolder.getLocale()));
    }
}
