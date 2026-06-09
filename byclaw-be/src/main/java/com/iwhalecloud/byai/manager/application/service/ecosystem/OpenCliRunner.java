package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import javax.mail.Address;
import javax.mail.BodyPart;
import javax.mail.Flags;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.internet.MimeUtility;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
import org.jsoup.Jsoup;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

/**
 * OpenCLI 采集运行器。
 * @author qin.guoquan
 * @date 2026-05-29 21:12:18
 */
@Service
public class OpenCliRunner {

    /**
     * 知乎收藏夹 ID 提取规则，兼容 collection/123、collection=123 和纯数字。
     */
    private static final Pattern COLLECTION_PATTERN = Pattern.compile("(?:collection/|collection=|^)(\\d{3,})");
    /**
     * 知乎问题 ID 提取规则。
     */
    private static final Pattern QUESTION_PATTERN = Pattern.compile("question/(\\d{3,})");
    /**
     * 通用数字 ID 提取规则。
     */
    private static final Pattern NUMBER_PATTERN = Pattern.compile("\\d{3,}");
    /**
     * 日期范围提取规则，兼容前端“2026-05-01 至 2026-05-31”这类范围文本。
     */
    private static final Pattern DATE_PATTERN = Pattern.compile("(\\d{4}-\\d{2}-\\d{2})");
    /**
     * 未指定范围时的默认采集数量上限。
     */
    private static final int DEFAULT_LIMIT = 20;
    /**
     * IMAP P0 单次最多扫描最近若干封邮件，避免首次同步阻塞接口线程。
     */
    private static final int DEFAULT_IMAP_SCAN_LIMIT = 200;
    /**
     * 邮件附件单文件最大保留大小，超过时只在 Markdown 中记录文件名。
     */
    private static final int MAX_MAIL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

    /**
     * JSON 解析器，用于解析 OpenCLI JSON 输出。
     */
    @Autowired
    private ObjectMapper objectMapper;

    /**
     * Spring 环境变量读取器，用于获取 OpenCLI 路径、Profile、超时等配置。
     */
    @Autowired
    private Environment environment;

    /**
     * OpenCLI manifest 能力目录，用于动态构造非硬编码站点命令。
     */
    @Autowired
    private OpenCliCapabilityService openCliCapabilityService;

    /**
     * 执行一次 OpenCLI 采集，并把命令输出归一化为 Markdown 条目和附件统计。
     *
     * @param task 采集任务
     * @param runId 本次运行 ID，用于生成临时输出目录
     * @return 归一化后的采集结果
     */
    public CollectionResult collect(EcosystemTaskVo task, Long runId) {
        Path outputDir = createOutputDirectory(runId);
        if ("mail".equalsIgnoreCase(defaultText(task.getConnectorCode(), ""))) {
            return collectMail(task, outputDir);
        }
        List<String> command = buildCollectCommand(task, outputDir);
        CommandResult commandResult = runCommand(command, resolveWorkDir(), timeout());
        if (commandResult.getExitCode() != 0) {
            throw new OpenCliException(i18n("ecosystem.error.opencli.failed"), command, commandResult,
                classifyNeedAction(commandResult));
        }

        List<CollectionItem> items = buildCollectionItems(task, outputDir, commandResult.getOutput());
        if (items.isEmpty()) {
            throw new OpenCliException(i18n("ecosystem.error.opencli.empty.output"), command, commandResult,
                "EMPTY_OUTPUT");
        }

        CollectionResult result = new CollectionResult();
        result.setCommand(command);
        result.setOutputDir(outputDir);
        result.setRawOutput(commandResult.getOutput());
        result.setItems(items);
        result.setAssetCount(countAssets(outputDir));
        return result;
    }

    /**
     * 根据连接器类型构造 OpenCLI 命令。
     */
    private List<String> buildCollectCommand(EcosystemTaskVo task, Path outputDir) {
        List<String> command = new ArrayList<>();
        command.add(resolveBin().toString());
        String profile = resolveOpenCliProfile(task);
        if (!isBlank(profile)) {
            command.add("--profile");
            command.add(profile);
        }

        String connectorCode = defaultText(task.getConnectorCode(), "").toLowerCase(Locale.ROOT);
        if ("web".equals(connectorCode)) {
            appendWebCommand(command, task, outputDir);
            return command;
        }
        if ("zhihu".equals(connectorCode)) {
            appendZhihuCommand(command, task, outputDir);
            return command;
        }
        appendGenericOpenCliCommand(command, task, outputDir);
        return command;
    }

    /**
     * 构造网页采集命令，将公开 URL 读取为 Markdown/JSON 输出。
     */
    private void appendWebCommand(List<String> command, EcosystemTaskVo task, Path outputDir) {
        if (isBlank(task.getSourceUrl())) {
            throw new IllegalArgumentException(i18n("ecosystem.error.web.source.url.required"));
        }
        command.add("web");
        command.add("read");
        command.add("--url");
        command.add(task.getSourceUrl());
        command.add("--output");
        command.add(outputDir.toString());
        command.add("--download-images");
        command.add("-f");
        command.add("json");
    }

