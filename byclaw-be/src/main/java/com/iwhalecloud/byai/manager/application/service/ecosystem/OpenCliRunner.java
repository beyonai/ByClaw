package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemTaskVo;
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
     * 未指定范围时的默认采集数量上限。
     */
    private static final int DEFAULT_LIMIT = 20;

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
     * 执行一次 OpenCLI 采集，并把命令输出归一化为 Markdown 条目和附件统计。
     *
     * @param task 采集任务
     * @param runId 本次运行 ID，用于生成临时输出目录
     * @return 归一化后的采集结果
     */
    public CollectionResult collect(EcosystemTaskVo task, Long runId) {
        Path outputDir = createOutputDirectory(runId);
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
     * 检测 OpenCLI 运行时、版本和 Browser Bridge 连接状态。
     *
     * @return 运行时状态
     */
    public RuntimeStatus inspectRuntime() {
        CommandResult version = runCommand(List.of(resolveBin().toString(), "--version"), resolveWorkDir(),
            Duration.ofSeconds(20));
        CommandResult doctor = version.getExitCode() == 0
            ? runCommand(List.of(resolveBin().toString(), "doctor"), resolveWorkDir(), Duration.ofSeconds(30))
            : new CommandResult(-1, "");

        RuntimeStatus status = new RuntimeStatus();
        status.setRuntimeName("OpenCLI");
        status.setRuntimeVersion(version.getExitCode() == 0 ? firstLine(version.getOutput()) : "-");
        status.setBrowserBridgeStatus(isBridgeConnected(doctor) ? "CONNECTED" : "DISCONNECTED");
        status.setStatus(version.getExitCode() == 0 ? "ONLINE" : "OFFLINE");
        status.setDiagnosticOutput(doctor.getOutput());
        return status;
    }

    /**
     * 根据连接器类型构造 OpenCLI 命令。
     */
    private List<String> buildCollectCommand(EcosystemTaskVo task, Path outputDir) {
        List<String> command = new ArrayList<>();
        command.add(resolveBin().toString());
        String profile = configured("BYCLAW_OPENCLI_PROFILE", "");
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
        throw new OpenCliException(i18n("ecosystem.error.opencli.unsupported.connector"), command,
            new CommandResult(-1, ""), "UNSUPPORTED_CONNECTOR");
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
        String configured = configured("BYCLAW_OPENCLI_BIN", "byclaw-be/runtime/opencli/node_modules/.bin/opencli");
        Path path = Paths.get(configured);
        return path.isAbsolute() ? path.normalize() : repoRoot.resolve(path).normalize();
    }

    /**
     * 解析 OpenCLI 工作目录，默认指向 byclaw-be/runtime/opencli。
     */
    private Path resolveWorkDir() {
        Path repoRoot = resolveRepoRoot();
        String configured = configured("BYCLAW_OPENCLI_WORKDIR", "byclaw-be/runtime/opencli");
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
        String seconds = configured("BYCLAW_OPENCLI_TIMEOUT_SECONDS", "120");
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
     * 获取输出第一行，常用于版本号展示。
     */
    private String firstLine(String value) {
        if (isBlank(value)) {
            return "-";
        }
        return value.lines().findFirst().orElse("-").trim();
    }

    /**
     * 根据 opencli doctor 输出判断 Browser Bridge 是否可用。
     */
    private boolean isBridgeConnected(CommandResult doctor) {
        if (doctor.getExitCode() != 0) {
            return false;
        }
        String output = defaultText(doctor.getOutput(), "").toLowerCase(Locale.ROOT);
        return !(output.contains("[fail]") || output.contains("[missing]") || output.contains("not connected")
            || output.contains("not running") || output.contains("failed"));
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

    /**
     * OpenCLI 本机运行时检测结果。
     */
    public static class RuntimeStatus {

        /**
         * 运行时名称。
         */
        private String runtimeName;

        /**
         * 运行时版本。
         */
        private String runtimeVersion;

        /**
         * Browser Bridge 连接状态。
         */
        private String browserBridgeStatus;

        /**
         * 运行时总体状态。
         */
        private String status;

        /**
         * doctor 诊断输出，便于排查环境问题。
         */
        private String diagnosticOutput;

        public String getRuntimeName() {
            return runtimeName;
        }

        public void setRuntimeName(String runtimeName) {
            this.runtimeName = runtimeName;
        }

        public String getRuntimeVersion() {
            return runtimeVersion;
        }

        public void setRuntimeVersion(String runtimeVersion) {
            this.runtimeVersion = runtimeVersion;
        }

        public String getBrowserBridgeStatus() {
            return browserBridgeStatus;
        }

        public void setBrowserBridgeStatus(String browserBridgeStatus) {
            this.browserBridgeStatus = browserBridgeStatus;
        }

        public String getStatus() {
            return status;
        }

        public void setStatus(String status) {
            this.status = status;
        }

        public String getDiagnosticOutput() {
            return diagnosticOutput;
        }

        public void setDiagnosticOutput(String diagnosticOutput) {
            this.diagnosticOutput = diagnosticOutput;
        }
    }
}
