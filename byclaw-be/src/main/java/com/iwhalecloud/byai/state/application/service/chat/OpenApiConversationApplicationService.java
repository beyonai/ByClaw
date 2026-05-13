package com.iwhalecloud.byai.state.application.service.chat;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.qo.MessageHotPageQo;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.manager.dto.session.ByaiSessionDto;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.qo.session.ByaiSessionQo;
import com.iwhalecloud.byai.state.domain.file.service.ConversationFileStorage;
import com.iwhalecloud.byai.state.domain.file.service.ConversationStoragePathResolver;
import com.iwhalecloud.byai.state.domain.session.dto.ConversationFilePathDto;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationAppendTxtQo;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationReadQo;
import com.iwhalecloud.byai.state.domain.session.qo.ConversationWriteTxtQo;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.template.enums.DebugModeEnum;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.concurrent.Callable;

/**
 * @author qin.guoquan
 * @date 2026-04-17 19:38:18 开放会话文件应用服务。 职责说明： 1. 本类是 OpenAPI 场景下的“应用编排层”，只负责把外部接口入参转换为会话文件业务动作； 2. 本类负责校验与规范化
 *       sessionId、filePath、objectKey、beginLine、endLine 等开放接口语义参数； 3. 本类负责根据 OpenAPI 入参中的 userCode 临时切换用户上下文，使底层 UserFS
 *       能定位到正确的 byclaw-{userCode} 用户空间； 4. 本类不直接操作 UserFS / MinIO / WhaleAgent 等存储实现，真实读写动作统一委托给
 *       ConversationFileStorage； 5. 与 ConversationFileStorage 的关系：本类关心“开放接口要做什么”，ConversationFileStorage 关心“会话文件怎么读写”。
 */
@Service
public class OpenApiConversationApplicationService {

    private static final Logger LOGGER = LoggerFactory.getLogger(OpenApiConversationApplicationService.class);

    public static final String SESSION_OBJECT_PREFIX = ConversationStoragePathResolver.SESSION_OBJECT_PREFIX;

    @Autowired
    private ConversationStoragePathResolver conversationStoragePathResolver;

    @Autowired
    private ConversationFileStorage conversationFileStorage;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ByaiMessageHotService byaiMessageHotService;

    public ConversationFilePathDto writeTxt(ConversationWriteTxtQo qo) {
        // 第一步：对外路径统一收敛，保证返回给调用方的 filePath 和内部 objectKey 规则一致。
        String normalizedFilePath = conversationStoragePathResolver.normalizeDisplayFilePath(qo.getFilePath());
        String fsPath = buildSessionFsPath(qo.getSessionId(), normalizedFilePath);
        String objectKey = buildSessionObjectKey(qo.getSessionId(), normalizedFilePath);
        // 第四步：根据文件后缀推断内容类型，便于 MinIO / 下游按文件语义处理对象。
        String contentType = resolveContentType(normalizedFilePath);
        String content = StringUtils.defaultString(qo.getContent());
        int contentLength = content.getBytes(StandardCharsets.UTF_8).length;
        LOGGER.info("开放会话文件覆盖写入内容, userCode={}, sessionId={}, fsPath={}, objectKey={}, contentLength={}, content={}",
            qo.getUserCode(), qo.getSessionId(), fsPath, objectKey, contentLength, content);
        // 第五步：执行覆盖写，这一步会直接把对象内容替换为最新文本。
        withUserContext(qo.getUserCode(), () -> {
            conversationFileStorage.writeText(toStorageLocation(qo.getUserCode(), fsPath), content, contentType);
            return null;
        });
        LOGGER.info("开放会话文件覆盖写入完成, userCode={}, sessionId={}, fsPath={}, objectKey={}, contentLength={}",
            qo.getUserCode(), qo.getSessionId(), fsPath, objectKey, contentLength);
        return new ConversationFilePathDto(normalizedFilePath, objectKey);
    }

