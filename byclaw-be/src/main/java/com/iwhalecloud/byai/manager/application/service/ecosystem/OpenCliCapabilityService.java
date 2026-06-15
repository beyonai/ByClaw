package com.iwhalecloud.byai.manager.application.service.ecosystem;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.JsonNode;
import com.iwhalecloud.byai.manager.vo.ecosystem.EcosystemConnectorVo;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * OpenCLI manifest 能力目录。ByClaw 只维护自研/覆盖连接器，OpenCLI 支持的站点和命令从运行时动态发现。
 *
 * @author qin.guoquan
 * @date 2026-06-02
 */
@Service
@Slf4j
public class OpenCliCapabilityService extends EcosystemCollectionSupport {

    private static final long CACHE_TTL_MS = 10 * 60 * 1000L;
    private static final int MAX_COMMANDS_IN_CONNECTOR_SCHEMA = 40;

    private final Environment environment;

    private volatile CapabilitySnapshot snapshot;

    public OpenCliCapabilityService(Environment environment) {
        this.environment = environment;
    }

    /**
     * 返回 OpenCLI manifest 中的虚拟连接器列表。数据库连接器由调用方优先覆盖。
     */
    public List<EcosystemConnectorVo> listVirtualConnectors() {
        return new ArrayList<>(snapshot().connectors().values());
    }

    /**
     * 查找 OpenCLI manifest 中的虚拟连接器。
     */
    public Optional<EcosystemConnectorVo> findVirtualConnector(String connectorCode) {
        if (isBlank(connectorCode)) {
            return Optional.empty();
        }
        return Optional.ofNullable(snapshot().connectors().get(normalizeKey(connectorCode)));
    }

    /**
     * 查找站点能力元数据。
     */
    public Optional<SiteCapability> findSite(String siteCode) {
        if (isBlank(siteCode)) {
            return Optional.empty();
        }
        return Optional.ofNullable(snapshot().sites().get(normalizeKey(siteCode)));
    }

    /**
     * 按用户输入、链接和可选命令名选择一个最合适的 OpenCLI 读命令。
     */
    public Optional<CommandCapability> selectReadCommand(String siteCode, String requestedCommand, String sourceUrl,
                                                        String scope, String rawText) {
        Optional<SiteCapability> site = findSite(siteCode);
        if (site.isEmpty()) {
            return Optional.empty();
        }
        List<CommandCapability> readCommands = site.get().commands().stream()
            .filter(command -> "read".equalsIgnoreCase(command.access()))
            .toList();
        if (readCommands.isEmpty()) {
            return Optional.empty();
        }
        if (!isBlank(requestedCommand)) {
            String expected = normalizeKey(requestedCommand);
            Optional<CommandCapability> matched = readCommands.stream()
                .filter(command -> expected.equals(normalizeKey(command.name())))
                .findFirst();
            if (matched.isPresent()) {
                return matched;
            }
        }
        String combinedText = defaultText(scope, "") + " " + defaultText(rawText, "");
        if (!isBlank(sourceUrl)) {
            Optional<CommandCapability> byUrl = readCommands.stream()
                .filter(command -> acceptsUrlLikeInput(command) || hasRequiredInput(command))
                .max(Comparator.comparingInt(command -> commandScore(command, sourceUrl, combinedText)));
            if (byUrl.isPresent() && commandScore(byUrl.get(), sourceUrl, combinedText) > 0) {
                return byUrl;
            }
        }
        if (!isBlank(combinedText)) {
            Optional<CommandCapability> byText = readCommands.stream()
                .filter(this::acceptsTextQuery)
                .max(Comparator.comparingInt(command -> commandScore(command, sourceUrl, combinedText)));
            if (byText.isPresent() && commandScore(byText.get(), sourceUrl, combinedText) > 0) {
                return byText;
            }
        }
        return readCommands.stream()
            .filter(command -> requiredArgs(command).isEmpty())
            .max(Comparator.comparingInt(command -> commandScore(command, sourceUrl, combinedText)))
            .or(() -> readCommands.stream().findFirst());
    }

