package com.iwhalecloud.byai.state.domain.file.service;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import org.apache.commons.io.IOUtils;
import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 会话文件存储能力门面。
 *
 * 职责说明：
 * 1. 本类是“会话文件存储能力层”，只负责给定会话文件路径后的读、写、追加、按行读取、列表查询等底层文件动作；
 * 2. 本类不关心调用方来自 OpenAPI、普通对话上传还是其他业务入口，也不处理 HTTP、DTO、Controller 响应等应用层语义；
 * 3. 本类统一通过 UserFS 读写用户空间文件，底层实际落到 byclaw-{userCode} 用户文件系统，并由 UserFS 处理 /by 根路径转换；
 * 4. 调用方需要在进入本类前准备好正确的 CurrentUserHolder 用户上下文，或通过 ConversationStoragePathResolver 生成规范化路径；
 * 5. 与 OpenApiConversationApplicationService 的关系：OpenApiConversationApplicationService 负责开放接口编排，本类负责真实文件读写。
 */
@Service
public class ConversationFileStorage {

    @Autowired
    private UserFS userFS;

    public void writeText(StorageLocation location, String content, String contentType) {
        byte[] bytes = StringUtils.defaultString(content).getBytes(StandardCharsets.UTF_8);
        writeBytes(location, bytes, contentType);
    }

    public void writeBytes(StorageLocation location, byte[] bytes, String contentType) {
        bytes = bytes == null ? new byte[0] : bytes;
        userFS.write(toMultipartFile(location, bytes, contentType), location.getPath());
    }

    public void appendText(StorageLocation location, String content, String contentType) {
        String originalContent = readWholeTextIfExists(location);
        writeText(location, StringUtils.defaultString(originalContent) + StringUtils.defaultString(content), contentType);
    }

    public void streamTextByLines(StorageLocation location, int beginLine, int endLine, OutputStream outputStream) {
        try (InputStream inputStream = userFS.read(location.getPath());
             BufferedReader reader = new BufferedReader(new InputStreamReader(inputStream, StandardCharsets.UTF_8))) {
            int currentLine = 0;
            boolean firstLine = true;
            String line;
            while ((line = reader.readLine()) != null) {
                if (currentLine >= beginLine && (endLine < 0 || currentLine < endLine)) {
                    if (!firstLine) {
                        outputStream.write('\n');
                    }
                    outputStream.write(line.getBytes(StandardCharsets.UTF_8));
                    firstLine = false;
                }
                if (endLine >= 0 && currentLine >= endLine - 1) {
                    break;
                }
                currentLine++;
            }
            outputStream.flush();
        }
        catch (Exception e) {
            throw new BaseException("会话文件读取失败: " + location.getPath(), e);
        }
    }

    public String readWholeTextIfExists(StorageLocation location) {
        try (InputStream inputStream = userFS.read(location.getPath())) {
            return IOUtils.toString(inputStream, StandardCharsets.UTF_8);
        }
        catch (RuntimeException e) {
            return null;
        }
        catch (IOException e) {
            throw new BaseException("会话文件读取失败: " + location.getPath(), e);
        }
    }

    public List<String> listObjectKeys(StoragePrefix prefix) {
        return userFS.list(prefix.getPrefix(), null);
    }

    /**
     * 将会话文件内容包装成 UserFS 可写入的 MultipartFile。
     *
     * @author qin.guoquan
     * @date 2026-05-09 135953
     * @param location 会话文件位置
     * @param bytes 文件内容
     * @param contentType 文件类型
     * @return MultipartFileUtil
     */
    private MultipartFileUtil toMultipartFile(StorageLocation location, byte[] bytes, String contentType) {
        String fileName = FilenameUtils.getName(location.getPath());
        return new MultipartFileUtil(fileName, fileName, contentType, bytes);
    }
}