    /**
     * 构造知乎采集命令，按问题、收藏夹或单 URL 下载三种形态适配 OpenCLI。
     */
    private void appendZhihuCommand(List<String> command, EcosystemTaskVo task, Path outputDir) {
        String sourceUrl = defaultText(task.getSourceUrl(), "");
        int limit = resolveLimit(task.getScope());
        command.add("zhihu");

        Optional<String> questionId = extractQuestionId(sourceUrl);
        if (questionId.isPresent()) {
            command.add("question");
            command.add(questionId.get());
            command.add("--limit");
            command.add(String.valueOf(limit));
            appendBrowserOptions(command);
            command.add("-f");
            command.add("json");
            return;
        }

        Optional<String> collectionId = extractCollectionId(sourceUrl);
        if (collectionId.isPresent()) {
            command.add("collection");
            command.add(collectionId.get());
            command.add("--limit");
            command.add(String.valueOf(limit));
            appendBrowserOptions(command);
            command.add("-f");
            command.add("json");
            return;
        }

        if (isBlank(sourceUrl)) {
            throw new IllegalArgumentException(i18n("ecosystem.error.zhihu.source.url.required"));
        }
        command.add("download");
        command.add("--url");
        command.add(sourceUrl);
        command.add("--output");
        command.add(outputDir.toString());
        command.add("--download-images");
        appendBrowserOptions(command);
        command.add("-f");
        command.add("json");
    }

    /**
     * 追加需要浏览器登录态的通用 OpenCLI 参数。
     */
    private void appendBrowserOptions(List<String> command) {
        command.add("--site-session");
        command.add("persistent");
        command.add("--window");
        command.add("background");
    }

    /**
     * 对 OpenCLI manifest 中的通用读命令做保守参数映射；复杂命令后续由前端表单显式传 openCliArgs。
     */
    private void appendGenericOpenCliCommand(List<String> command, EcosystemTaskVo task, Path outputDir) {
        Map<String, Object> options = task == null || task.getOptions() == null ? Map.of() : task.getOptions();
        String connectorCode = defaultText(task.getConnectorCode(), "").toLowerCase(Locale.ROOT);
        String requestedCommand = stringValue(options.get("openCliCommand"));
        OpenCliCapabilityService.CommandCapability openCliCommand = openCliCapabilityService.selectReadCommand(
            connectorCode,
            requestedCommand,
            task.getSourceUrl(),
            task.getScope(),
            stringValue(options.get("originalText"))).orElseThrow(() -> new OpenCliException(
            i18n("ecosystem.error.opencli.unsupported.connector"), command, new CommandResult(-1, ""),
            "UNSUPPORTED_CONNECTOR"));
        if (openCliCommand.requiresBrowserBridge() && !"web".equalsIgnoreCase(connectorCode)) {
            throw new OpenCliException(i18n("ecosystem.error.opencli.browser.bridge.required"), command,
                new CommandResult(-1, openCliCommand.description()), "BROWSER_BRIDGE_REQUIRED");
        }
        command.add(openCliCommand.site());
        command.add(openCliCommand.name());
        appendGenericOpenCliArgs(command, task, outputDir, openCliCommand, defaultMapMap(options.get("openCliArgs")));
        command.add("-f");
        command.add("json");
    }

    private void appendGenericOpenCliArgs(List<String> command,
                                          EcosystemTaskVo task,
                                          Path outputDir,
                                          OpenCliCapabilityService.CommandCapability openCliCommand,
                                          Map<String, Object> openCliArgs) {
        for (OpenCliCapabilityService.CommandArg arg : openCliCommand.args()) {
            String argName = arg.name();
            Object supplied = openCliArgs.get(argName);
            String value = supplied == null ? inferOpenCliArgValue(task, outputDir, arg) : stringValue(supplied);
            if (isBlank(value) && arg.required() && arg.defaultValue() == null) {
                throw new OpenCliException(i18n("ecosystem.error.opencli.args.required", argName),
                    List.of(openCliCommand.site(), openCliCommand.name()), new CommandResult(-1, ""), "SOURCE_REQUIRED");
            }
            if (isBlank(value)) {
                continue;
            }
            appendOpenCliArg(command, arg, value);
        }
    }

    private String inferOpenCliArgValue(EcosystemTaskVo task, Path outputDir, OpenCliCapabilityService.CommandArg arg) {
        String name = defaultText(arg.name(), "").toLowerCase(Locale.ROOT);
        if ("output".equals(name) || "out".equals(name) || "dir".equals(name)) {
            return outputDir.toString();
        }
        if ("limit".equals(name) || "max".equals(name) || "count".equals(name)) {
            return String.valueOf(resolveLimit(task.getScope()));
        }
        if ("download-images".equals(name)) {
            return "true";
        }
        String sourceUrl = defaultText(task.getSourceUrl(), "");
        if (!isBlank(sourceUrl) && ("url".equals(name) || "input".equals(name) || "target".equals(name)
            || "link".equals(name))) {
            return sourceUrl;
        }
        if (!isBlank(sourceUrl) && "id".equals(name)) {
            return extractByPattern(sourceUrl, NUMBER_PATTERN).orElse(sourceUrl);
        }
        String query = searchQueryFromScope(task.getScope());
        if (!isBlank(query) && ("query".equals(name) || "keyword".equals(name) || "q".equals(name)
            || "search".equals(name))) {
            return query;
        }
        if (arg.positional() && !isBlank(sourceUrl)) {
            return sourceUrl;
        }
        if (arg.positional() && !isBlank(query)) {
            return query;
        }
        return "";
    }

    private void appendOpenCliArg(List<String> command, OpenCliCapabilityService.CommandArg arg, String value) {
        if (arg.positional()) {
            command.add(value);
            return;
        }
        command.add("--" + arg.name());
        if (!"boolean".equalsIgnoreCase(arg.type()) && !"bool".equalsIgnoreCase(arg.type())) {
            command.add(value);
        }
        else if (!"true".equalsIgnoreCase(value)) {
            command.add(value);
        }
    }