    /**
     * 根据 URL 域名、站点编码或少量中文别名推断 OpenCLI 站点。
     */
    public Optional<String> inferSiteCode(String sourceUrl, String rawText) {
        CapabilitySnapshot current = snapshot();
        String host = host(sourceUrl);
        if (!isBlank(host)) {
            for (SiteCapability site : current.sites().values()) {
                for (String domain : site.domains()) {
                    if (hostMatches(host, domain)) {
                        return Optional.of(site.site());
                    }
                }
            }
        }
        String text = defaultText(rawText, "").toLowerCase(Locale.ROOT);
        if (isBlank(text)) {
            return Optional.empty();
        }
        String alias = aliasSite(text);
        if (!isBlank(alias) && current.sites().containsKey(alias)) {
            return Optional.of(alias);
        }
        return current.sites().keySet().stream()
            .filter(site -> text.contains(site.toLowerCase(Locale.ROOT)))
            .findFirst();
    }

    /**
     * 站点默认打开地址。Browser Bridge 没有明确 URL 时用它引导用户打开/登录。
     */
    public String defaultSiteUrl(String connectorCode) {
        return findSite(connectorCode)
            .flatMap(site -> site.domains().stream().findFirst())
            .map(domain -> "https://" + domain + "/")
            .orElse("");
    }

    /**
     * 站点允许域名。
     */
    public List<String> domains(String connectorCode) {
        return findSite(connectorCode).map(SiteCapability::domains).orElse(List.of());
    }

    /**
     * 当前站点是否来自 OpenCLI manifest。
     */
    public boolean isOpenCliSite(String connectorCode) {
        return findSite(connectorCode).isPresent();
    }

    @Scheduled(fixedDelayString = "${bykc.opencli.capability-refresh-ms:600000}",
        initialDelayString = "${bykc.opencli.capability-refresh-initial-delay-ms:20000}")
    public void refreshCapabilitySnapshot() {
        snapshot = loadSnapshot(System.currentTimeMillis(), snapshot);
    }

    private CapabilitySnapshot snapshot() {
        CapabilitySnapshot current = snapshot;
        long now = System.currentTimeMillis();
        if (current != null && now - current.loadedAtMs() <= CACHE_TTL_MS) {
            return current;
        }
        synchronized (this) {
            current = snapshot;
            if (current != null && now - current.loadedAtMs() <= CACHE_TTL_MS) {
                return current;
            }
            snapshot = loadSnapshot(now, current);
            return snapshot;
        }
    }

    private CapabilitySnapshot loadSnapshot(long loadedAtMs, CapabilitySnapshot previous) {
        List<CommandCapability> commands = loadCommands();
        if (commands.isEmpty() && previous != null && !previous.sites().isEmpty()) {
            log.warn("OpenCLI capability refresh returned no commands; keeping previous snapshot with {} sites",
                previous.sites().size());
            return previous.refreshFailedAt(loadedAtMs);
        }
        Map<String, List<CommandCapability>> grouped = new LinkedHashMap<>();
        for (CommandCapability command : commands) {
            if (!"read".equalsIgnoreCase(command.access())) {
                continue;
            }
            grouped.computeIfAbsent(normalizeKey(command.site()), ignored -> new ArrayList<>()).add(command);
        }
        Map<String, SiteCapability> sites = new LinkedHashMap<>();
        Map<String, EcosystemConnectorVo> connectors = new LinkedHashMap<>();
        for (Map.Entry<String, List<CommandCapability>> entry : grouped.entrySet()) {
            SiteCapability site = buildSite(entry.getKey(), entry.getValue());
            sites.put(site.site(), site);
            connectors.put(site.site(), toConnector(site));
        }
        connectors.putIfAbsent("mail", mailConnector());
        return new CapabilitySnapshot(loadedAtMs, 0L, sites, connectors);
    }

    private List<CommandCapability> loadCommands() {
        CommandResult result = runCommand(List.of(resolveBin().toString(), "list", "-f", "json"), resolveWorkDir(),
            Duration.ofSeconds(30));
        if (result.exitCode() != 0 || isBlank(result.output())) {
            log.warn("OpenCLI capability list failed, exitCode={}, output={}", result.exitCode(),
                abbreviate(result.output(), 240));
            return List.of();
        }
        try {
            String jsonPayload = extractJsonArrayPayload(result.output());
            if (isBlank(jsonPayload)) {
                log.warn("OpenCLI capability list returned no JSON array, output={}",
                    abbreviate(result.output(), 240));
                return List.of();
            }
            JsonNode root = objectMapper.readTree(jsonPayload);
            if (!root.isArray()) {
                log.warn("OpenCLI capability list returned non-array JSON");
                return List.of();
            }
            List<CommandCapability> commands = new ArrayList<>();
            for (JsonNode node : root) {
                CommandCapability command = toCommandCapability(node);
                if (!isBlank(command.site()) && !isBlank(command.name())) {
                    commands.add(command);
                }
            }
            return commands;
        }
        catch (IOException e) {
            log.warn("OpenCLI capability list JSON parse failed", e);
            return List.of();
        }
    }

