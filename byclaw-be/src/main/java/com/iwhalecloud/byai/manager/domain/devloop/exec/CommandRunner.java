package com.iwhalecloud.byai.manager.domain.devloop.exec;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * 集成测试执行用的通用命令执行器。connProtocol=ssh 走 JSch exec channel,local 走 ProcessBuilder。
 * exec-poll / shellQuote 逻辑参考 common/storage/impl/MinioMountHostExecutor,补齐 key 认证、超时、env 注入。
 * 结果统一为封闭的 SshExecResult(退出码/合并日志/超时标记),连接或执行异常上抛给编排层记 run=error。
 */
@Slf4j
@Service
public class CommandRunner {

    private static final String CONN_LOCAL = "local";

    private static final int DEFAULT_PORT = 22;

    private static final long POLL_INTERVAL_MS = 200L;

    /** 单步日志上限,仅存尾部,避免 TEXT 膨胀;完整日志留在远程 result_dir。 */
    private static final int MAX_LOG_CHARS = 32 * 1024;

    /** shell 变量名合法字符集:字母/下划线开头,后接字母数字下划线。 */
    private static final Pattern VALID_ENV_KEY = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");

    public SshExecResult run(CommandExecSpec spec) throws Exception {
        String fullCommand = buildFullCommand(spec.getEnv(), spec.getWorkdir(), spec.getCommand());
        if (CONN_LOCAL.equalsIgnoreCase(spec.getConnProtocol())) {
            return runLocal(fullCommand, spec);
        }
        return runSsh(spec, fullCommand);
    }

    /** 命令前拼 export 注入 env、cd 进 workdir;env 值 shellQuote 防注入,键按标识符白名单校验。 */
    private String buildFullCommand(Map<String, String> env, String workdir, String command) {
        StringBuilder sb = new StringBuilder();
        if (env != null) {
            for (Map.Entry<String, String> e : env.entrySet()) {
                // 键不能 quote(quote 了就不是赋值),所以只能白名单。键来自用户配的 envPrefix,
                // 带引号/空格/分号时会破坏整条命令语法,后续 cd 与业务命令一起失败,且是注入口子。
                if (!VALID_ENV_KEY.matcher(StringUtils.defaultString(e.getKey())).matches()) {
                    log.warn("Skip invalid env key for command injection: {}", e.getKey());
                    continue;
                }
                sb.append("export ").append(e.getKey()).append('=')
                    .append(shellQuote(StringUtils.defaultString(e.getValue()))).append('\n');
            }
        }
        if (StringUtils.isNotBlank(workdir)) {
            sb.append("cd ").append(shellQuote(workdir)).append(" && ");
        }
        sb.append(command);
        return sb.toString();
    }

    private SshExecResult runSsh(CommandExecSpec spec, String fullCommand) throws Exception {
        Session session = null;
        ChannelExec channel = null;
        try {
            session = createSession(spec);
            channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(fullCommand);
            channel.setInputStream(null);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ByteArrayOutputStream err = new ByteArrayOutputStream();
            channel.setOutputStream(out);
            channel.setErrStream(err);
            channel.connect();

            long deadline = nowPlusSeconds(spec.getTimeoutSec());
            while (!channel.isClosed()) {
                if (spec.getTimeoutSec() > 0 && System.currentTimeMillis() > deadline) {
                    return new SshExecResult(-1, shapeOutput(spec, out, err), true);
                }
                Thread.sleep(POLL_INTERVAL_MS);
            }
            return new SshExecResult(channel.getExitStatus(), shapeOutput(spec, out, err), false);
        } finally {
            if (channel != null && channel.isConnected()) {
                channel.disconnect();
            }
            if (session != null && session.isConnected()) {
                session.disconnect();
            }
        }
    }

    private Session createSession(CommandExecSpec spec) throws Exception {
        JSch jsch = new JSch();
        if ("key".equalsIgnoreCase(spec.getAuthType())) {
            // 私钥正文以字节数组注入,不落临时文件;无 passphrase。
            jsch.addIdentity("devloop-integration", spec.getSecret().getBytes(StandardCharsets.UTF_8), null, null);
        }
        Session session = jsch.getSession(spec.getUser(), spec.getHost(), resolvePort(spec.getPort()));
        if (!"key".equalsIgnoreCase(spec.getAuthType())) {
            session.setPassword(spec.getSecret());
        }
        Properties config = new Properties();
        config.put("StrictHostKeyChecking", "no");
        session.setConfig(config);
        int connectTimeoutMs = spec.getTimeoutSec() > 0 ? spec.getTimeoutSec() * 1000 : 0;
        session.connect(connectTimeoutMs);
        return session;
    }

    private SshExecResult runLocal(String fullCommand, CommandExecSpec spec) throws Exception {
        ProcessBuilder pb = new ProcessBuilder("bash", "-lc", fullCommand);
        // 本机模式 stderr 由 OS 合流,rawOutput 只能免掉截断这一层。
        pb.redirectErrorStream(!spec.isRawOutput());
        Process process = pb.start();
        String output;
        try (java.io.InputStream is = process.getInputStream()) {
            output = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        int timeoutSec = spec.getTimeoutSec();
        if (timeoutSec > 0) {
            boolean done = process.waitFor(timeoutSec, TimeUnit.SECONDS);
            if (!done) {
                process.destroyForcibly();
                return new SshExecResult(-1, shapeLocalOutput(spec, output), true);
            }
        } else {
            process.waitFor();
        }
        return new SshExecResult(process.exitValue(), shapeLocalOutput(spec, output), false);
    }

    private static String shapeLocalOutput(CommandExecSpec spec, String output) {
        return spec.isRawOutput() ? output : truncate(output);
    }

    private long nowPlusSeconds(int seconds) {
        return seconds > 0 ? System.currentTimeMillis() + seconds * 1000L : Long.MAX_VALUE;
    }

    private int resolvePort(String port) {
        if (StringUtils.isBlank(port)) {
            return DEFAULT_PORT;
        }
        try {
            return Integer.parseInt(port.trim());
        } catch (NumberFormatException e) {
            return DEFAULT_PORT;
        }
    }

    /** 单引号包裹并转义内部单引号,防命令注入(参考 MinioMountHostExecutor.shellQuote)。 */
    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    /**
     * 日志态与原文态的唯一分叉点。rawOutput 时返回未截断的纯 stdout(stdout 为空才回落 stderr,
     * 保证失败原因不丢),否则按步骤日志的老规则合并 stderr 并留尾部。
     */
    private static String shapeOutput(CommandExecSpec spec, ByteArrayOutputStream out, ByteArrayOutputStream err) {
        String stdout = out.toString(StandardCharsets.UTF_8);
        String stderr = err.toString(StandardCharsets.UTF_8);
        if (spec.isRawOutput()) {
            return StringUtils.isNotBlank(stdout) ? stdout : StringUtils.defaultString(stderr).trim();
        }
        return truncate(mergeOutput(stdout, stderr));
    }

    private static String mergeOutput(String output, String error) {
        String o = StringUtils.defaultString(output).trim();
        String e = StringUtils.defaultString(error).trim();
        if (StringUtils.isBlank(o)) {
            return e;
        }
        if (StringUtils.isBlank(e)) {
            return o;
        }
        return o + System.lineSeparator() + e;
    }

    /** 只留尾部 MAX_LOG_CHARS,失败日志的关键信息通常在末尾。 */
    private static String truncate(String text) {
        if (text == null || text.length() <= MAX_LOG_CHARS) {
            return text;
        }
        return "...[truncated]...\n" + text.substring(text.length() - MAX_LOG_CHARS);
    }
}