    /**
     * 通过 IMAP 采集个人邮箱，输出统一 Markdown 条目和附件资产。
     */
    private CollectionResult collectMail(EcosystemTaskVo task, Path outputDir) {
        Map<String, Object> credentialConfig = credentialConfig(task);
        String account = firstNonBlank(stringValue(credentialConfig.get("account")),
            stringValue(credentialConfig.get("email")));
        String password = stringValue(credentialConfig.get("token"));
        String imapHost = stringValue(credentialConfig.get("imapHost"));
        int imapPort = intValue(credentialConfig.get("imapPort"), boolValue(credentialConfig.get("imapSsl"), true)
            ? 993 : 143);
        boolean imapSsl = boolValue(credentialConfig.get("imapSsl"), true);
        String folderName = firstNonBlank(mailFolderFromTask(task), stringValue(credentialConfig.get("imapFolder")),
            "INBOX");
        int limit = resolveLimit(task.getScope());
        DateRange dateRange = resolveDateRange(task.getScope());
        if (isBlank(account) || isBlank(password) || isBlank(imapHost)) {
            throw new OpenCliException(i18n("ecosystem.error.mail.imap.config.required"),
                List.of("imap", "collect", folderName), new CommandResult(-1, ""), "LOGIN_REQUIRED");
        }

        List<String> command = List.of("imap", "collect", "--host", imapHost, "--folder", folderName, "--limit",
            String.valueOf(limit));
        List<CollectionItem> items = new ArrayList<>();
        int assetCount;
        Store store = null;
        Folder folder = null;
        try {
            Properties properties = new Properties();
            properties.put("mail.store.protocol", "imap");
            properties.put("mail.imap.host", imapHost);
            properties.put("mail.imap.port", String.valueOf(imapPort));
            properties.put("mail.imap.ssl.enable", String.valueOf(imapSsl));
            properties.put("mail.imap.starttls.enable", String.valueOf(!imapSsl));
            properties.put("mail.imap.connectiontimeout", String.valueOf(timeout().toMillis()));
            properties.put("mail.imap.timeout", String.valueOf(timeout().toMillis()));
            Session session = Session.getInstance(properties);
            store = session.getStore("imap");
            store.connect(imapHost, imapPort, account, password);
            folder = store.getFolder(folderName);
            folder.open(Folder.READ_ONLY);

            int messageCount = folder.getMessageCount();
            int scanLimit = Math.max(limit, Math.min(DEFAULT_IMAP_SCAN_LIMIT, limit * 5));
            int start = Math.max(1, messageCount - scanLimit + 1);
            Message[] messages = folder.getMessages(start, messageCount);
            for (int index = messages.length - 1; index >= 0 && items.size() < limit; index--) {
                Message message = messages[index];
                if (!dateRange.includes(mailDate(message))) {
                    continue;
                }
                items.add(toMailCollectionItem(task, message, folderName, outputDir, items.size() + 1));
            }
            assetCount = countAssets(outputDir);
        }
        catch (MessagingException e) {
            throw new OpenCliException(i18n("ecosystem.error.mail.imap.failed"), command,
                new CommandResult(-1, e.getMessage()), "LOGIN_REQUIRED");
        }
        catch (IOException e) {
            throw new OpenCliException(i18n("ecosystem.error.mail.imap.failed"), command,
                new CommandResult(-1, e.getMessage()), "OPENCLI_FAILED");
        }
        finally {
            closeQuietly(folder);
            closeQuietly(store);
        }

        if (items.isEmpty()) {
            throw new OpenCliException(i18n("ecosystem.error.opencli.empty.output"), command,
                new CommandResult(0, "{}"), "EMPTY_OUTPUT");
        }
        CollectionResult result = new CollectionResult();
        result.setCommand(command);
        result.setOutputDir(outputDir);
        result.setRawOutput(mailRawOutput(account, imapHost, folderName, items.size(), assetCount));
        result.setItems(items);
        result.setAssetCount(assetCount);
        return result;
    }