    public ConversationFilePathDto appendTxt(ConversationAppendTxtQo qo) {
        // 追加写和覆盖写共用同一套 bucket / objectKey 规则，避免同一文件出现多套定位方式。
        String normalizedFilePath = conversationStoragePathResolver.normalizeDisplayFilePath(qo.getFilePath());
        String fsPath = buildSessionFsPath(qo.getSessionId(), normalizedFilePath);
        String objectKey = buildSessionObjectKey(qo.getSessionId(), normalizedFilePath);
        String contentType = resolveContentType(normalizedFilePath);
        String content = StringUtils.defaultString(qo.getContent());
        int contentLength = content.getBytes(StandardCharsets.UTF_8).length;
        LOGGER.info("开放会话文件追加写入内容, userCode={}, sessionId={}, fsPath={}, objectKey={}, appendedLength={}, content={}",
            qo.getUserCode(), qo.getSessionId(), fsPath, objectKey, contentLength, content);
        // 底层会自动处理“文件不存在时退化为新建文件”的场景，调用方不需要区分首次写入还是追加写入。
        withUserContext(qo.getUserCode(), () -> {
            conversationFileStorage.appendText(toStorageLocation(qo.getUserCode(), fsPath), content, contentType);
            return null;
        });
        LOGGER.info("开放会话文件追加写入完成, userCode={}, sessionId={}, fsPath={}, objectKey={}, appendedLength={}",
            qo.getUserCode(), qo.getSessionId(), fsPath, objectKey, contentLength);
        return new ConversationFilePathDto(normalizedFilePath, objectKey);
    }

    public StreamingResponseBody read(ConversationReadQo qo) {
        // 读取链路同样先统一路径，再把“按行截取”的职责交给底层文件服务处理。
        String fsPath = StringUtils.isNotBlank(qo.getObjectKey()) ? normalizeObjectKeyPath(qo.getObjectKey())
            : buildSessionFsPath(qo.getSessionId(),
                conversationStoragePathResolver.normalizeDisplayFilePath(qo.getFilePath()));
        String objectKey = toObjectKey(fsPath);

        int beginLine = normalizeBeginLine(qo.getBeginLine());
        int endLine = normalizeEndLine(beginLine, qo.getEndLine());
        LOGGER.info("开放会话文件按行读取开始, fsPath={}, objectKey={}, beginLine={}, endLine={}", fsPath, objectKey, beginLine,
            endLine);
        return outputStream -> {
            try {
                LOGGER.info(
                    "开放会话文件按行读取流式执行开始, userCode={}, sessionId={}, fsPath={}, objectKey={}, beginLine={}, endLine={}",
                    qo.getUserCode(), qo.getSessionId(), fsPath, objectKey, beginLine, endLine);
                ByteArrayOutputStream cacheOutputStream = new ByteArrayOutputStream();
                withUserContext(qo.getUserCode(), () -> {
                    conversationFileStorage.streamTextByLines(toStorageLocation(qo.getUserCode(), fsPath), beginLine,
                        endLine, cacheOutputStream);
                    return null;
                });
                byte[] contentBytes = cacheOutputStream.toByteArray();
                String content = new String(contentBytes, StandardCharsets.UTF_8);
                LOGGER.info(
                    "开放会话文件按行读取内容, userCode={}, sessionId={}, fsPath={}, objectKey={}, beginLine={}, endLine={}, contentLength={}, content={}",
                    qo.getUserCode(), qo.getSessionId(), fsPath, objectKey, beginLine, endLine, contentBytes.length,
                    content);
                outputStream.write(contentBytes);
                outputStream.flush();
                LOGGER.info(
                    "开放会话文件按行读取流式执行完成, userCode={}, sessionId={}, fsPath={}, objectKey={}, beginLine={}, endLine={}, contentLength={}",
                    qo.getUserCode(), qo.getSessionId(), fsPath, objectKey, beginLine, endLine, contentBytes.length);
            }
            catch (Exception e) {
                LOGGER.error(
                    "开放会话文件按行读取流式执行失败, userCode={}, sessionId={}, fsPath={}, objectKey={}, beginLine={}, endLine={}",
                    qo.getUserCode(), qo.getSessionId(), fsPath, objectKey, beginLine, endLine, e);
                throw e;
            }
        };
    }