    static String extractJsonArrayPayload(String output) {
        if (output == null || output.trim().isEmpty()) {
            return "";
        }
        int start = output.indexOf('[');
        if (start < 0) {
            return "";
        }
        int depth = 0;
        boolean inString = false;
        boolean escaped = false;
        for (int i = start; i < output.length(); i++) {
            char ch = output.charAt(i);
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch == '\\') {
                    escaped = true;
                } else if (ch == '"') {
                    inString = false;
                }
                continue;
            }
            if (ch == '"') {
                inString = true;
            } else if (ch == '[') {
                depth++;
            } else if (ch == ']') {
                depth--;
                if (depth == 0) {
                    return output.substring(start, i + 1);
                }
            }
        }
        return "";
    }

    private CommandCapability toCommandCapability(JsonNode node) {
        List<CommandArg> args = new ArrayList<>();
        JsonNode argNodes = node.get("args");
        if (argNodes != null && argNodes.isArray()) {
            for (JsonNode argNode : argNodes) {
                args.add(new CommandArg(
                    text(argNode, "name"),
                    text(argNode, "type"),
                    argNode.path("required").asBoolean(false),
                    argNode.path("positional").asBoolean(false),
                    argNode.path("valueRequired").asBoolean(false),
                    argNode.path("default").isMissingNode() || argNode.path("default").isNull()
                        ? null
                        : argNode.path("default").asText()));
            }
        }
        return new CommandCapability(
            normalizeKey(text(node, "site")),
            text(node, "name"),
            text(node, "description"),
            defaultText(text(node, "access"), "read"),
            normalizeKey(text(node, "strategy")),
            node.path("browser").asBoolean(false),
            text(node, "domain"),
            text(node, "navigateBefore"),
            args);
    }

    private SiteCapability buildSite(String siteCode, List<CommandCapability> commands) {
        Set<String> domains = new LinkedHashSet<>();
        Set<String> strategies = new LinkedHashSet<>();
        boolean browserRequired = false;
        boolean serverCapable = false;
        for (CommandCapability command : commands) {
            if (!isBlank(command.domain())) {
                domains.add(command.domain().toLowerCase(Locale.ROOT));
            }
            if (!isBlank(command.strategy())) {
                strategies.add(command.strategy());
            }
            browserRequired = browserRequired || command.requiresBrowserBridge();
            serverCapable = serverCapable || command.isServerCapable() || "web".equalsIgnoreCase(siteCode);
        }
        return new SiteCapability(siteCode, displayName(siteCode), new ArrayList<>(domains),
            new ArrayList<>(strategies), browserRequired, serverCapable, commands);
    }

    private EcosystemConnectorVo toConnector(SiteCapability site) {
        EcosystemConnectorVo connector = new EcosystemConnectorVo();
        connector.setConnectorCode(site.site());
        connector.setConnectorName(site.displayName());
        connector.setCategory("OpenCLI");
        connector.setAvailable(Boolean.TRUE);
        List<String> runLocations = new ArrayList<>();
        List<String> authTypes = new ArrayList<>();
        if (site.serverCapable()) {
            runLocations.add("SERVER");
            authTypes.add("PUBLIC_URL");
        }
        if (site.browserRequired()) {
            runLocations.add("LOCAL");
            authTypes.add("BROWSER");
        }
        List<String> collectModes = collectModes(runLocations, authTypes);
        String defaultMode = site.serverCapable() ? COLLECT_MODE_SERVER_OPENCLI : COLLECT_MODE_USER_BROWSER_BRIDGE;
        connector.setRunLocations(runLocations);
        connector.setAuthTypes(authTypes);
        connector.setCollectModes(collectModes);
        connector.setDefaultCollectMode(defaultMode);
        connector.setRequiresLocalAgent(requiresUserBrowserBridge(defaultMode));
        connector.setRequiresBrowserAuth(site.browserRequired());
        connector.setRuntimeType("OPENCLI");
        connector.setStatus("ENABLED");
        connector.setDescription(site.commands().isEmpty() ? "OpenCLI connector" : site.commands().get(0).description());
        connector.setCapabilities(connectorCapabilities(site));
        return connector;
    }

    private EcosystemConnectorVo mailConnector() {
        EcosystemConnectorVo connector = new EcosystemConnectorVo();
        connector.setConnectorCode("mail");
        connector.setConnectorName("邮箱");
        connector.setCategory("Browser Bridge");
        connector.setAvailable(Boolean.TRUE);
        List<String> runLocations = List.of("SERVER", "LOCAL");
        List<String> authTypes = List.of("IMAP", "BROWSER");
        List<String> collectModes = collectModes(runLocations, authTypes);
        connector.setRunLocations(runLocations);
        connector.setAuthTypes(authTypes);
        connector.setCollectModes(collectModes);
        connector.setDefaultCollectMode(COLLECT_MODE_USER_BROWSER_BRIDGE);
        connector.setRequiresLocalAgent(Boolean.TRUE);
        connector.setRequiresBrowserAuth(Boolean.TRUE);
        connector.setRuntimeType("BYCLAW_BRIDGE");
        connector.setStatus("ENABLED");
        connector.setDescription("邮箱采集运行时能力：QQ 邮箱网页走 Browser Bridge，通用邮箱可走 IMAP。");
        connector.setCapabilities(List.of("collect", "markdown", "signals", "import", "mail", "qqmail", "imap",
            "browserBridge"));
        return connector;
    }

    private List<String> connectorCapabilities(SiteCapability site) {
        List<String> capabilities = new ArrayList<>();
        capabilities.add("opencli");
        capabilities.add("read");
        capabilities.add("markdown");
        if (site.serverCapable()) {
            capabilities.add("serverOpenCli");
        }
        if (site.browserRequired()) {
            capabilities.add("browserBridge");
        }
        site.commands().stream().limit(MAX_COMMANDS_IN_CONNECTOR_SCHEMA)
            .map(CommandCapability::name)
            .filter(name -> !isBlank(name))
            .forEach(name -> capabilities.add("command:" + name));
        return capabilities;
    }

    private String aliasSite(String text) {
        Map<String, String> aliases = Map.ofEntries(
            Map.entry("知乎", "zhihu"),
            Map.entry("小红书", "xiaohongshu"),
            Map.entry("微博", "weibo"),
            Map.entry("抖音", "douyin"),
            Map.entry("b站", "bilibili"),
            Map.entry("哔哩哔哩", "bilibili"),
            Map.entry("微信公众号", "weixin"),
            Map.entry("公众号", "weixin"),
            Map.entry("视频号", "wechat-channels"),
            Map.entry("淘宝", "taobao"),
            Map.entry("京东", "jd"),
            Map.entry("闲鱼", "xianyu"),
            Map.entry("知识星球", "zsxq"),
            Map.entry("一亩三分地", "1point3acres"));
        for (Map.Entry<String, String> entry : aliases.entrySet()) {
            if (text.contains(entry.getKey().toLowerCase(Locale.ROOT))) {
                return entry.getValue();
            }
        }
        return "";
    }

    private boolean acceptsUrlLikeInput(CommandCapability command) {
        for (CommandArg arg : command.args()) {
            String name = normalizeKey(arg.name());
            if ("url".equals(name) || "input".equals(name) || "target".equals(name) || "link".equals(name)) {
                return true;
            }
        }
        return false;
    }

    private boolean acceptsTextQuery(CommandCapability command) {
        for (CommandArg arg : command.args()) {
            String name = normalizeKey(arg.name());
            if ("query".equals(name) || "keyword".equals(name) || "q".equals(name) || "search".equals(name)) {
                return true;
            }
        }
        return false;
    }

    private boolean hasRequiredInput(CommandCapability command) {
        return requiredArgs(command).stream().anyMatch(arg -> arg.positional() || !isBlank(arg.name()));
    }

    private List<CommandArg> requiredArgs(CommandCapability command) {
        return command.args().stream()
            .filter(CommandArg::required)
            .filter(arg -> arg.defaultValue() == null)
            .toList();
    }

    private int commandScore(CommandCapability command, String sourceUrl, String text) {
        int score = 0;
        String name = normalizeKey(command.name());
        if (!isBlank(sourceUrl) && acceptsUrlLikeInput(command)) {
            score += 40;
        }
        if (!isBlank(text) && acceptsTextQuery(command)) {
            score += 30;
        }
        if (List.of("read", "detail", "item", "info", "topic", "post", "article", "download").contains(name)) {
            score += isBlank(sourceUrl) ? 5 : 25;
        }
        if (List.of("search", "latest", "hot", "feed", "recommend", "list").contains(name)) {
            score += isBlank(sourceUrl) ? 20 : 5;
        }
        score -= requiredArgs(command).size() * 3;
        return score;
    }

    private String displayName(String siteCode) {
        Map<String, String> names = Map.ofEntries(
            Map.entry("zhihu", "知乎"),
            Map.entry("xiaohongshu", "小红书"),
            Map.entry("weibo", "微博"),
            Map.entry("douyin", "抖音"),
            Map.entry("bilibili", "哔哩哔哩"),
            Map.entry("weixin", "微信公众号"),
            Map.entry("wechat-channels", "微信视频号"),
            Map.entry("taobao", "淘宝"),
            Map.entry("jd", "京东"),
            Map.entry("xianyu", "闲鱼"),
            Map.entry("zsxq", "知识星球"),
            Map.entry("1point3acres", "一亩三分地"));
        String name = names.get(siteCode);
        if (!isBlank(name)) {
            return name;
        }
        if (siteCode.length() <= 3) {
            return siteCode.toUpperCase(Locale.ROOT);
        }
        return siteCode;
    }

    private String normalizeKey(String value) {
        return defaultText(value, "").toLowerCase(Locale.ROOT);
    }

    private String host(String sourceUrl) {
        if (isBlank(sourceUrl)) {
            return "";
        }
        try {
            String host = URI.create(sourceUrl).getHost();
            return host == null ? "" : host.toLowerCase(Locale.ROOT);
        }
        catch (IllegalArgumentException e) {
            return "";
        }
    }

    private boolean hostMatches(String host, String domain) {
        if (isBlank(host) || isBlank(domain)) {
            return false;
        }
        String normalizedDomain = domain.toLowerCase(Locale.ROOT);
        return host.equals(normalizedDomain) || host.endsWith("." + normalizedDomain);
    }

    private Path resolveBin() {
        Path repoRoot = resolveRepoRoot();
        String configured = configured("BYKC_OPENCLI_BIN", "byclaw-be/runtime/opencli/node_modules/.bin/opencli");
        Path path = Paths.get(configured);
        return path.isAbsolute() ? path.normalize() : repoRoot.resolve(path).normalize();
    }

    private Path resolveWorkDir() {
        Path repoRoot = resolveRepoRoot();
        String configured = configured("BYKC_OPENCLI_WORKDIR", "byclaw-be/runtime/opencli");
        Path path = Paths.get(configured);
        return path.isAbsolute() ? path.normalize() : repoRoot.resolve(path).normalize();
    }

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
                return new CommandResult(-1, outputFuture.get(5, TimeUnit.SECONDS));
            }
            return new CommandResult(process.exitValue(), outputFuture.get(5, TimeUnit.SECONDS));
        }
        catch (Exception e) {
            return new CommandResult(-1, e.getMessage());
        }
    }

    private String readOutput(Process process) {
        try (InputStream inputStream = process.getInputStream()) {
            return new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        }
        catch (IOException e) {
            return e.getMessage();
        }
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node == null ? null : node.get(field);
        return value == null || value.isNull() ? "" : value.asText("");
    }

    private record CapabilitySnapshot(long loadedAtMs,
                                      long refreshFailedAtMs,
                                      Map<String, SiteCapability> sites,
                                      Map<String, EcosystemConnectorVo> connectors) {

        private CapabilitySnapshot refreshFailedAt(long failedAtMs) {
            return new CapabilitySnapshot(loadedAtMs, failedAtMs, sites, connectors);
        }
    }

    private record CommandResult(int exitCode, String output) {
    }

    public record SiteCapability(String site,
                                 String displayName,
                                 List<String> domains,
                                 List<String> strategies,
                                 boolean browserRequired,
                                 boolean serverCapable,
                                 List<CommandCapability> commands) {
    }

    public record CommandCapability(String site,
                                    String name,
                                    String description,
                                    String access,
                                    String strategy,
                                    boolean browser,
                                    String domain,
                                    String navigateBefore,
                                    List<CommandArg> args) {

        public boolean requiresBrowserBridge() {
            return browser || "cookie".equalsIgnoreCase(strategy) || "intercept".equalsIgnoreCase(strategy)
                || "ui".equalsIgnoreCase(strategy);
        }

        public boolean isServerCapable() {
            return !requiresBrowserBridge() || "public".equalsIgnoreCase(strategy) || "local".equalsIgnoreCase(strategy)
                || "api".equalsIgnoreCase(strategy) || "imap".equalsIgnoreCase(strategy);
        }
    }

    public record CommandArg(String name,
                             String type,
                             boolean required,
                             boolean positional,
                             boolean valueRequired,
                             String defaultValue) {
    }
}