    /**
     * 将单封邮件转换为 Markdown 条目。
     */
    private CollectionItem toMailCollectionItem(EcosystemTaskVo task, Message message, String folderName,
                                                Path outputDir, int index) throws MessagingException, IOException {
        String subject = defaultText(message.getSubject(), i18n("ecosystem.mail.subject.empty"));
        MailBody body = extractMailBody(message, outputDir, index);
        StringBuilder markdown = new StringBuilder();
        markdown.append("# ").append(subject).append("\n\n");
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.source"), task.getSourceName());
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.mail.folder"), folderName);
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.mail.from"), addresses(message.getFrom()));
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.mail.to"),
            addresses(message.getRecipients(Message.RecipientType.TO)));
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.mail.sent.at"), formatDate(mailDate(message)));
        appendMarkdownMeta(markdown, "Message-ID", messageHeader(message, "Message-ID"));
        markdown.append("\n");
        markdown.append(defaultText(body.text(), i18n("ecosystem.mail.body.empty"))).append("\n");
        if (!body.attachments().isEmpty()) {
            markdown.append("\n## ").append(i18n("ecosystem.mail.attachments")).append("\n\n");
            for (String attachment : body.attachments()) {
                markdown.append("- ").append(attachment).append("\n");
            }
        }
        return new CollectionItem(subject, sanitizeFileName(subject) + ".md", mailSourceUrl(folderName, message),
            markdown.toString());
    }

    /**
     * 提取邮件正文和附件。HTML 正文先降级为纯文本，附件写入临时目录交由统一产物链路上传。
     */
    private MailBody extractMailBody(Part part, Path outputDir, int messageIndex) throws MessagingException,
        IOException {
        if (part.isMimeType("text/plain")) {
            return new MailBody(String.valueOf(part.getContent()), List.of());
        }
        if (part.isMimeType("text/html")) {
            return new MailBody(Jsoup.parse(String.valueOf(part.getContent())).text(), List.of());
        }
        if (part.isMimeType("multipart/*")) {
            Multipart multipart = (Multipart) part.getContent();
            String html = "";
            String plain = "";
            List<String> attachments = new ArrayList<>();
            for (int index = 0; index < multipart.getCount(); index++) {
                BodyPart bodyPart = multipart.getBodyPart(index);
                if (isAttachment(bodyPart)) {
                    String fileName = saveMailAttachment(bodyPart, outputDir, messageIndex, attachments.size() + 1);
                    if (!isBlank(fileName)) {
                        attachments.add(fileName);
                    }
                    continue;
                }
                MailBody child = extractMailBody(bodyPart, outputDir, messageIndex);
                if (isBlank(plain) && bodyPart.isMimeType("text/plain")) {
                    plain = child.text();
                }
                if (isBlank(html) && bodyPart.isMimeType("text/html")) {
                    html = child.text();
                }
                if (isBlank(plain) && !isBlank(child.text())) {
                    plain = child.text();
                }
                attachments.addAll(child.attachments());
            }
            return new MailBody(firstNonBlank(plain, html), attachments);
        }
        return new MailBody("", List.of());
    }

    /**
     * 判断 BodyPart 是否是附件或内联文件。
     */
    private boolean isAttachment(Part part) throws MessagingException {
        String disposition = part.getDisposition();
        return Part.ATTACHMENT.equalsIgnoreCase(disposition) || Part.INLINE.equalsIgnoreCase(disposition)
            || !isBlank(part.getFileName());
    }

    /**
     * 保存邮件附件，超过大小上限时跳过文件内容但返回附件名用于 Markdown 记录。
     */
    private String saveMailAttachment(BodyPart bodyPart, Path outputDir, int messageIndex, int attachmentIndex)
        throws MessagingException, IOException {
        String rawFileName = bodyPart.getFileName();
        String fileName = sanitizeFileName(defaultText(rawFileName == null ? "" : MimeUtility.decodeText(rawFileName),
            "attachment-" + attachmentIndex));
        byte[] bytes;
        try (InputStream inputStream = bodyPart.getInputStream()) {
            bytes = inputStream.readNBytes(MAX_MAIL_ATTACHMENT_BYTES + 1);
        }
        if (bytes.length > MAX_MAIL_ATTACHMENT_BYTES) {
            return fileName + " (" + i18n("ecosystem.mail.attachment.too.large") + ")";
        }
        Files.write(outputDir.resolve(String.format("mail-%03d-%02d-%s", messageIndex, attachmentIndex, fileName)),
            bytes);
        return fileName;
    }

    /**
     * 优先读取 OpenCLI 输出目录中的 Markdown 文件；若没有文件，则回退解析命令行 JSON 输出。
     */
    private List<CollectionItem> buildCollectionItems(EcosystemTaskVo task, Path outputDir, String rawOutput) {
        List<Path> markdownFiles = listFiles(outputDir, ".md");
        if (!markdownFiles.isEmpty()) {
            List<CollectionItem> items = new ArrayList<>();
            int index = 1;
            for (Path markdownFile : markdownFiles) {
                String markdown = readString(markdownFile);
                items.add(new CollectionItem(titleFromMarkdown(markdown, task, index),
                    markdownFile.getFileName().toString(), task.getSourceUrl(), markdown));
                index++;
            }
            return items;
        }
        return buildItemsFromJson(task, rawOutput);
    }

    /**
     * 将 OpenCLI JSON 输出转换为采集条目列表。
     */
    private List<CollectionItem> buildItemsFromJson(EcosystemTaskVo task, String rawOutput) {
        List<CollectionItem> items = new ArrayList<>();
        JsonNode node = parseJsonNode(rawOutput);
        if (node == null) {
            return items;
        }
        if (node.isObject() && node.has("rows")) {
            node = node.get("rows");
        }
        if (node.isObject() && node.has("data")) {
            node = node.get("data");
        }
        if (node.isArray()) {
            int index = 1;
            for (JsonNode item : node) {
                items.add(toCollectionItem(task, item, index++));
            }
            return items;
        }
        if (node.isObject()) {
            items.add(toCollectionItem(task, node, 1));
        }
        return items;
    }

    /**
     * 将单个 JSON 节点转换为标准 Markdown 条目。
     */
    private CollectionItem toCollectionItem(EcosystemTaskVo task, JsonNode item, int index) {
        String title = firstNonBlank(text(item, "title"), text(item, "name"),
            i18n("ecosystem.collection.item.title", task.getSourceName(), index));
        String url = firstNonBlank(text(item, "url"), text(item, "link"), task.getSourceUrl());
        String content = firstNonBlank(text(item, "markdown"), text(item, "content"), text(item, "excerpt"),
            text(item, "summary"), text(item, "text"));

        StringBuilder markdown = new StringBuilder();
        markdown.append("# ").append(title).append("\n\n");
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.source"), task.getSourceName());
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.link"), url);
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.author"),
            firstNonBlank(text(item, "author"), text(item, "author_name")));
        appendMarkdownMeta(markdown, i18n("ecosystem.markdown.meta.publish.time"),
            firstNonBlank(text(item, "publish_time"), text(item, "created_at")));
        markdown.append("\n");
        if (!isBlank(content)) {
            markdown.append(content).append("\n");
        }
        else {
            markdown.append("```json\n").append(item.toPrettyString()).append("\n```\n");
        }

        return new CollectionItem(title, sanitizeFileName(title) + ".md", url, markdown.toString());
    }

    /**
     * 在 Markdown 头部追加来源、链接、作者、发布时间等元信息。
     */
    private void appendMarkdownMeta(StringBuilder markdown, String label, String value) {
        if (!isBlank(value)) {
            markdown.append("- ").append(label).append("：").append(value).append("\n");
        }
    }

    /**
     * 从任务临时 options 读取连接凭据。该配置只在运行时注入，不持久化到任务 options。
     */
    private Map<String, Object> credentialConfig(EcosystemTaskVo task) {
        Map<String, Object> options = task == null || task.getOptions() == null ? Map.of() : task.getOptions();
        if (options.get("credentialConfig") instanceof Map<?, ?> map) {
            return objectMap(map);
        }
        return Map.of();
    }

    /**
     * 邮箱 sourceUrl 字段在 IMAP 场景下复用为文件夹名，空值默认 INBOX。
     */
    private String mailFolderFromTask(EcosystemTaskVo task) {
        String sourceUrl = task == null ? "" : defaultText(task.getSourceUrl(), "");
        return "-".equals(sourceUrl) || sourceUrl.startsWith("http") || sourceUrl.startsWith("mail://")
            ? ""
            : sourceUrl;
    }

    /**
     * 解析邮箱采集日期范围，默认最近 7 天。
     */
    private DateRange resolveDateRange(String scope) {
        List<LocalDate> dates = new ArrayList<>();
        if (!isBlank(scope)) {
            Matcher dateMatcher = DATE_PATTERN.matcher(scope);
            while (dateMatcher.find()) {
                dates.add(LocalDate.parse(dateMatcher.group(1), DateTimeFormatter.ISO_LOCAL_DATE));
            }
        }
        ZoneId zoneId = ZoneId.systemDefault();
        if (dates.size() >= 2) {
            return new DateRange(
                Date.from(dates.get(0).atStartOfDay(zoneId).toInstant()),
                Date.from(dates.get(1).plusDays(1).atStartOfDay(zoneId).toInstant()));
        }
        int days = resolveDays(scope);
        LocalDate start = LocalDate.now(zoneId).minusDays(Math.max(1, days) - 1L);
        return new DateRange(Date.from(start.atStartOfDay(zoneId).toInstant()), null);
    }

    /**
     * 从范围文本中提取最近天数。
     */
    private int resolveDays(String scope) {
        if (isBlank(scope)) {
            return 7;
        }
        Matcher matcher = Pattern.compile("(\\d{1,3})").matcher(scope);
        if (matcher.find()) {
            return Math.max(1, Math.min(365, Integer.parseInt(matcher.group(1))));
        }
        return 7;
    }

    /**
     * 邮件发送时间优先取 sentDate，缺失时取 receivedDate。
     */
    private Date mailDate(Message message) throws MessagingException {
        Date sentDate = message.getSentDate();
        return sentDate == null ? message.getReceivedDate() : sentDate;
    }

    /**
     * 邮件来源定位，用于产物和去重排查。
     */
    private String mailSourceUrl(String folderName, Message message) throws MessagingException {
        String messageId = messageHeader(message, "Message-ID");
        return "mail://" + defaultText(folderName, "INBOX") + "/" + defaultText(messageId,
            String.valueOf(message.getMessageNumber()));
    }

    /**
     * 读取邮件头首值。
     */
    private String messageHeader(Message message, String name) throws MessagingException {
        String[] headers = message.getHeader(name);
        return headers == null || headers.length == 0 ? "" : headers[0];
    }

    /**
     * 格式化地址数组。
     */
    private String addresses(Address[] addresses) {
        if (addresses == null || addresses.length == 0) {
            return "";
        }
        List<String> values = new ArrayList<>();
        for (Address address : addresses) {
            values.add(address.toString());
        }
        return String.join(", ", values);
    }

    /**
     * 日期格式化为 ISO 字符串，便于 Markdown 和后续解析。
     */
    private String formatDate(Date date) {
        return date == null ? "" : date.toInstant().toString();
    }

    /**
     * 邮箱采集 raw 摘要不包含密码等敏感信息。
     */
    private String mailRawOutput(String account, String imapHost, String folderName, int itemCount, int assetCount) {
        try {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("source", "imap");
            payload.put("account", account);
            payload.put("imapHost", imapHost);
            payload.put("folder", folderName);
            payload.put("itemCount", itemCount);
            payload.put("assetCount", assetCount);
            return objectMapper.writeValueAsString(payload);
        }
        catch (IOException e) {
            return "{}";
        }
    }

    /**
     * 安静关闭邮件文件夹。
     */
    private void closeQuietly(Folder folder) {
        if (folder == null || !folder.isOpen()) {
            return;
        }
        try {
            folder.close(false);
        }
        catch (MessagingException ignored) {
        }
    }

    /**
     * 安静关闭邮件 Store。
     */
    private void closeQuietly(Store store) {
        if (store == null || !store.isConnected()) {
            return;
        }
        try {
            store.close();
        }
        catch (MessagingException ignored) {
        }
    }

    /**
     * 执行外部命令并按超时限制收集标准输出和标准错误。
     */
    private CommandResult runCommand(List<String> command, Path workDir, Duration timeout) {
        try {
            ProcessBuilder processBuilder = new ProcessBuilder(command);
            processBuilder.directory(workDir.toFile());
            processBuilder.redirectErrorStream(true);
            Process process = processBuilder.start();
            CompletableFuture<String> outputFuture = CompletableFuture.supplyAsync(() -> readOutput(process));
            boolean finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
            if (!finished) {
                process.destroyForcibly();
                return new CommandResult(-1, outputFuture.get(5, TimeUnit.SECONDS) + "\n"
                    + i18n("ecosystem.error.opencli.timeout"));
            }
            return new CommandResult(process.exitValue(), outputFuture.get(5, TimeUnit.SECONDS));
        }
        catch (Exception e) {
            return new CommandResult(-1, e.getMessage());
        }
    }

    /**
     * 读取外部进程合并后的输出流。
     */
    private String readOutput(Process process) {
        try (InputStream inputStream = process.getInputStream()) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        }
        catch (IOException e) {
            return e.getMessage();
        }
    }

    /**
     * 从混合日志文本中提取 JSON 并解析。
     */
    private JsonNode parseJsonNode(String rawOutput) {
        String json = extractJson(rawOutput);
        if (isBlank(json)) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        }
        catch (IOException e) {
            return null;
        }
    }

    /**
     * 从 OpenCLI 输出中截取第一个 JSON 数组或对象。
     */
    private String extractJson(String rawOutput) {
        if (isBlank(rawOutput)) {
            return "";
        }
        int arrayStart = rawOutput.indexOf('[');
        int objectStart = rawOutput.indexOf('{');
        int start;
        if (arrayStart < 0) {
            start = objectStart;
        }
        else if (objectStart < 0) {
            start = arrayStart;
        }
        else {
            start = Math.min(arrayStart, objectStart);
        }
        if (start < 0) {
            return "";
        }
        char endChar = rawOutput.charAt(start) == '[' ? ']' : '}';
        int end = rawOutput.lastIndexOf(endChar);
        if (end < start) {
            return "";
        }
        return rawOutput.substring(start, end + 1);
    }

    /**
     * 枚举输出目录下指定后缀的文件，并按路径排序保证结果稳定。
     */
    private List<Path> listFiles(Path outputDir, String suffix) {
        if (outputDir == null || !Files.exists(outputDir)) {
            return List.of();
        }
        try (Stream<Path> stream = Files.walk(outputDir)) {
            return stream.filter(Files::isRegularFile)
                .filter(path -> path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(suffix))
                .sorted(Comparator.comparing(Path::toString))
                .toList();
        }
        catch (IOException e) {
            return List.of();
        }
    }

    /**
     * 统计输出目录中非 Markdown 附件资产数量。
     */
    private int countAssets(Path outputDir) {
        if (outputDir == null || !Files.exists(outputDir)) {
            return 0;
        }
        try (Stream<Path> stream = Files.walk(outputDir)) {
            return (int) stream.filter(Files::isRegularFile)
                .filter(path -> !path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".md"))
                .count();
        }
        catch (IOException e) {
            return 0;
        }
    }

    /**
     * 为一次采集运行创建临时输出目录。
     */
    private Path createOutputDirectory(Long runId) {
        try {
            return Files.createTempDirectory("bykc-ec-" + runId + "-");
        }
        catch (IOException e) {
            throw new IllegalStateException(i18n("ecosystem.error.temp.dir.create.failed"), e);
        }
    }

    /**
     * 解析 OpenCLI 可执行文件路径，支持环境变量覆盖和仓库相对路径。
     */
    private Path resolveBin() {
        Path repoRoot = resolveRepoRoot();
        String configured = configured("BYKC_OPENCLI_BIN", "byclaw-be/runtime/opencli/node_modules/.bin/opencli");
        Path path = Paths.get(configured);
        return path.isAbsolute() ? path.normalize() : repoRoot.resolve(path).normalize();
    }

    /**
     * 解析 OpenCLI 工作目录，默认指向 byclaw-be/runtime/opencli。
     */
    private Path resolveWorkDir() {
        Path repoRoot = resolveRepoRoot();
        String configured = configured("BYKC_OPENCLI_WORKDIR", "byclaw-be/runtime/opencli");
        Path path = Paths.get(configured);
        return path.isAbsolute() ? path.normalize() : repoRoot.resolve(path).normalize();
    }

    /**
     * 从当前目录向上查找仓库根目录，便于本地和部署环境共用相对配置。
     */
    private Path resolveRepoRoot() {
        Path current = Paths.get("").toAbsolutePath().normalize();
        while (current != null) {
            if (Files.exists(current.resolve("byclaw-be/runtime/opencli"))) {
                return current;
            }
            current = current.getParent();
        }
        return Paths.get("").toAbsolutePath().normalize();
    }

    /**
     * 解析 OpenCLI 命令超时时间。
     */
    private Duration timeout() {
        String seconds = configured("BYKC_OPENCLI_TIMEOUT_SECONDS", "120");
        try {
            return Duration.ofSeconds(Long.parseLong(seconds));
        }
        catch (NumberFormatException e) {
            return Duration.ofSeconds(120);
        }
    }

    /**
     * 从知乎链接或纯数字中提取收藏夹 ID。
     */
    private Optional<String> extractCollectionId(String sourceUrl) {
        Optional<String> collectionId = extractByPattern(sourceUrl, COLLECTION_PATTERN);
        if (collectionId.isPresent()) {
            return collectionId;
        }
        return defaultText(sourceUrl, "").matches("\\d{3,}") ? extractByPattern(sourceUrl, NUMBER_PATTERN)
            : Optional.empty();
    }

    /**
     * 从知乎问题链接中提取问题 ID。
     */
    private Optional<String> extractQuestionId(String sourceUrl) {
        return extractByPattern(sourceUrl, QUESTION_PATTERN);
    }

    /**
     * 按正则提取第一个匹配分组。
     */
    private Optional<String> extractByPattern(String value, Pattern pattern) {
        if (isBlank(value)) {
            return Optional.empty();
        }
        Matcher matcher = pattern.matcher(value);
        if (!matcher.find()) {
            return Optional.empty();
        }
        return Optional.of(matcher.groupCount() >= 1 ? matcher.group(1) : matcher.group());
    }

    /**
     * 从范围文本中解析采集数量，限制在 1 到 100 之间。
     */
    private int resolveLimit(String scope) {
        if (isBlank(scope)) {
            return DEFAULT_LIMIT;
        }
        Matcher matcher = Pattern.compile("(\\d{1,3})").matcher(scope);
        if (matcher.find()) {
            return Math.max(1, Math.min(100, Integer.parseInt(matcher.group(1))));
        }
        return DEFAULT_LIMIT;
    }

    /**
     * 安全读取 JSON 字段文本。
     */
    private String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? "" : value.asText("");
    }

    /**
     * 读取 UTF-8 Markdown 文件内容。
     */
    private String readString(Path path) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        }
        catch (IOException e) {
            return "";
        }
    }

    /**
     * 从 Markdown 一级标题提取条目标题，提取不到时使用默认标题。
     */
    private String titleFromMarkdown(String markdown, EcosystemTaskVo task, int index) {
        if (!isBlank(markdown)) {
            for (String line : markdown.split("\\R")) {
                if (line.startsWith("# ")) {
                    return defaultText(line.substring(2), i18n("ecosystem.collection.item.title",
                        task.getSourceName(), index));
                }
            }
        }
        return i18n("ecosystem.collection.item.title", task.getSourceName(), index);
    }

    /**
     * 规范化文件名，避免非法字符和过长名称影响对象存储。
     */
    private String sanitizeFileName(String value) {
        String fileName = defaultText(value, i18n("ecosystem.collection.item.file.name"))
            .replaceAll("[\\\\/:*?\"<>|]+", "_").trim();
        if (fileName.length() > 80) {
            fileName = fileName.substring(0, 80);
        }
        return fileName;
    }

    /**
     * 将 OpenCLI 失败输出分类成前端可处理的用户动作类型。
     */
    private String classifyNeedAction(CommandResult commandResult) {
        String output = defaultText(commandResult.getOutput(), "").toLowerCase(Locale.ROOT);
        if (output.contains("browser bridge") || output.contains("daemon") || output.contains("connect")) {
            return "BROWSER_BRIDGE_REQUIRED";
        }
        if (output.contains("login") || output.contains("扫码") || output.contains("session")) {
            return "LOGIN_REQUIRED";
        }
        return "OPENCLI_FAILED";
    }

    /**
     * 读取配置值，优先级为 Spring 环境、JVM 系统属性、系统环境变量、默认值。
     */
    private String configured(String key, String defaultValue) {
        String value = environment.getProperty(key);
        if (isBlank(value)) {
            value = System.getProperty(key);
        }
        if (isBlank(value)) {
            value = System.getenv(key);
        }
        return defaultText(value, defaultValue);
    }

    /**
     * 优先使用任务固化的连接运行时配置；没有任务级配置时再读取应用环境变量兜底。
     */
    private String resolveOpenCliProfile(EcosystemTaskVo task) {
        Map<String, Object> options = task == null || task.getOptions() == null ? Map.of() : task.getOptions();
        Map<String, Object> runtimeConfig = options.get("runtimeConfig") instanceof Map<?, ?> map
            ? objectMap(map)
            : Map.of();
        return firstNonBlank(
            stringValue(options.get("openCliProfile")),
            stringValue(runtimeConfig.get("openCliProfile")),
            stringValue(options.get("chromeProfile")),
            stringValue(runtimeConfig.get("chromeProfile")),
            configured("BYKC_OPENCLI_PROFILE", "")
        );
    }

    /**
     * 将任意 key 类型的 Map 转为 String key，便于读取 JSONB 反序列化后的运行时配置。
     */
    private Map<String, Object> objectMap(Map<?, ?> value) {
        Map<String, Object> result = new java.util.LinkedHashMap<>();
        if (value == null) {
            return result;
        }
        for (Map.Entry<?, ?> entry : value.entrySet()) {
            if (entry.getKey() != null) {
                result.put(String.valueOf(entry.getKey()), entry.getValue());
            }
        }
        return result;
    }

    private Map<String, Object> defaultMapMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            return objectMap(map);
        }
        return Map.of();
    }

    /**
     * 对象转字符串，保留 null 语义。
     */
    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    /**
     * 对象转 int，解析失败时返回默认值。
     */
    private int intValue(Object value, int defaultValue) {
        if (value == null || isBlank(String.valueOf(value))) {
            return defaultValue;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        }
        catch (NumberFormatException e) {
            return defaultValue;
        }
    }

    /**
     * 对象转 boolean，空值使用默认值。
     */
    private boolean boolValue(Object value, boolean defaultValue) {
        if (value == null || isBlank(String.valueOf(value))) {
            return defaultValue;
        }
        if (value instanceof Boolean bool) {
            return bool;
        }
        return "true".equalsIgnoreCase(String.valueOf(value)) || "Y".equalsIgnoreCase(String.valueOf(value))
            || "1".equals(String.valueOf(value));
    }

    /**
     * 返回第一个非空文本。
     */
    private String firstNonBlank(String... values) {
        for (String value : values) {
            if (!isBlank(value)) {
                return value.trim();
            }
        }
        return "";
    }

    private String searchQueryFromScope(String scope) {
        return defaultText(scope, "")
            .replaceAll("(?:最近|近)\\s*\\d{1,3}\\s*天", " ")
            .replaceAll("最近一周|近一周|最近两周|近两周|最近一个月|近一个月", " ")
            .replaceAll("采集|同步|关于|的|内容|资料|帖子|文章", " ")
            .replaceAll("\\s+", " ")
            .trim();
    }

    /**
     * 空文本兜底。
     */
    private String defaultText(String value, String defaultValue) {
        return isBlank(value) ? defaultValue : value.trim();
    }

    /**
     * 获取国际化文案。
     */
    private String i18n(String key, Object... args) {
        return I18nUtil.get(key, args);
    }

    /**
     * 判断文本是否为空。
     */
    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }

    /**
     * 邮箱正文和附件名列表。
     */
    private record MailBody(String text, List<String> attachments) {
    }

    /**
     * 邮箱采集日期范围，endExclusive 为空时只校验起始时间。
     */
    private record DateRange(Date startInclusive, Date endExclusive) {

        private boolean includes(Date value) {
            if (value == null) {
                return true;
            }
            boolean afterStart = startInclusive == null || !value.before(startInclusive);
            boolean beforeEnd = endExclusive == null || value.before(endExclusive);
            return afterStart && beforeEnd;
        }
    }

    /**
     * OpenCLI 命令执行异常，附带命令、原始输出和需要用户处理的动作类型。
     */
    public static class OpenCliException extends RuntimeException {

        /**
         * 实际执行的 OpenCLI 命令。
         */
        private final List<String> command;

        /**
         * 命令退出码和输出。
         */
        private final CommandResult commandResult;

        /**
         * 前端或技能侧需要处理的动作类型。
         */
        private final String needActionType;

        public OpenCliException(String message, List<String> command, CommandResult commandResult,
            String needActionType) {
            super(message);
            this.command = command;
            this.commandResult = commandResult;
            this.needActionType = needActionType;
        }

        public List<String> getCommand() {
            return command;
        }

        public CommandResult getCommandResult() {
            return commandResult;
        }

        public String getNeedActionType() {
            return needActionType;
        }
    }

    /**
     * 外部命令执行结果。
     */
    public static class CommandResult {

        /**
         * 进程退出码，0 表示成功。
         */
        private final int exitCode;

        /**
         * 进程合并输出。
         */
        private final String output;

        public CommandResult(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output == null ? "" : output;
        }

        public int getExitCode() {
            return exitCode;
        }

        public String getOutput() {
            return output;
        }
    }

    /**
     * 一次 OpenCLI 采集的归一化结果。
     */
    public static class CollectionResult {

        /**
         * 实际执行的 OpenCLI 命令。
         */
        private List<String> command;

        /**
         * OpenCLI 临时输出目录。
         */
        private Path outputDir;

        /**
         * OpenCLI 原始输出文本。
         */
        private String rawOutput;

        /**
         * 归一化后的 Markdown 条目。
         */
        private List<CollectionItem> items = new ArrayList<>();

        /**
         * 附件资产数量。
         */
        private int assetCount;

        public List<String> getCommand() {
            return command;
        }

        public void setCommand(List<String> command) {
            this.command = command;
        }

        public Path getOutputDir() {
            return outputDir;
        }

        public void setOutputDir(Path outputDir) {
            this.outputDir = outputDir;
        }

        public String getRawOutput() {
            return rawOutput;
        }

        public void setRawOutput(String rawOutput) {
            this.rawOutput = rawOutput;
        }

        public List<CollectionItem> getItems() {
            return items;
        }

        public void setItems(List<CollectionItem> items) {
            this.items = items;
        }

        public int getAssetCount() {
            return assetCount;
        }

        public void setAssetCount(int assetCount) {
            this.assetCount = assetCount;
        }
    }

    /**
     * 单条采集内容，后续会落为 Markdown 文件并导入知识库。
     */
    public static class CollectionItem {

        /**
         * 条目标题。
         */
        private final String title;

        /**
         * 建议的 Markdown 文件名。
         */
        private final String fileName;

        /**
         * 原始来源链接。
         */
        private final String sourceUrl;

        /**
         * Markdown 正文。
         */
        private final String markdown;

        public CollectionItem(String title, String fileName, String sourceUrl, String markdown) {
            this.title = title;
            this.fileName = fileName;
            this.sourceUrl = sourceUrl;
            this.markdown = markdown;
        }

        public String getTitle() {
            return title;
        }

        public String getFileName() {
            return fileName;
        }

        public String getSourceUrl() {
            return sourceUrl;
        }

        public String getMarkdown() {
            return markdown;
        }
    }
}