    private static <T> T withUserContext(String userCode, Callable<T> callable) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException("userCode不能为空");
        }
        LoginInfo originalLoginInfo = CurrentUserHolder.getLoginInfo();
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(userCode.trim());
        CurrentUserHolder.setLoginInfo(loginInfo);
        try {
            return callable.call();
        }
        catch (RuntimeException e) {
            throw e;
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
        finally {
            restoreLoginInfo(originalLoginInfo);
        }
    }

    private static void restoreLoginInfo(LoginInfo originalLoginInfo) {
        if (originalLoginInfo == null) {
            CurrentUserHolder.clearLoginInfo();
            return;
        }
        CurrentUserHolder.setLoginInfo(originalLoginInfo);
    }

    private static String buildSessionFsPath(String sessionId, String normalizedFilePath) {
        if (StringUtils.isBlank(sessionId)) {
            throw new IllegalArgumentException("sessionId不能为空");
        }
        return "/.sessions/" + sessionId.trim() + "/" + stripLeadingSlash(normalizedFilePath);
    }

    private static String buildSessionObjectKey(String sessionId, String normalizedFilePath) {
        if (StringUtils.isBlank(sessionId)) {
            throw new IllegalArgumentException("sessionId不能为空");
        }
        return SESSION_OBJECT_PREFIX + "/" + sessionId.trim() + "/" + stripLeadingSlash(normalizedFilePath);
    }

    private static String normalizeObjectKeyPath(String objectKey) {
        String normalized = StringUtils.trimToEmpty(objectKey).replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.isBlank(normalized)) {
            throw new IllegalArgumentException("objectKey不能为空");
        }
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        for (String part : normalized.split("/")) {
            if ("..".equals(part)) {
                throw new IllegalArgumentException("objectKey不能包含..路径穿越片段");
            }
        }
        return normalized;
    }

    private static String toObjectKey(String fsPath) {
        return fsPath;
    }

    /**
     * 将开放接口的会话文件路径转换成底层存储位置。
     *
     * @author qin.guoquan
     * @date 2026-05-09 141852
     * @param userCode 用户编码
     * @param fsPath 会话文件路径
     * @return 存储位置
     */
    private StorageLocation toStorageLocation(String userCode, String fsPath) {
        return conversationStoragePathResolver.objectKey(userCode, fsPath);
    }

    private static String stripLeadingSlash(String path) {
        String result = StringUtils.defaultString(path);
        while (result.startsWith("/")) {
            result = result.substring(1);
        }
        return result;
    }

    private static int normalizeBeginLine(Integer beginLine) {
        if (beginLine == null) {
            return 0;
        }
        if (beginLine < 0) {
            throw new IllegalArgumentException("begin_line不能小于0");
        }
        return beginLine;
    }

    private static int normalizeEndLine(int beginLine, Integer endLine) {
        if (endLine == null) {
            return -1;
        }
        if (endLine == -1) {
            return -1;
        }
        if (endLine <= beginLine) {
            throw new IllegalArgumentException("end_line必须大于begin_line，或传-1表示读到结尾");
        }
        return endLine;
    }

    private static String resolveContentType(String filePath) {
        // 这里优先覆盖当前已知的文本类型；其余后缀统一按二进制对象处理。
        String lowerCasePath = StringUtils.lowerCase(filePath);
        if (lowerCasePath.endsWith(".json")) {
            return "application/json";
        }
        if (lowerCasePath.endsWith(".csv")) {
            return "text/csv";
        }
        if (lowerCasePath.endsWith(".md") || lowerCasePath.endsWith(".markdown")) {
            return "text/markdown";
        }
        if (lowerCasePath.endsWith(".txt")) {
            return "text/plain";
        }
        return "application/octet-stream";
    }

    /**
     * 创建会话
     *
     * @param session 会话标题
     * @return ResponseUtil
     */
    public ByaiSession createSession(ByaiSession session) {
        session.setSessionId(sequenceService.nextVal());
        session.setCreatorId(CurrentUserHolder.getCurrentUserId());
        session.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        session.setCreateTime(new Date());
        session.setUpdateTime(new Date());
        session.setParentSessionId(-1L);
        session.setIsDebug(DebugModeEnum.DEBUG_0.getNum());
        session.setSessionType(SessionType.H_AS.getCode());
        return sessionService.save(session);
    }

    /**
     * @param updateSession 更新会话
     * @return ByaiSession
     */
    public ByaiSession updateSession(ByaiSession updateSession) {
        ByaiSession session = sessionService.findById(updateSession.getSessionId());
        session.setUpdateTime(new Date());
        session.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        session.setSessionName(updateSession.getSessionName());
        session.setSessionContent(updateSession.getSessionContent());
        sessionService.update(session);
        return session;
    }

    /**
     * 仅查询当前用户
     *
     * @param byaiSessionQo 查询对象
     * @return PageInfo
     */
    public PageInfo<ByaiSessionDto> qrySessionsByQo(ByaiSessionQo byaiSessionQo) {
        byaiSessionQo.setCreatorId(CurrentUserHolder.getCurrentUserId());
        return sessionService.qryConversations(byaiSessionQo);
    }

    /**
     * 查询消息青鱼有
     *
     * @param messageHotPageQo 查询对象
     * @return PageInfo
     */
    public PageInfo<ByaiMessage> qryMessagesByQo(MessageHotPageQo messageHotPageQo) {
        return byaiMessageHotService.selectByPageQo(messageHotPageQo);
    }
}
