package com.iwhalecloud.byai.common.storage.impl;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.storage.config.MinioConfig;
import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Properties;

/**
 * MinIO bucket 挂载宿主机执行器。
 */
@Service("commonMinioMountHostExecutor")
public class MinioMountHostExecutor {

    private static final Logger LOGGER = LoggerFactory.getLogger(MinioMountHostExecutor.class);

    private static final String BROKEN_MOUNT_MESSAGE = "Transport endpoint is not connected";

    public boolean ensureRemoteDirectoryExists(MinioConfig.Target target, String remoteDirectory) {
        try {
            execute(target, "mkdir -p " + shellQuote(remoteDirectory));
            return false;
        } catch (BaseException e) {
            if (!isBrokenMountDirectoryError(e)) {
                throw e;
            }
            LOGGER.warn("检测到宿主机目录为坏挂载点，开始自愈处理, host={}, remoteDirectory={}, reason={}",
                target.getHost(), remoteDirectory, e.getMessage());
            recoverBrokenMountPoint(target, remoteDirectory);
            execute(target, "mkdir -p " + shellQuote(remoteDirectory));
            return true;
        }
    }

    public boolean isRemoteDirectoryMounted(MinioConfig.Target target, String remoteDirectory) {
        String command = "mount | grep -F " + shellQuote(" on " + remoteDirectory + " ");
        CommandResult commandResult = execute(target, command, true);
        boolean mounted = commandResult.getExitCode() == 0;
        LOGGER.info("宿主机挂载状态校验完成, host={}, remoteDirectory={}, mounted={}, output={}",
            target.getHost(), remoteDirectory, mounted, commandResult.getOutput());
        return mounted;
    }

    public String inspectRemoteDirectoryState(MinioConfig.Target target, String remoteDirectory) {
        String command = "sh -lc " + shellQuote("ls -ld " + shellQuote(remoteDirectory) + " 2>&1");
        CommandResult result = execute(target, command, true);
        LOGGER.info("宿主机目录状态检查完成, host={}, remoteDirectory={}, exitCode={}, output={}",
            target.getHost(), remoteDirectory, result.getExitCode(), result.getOutput());
        return result.getOutput();
    }

    public void executeMountCommand(MinioConfig.Target target, String command, String bucketName, String remoteDirectory) {
        CommandResult commandResult = execute(target, command, true);
        if (commandResult.getExitCode() != 0) {
            throw new BaseException("宿主机执行rclone挂载失败: host=" + target.getHost()
                + ", bucketName=" + bucketName + ", remoteDirectory=" + remoteDirectory
                + ", exitCode=" + commandResult.getExitCode() + ", output=" + commandResult.getOutput());
        }
        LOGGER.info("宿主机rclone挂载命令执行完成, host={}, bucketName={}, remoteDirectory={}, output={}",
            target.getHost(), bucketName, remoteDirectory, commandResult.getOutput());
    }

    public String maskSensitiveCommand(String command, String accessKey, String secretKey) {
        String masked = command;
        if (StringUtils.isNotBlank(accessKey)) {
            masked = masked.replace(accessKey, "******");
        }
        if (StringUtils.isNotBlank(secretKey)) {
            masked = masked.replace(secretKey, "******");
        }
        return masked;
    }

    private void execute(MinioConfig.Target target, String command) {
        CommandResult commandResult = execute(target, command, true);
        if (commandResult.getExitCode() != 0) {
            throw new BaseException("宿主机命令执行失败: host=" + target.getHost()
                + ", command=" + command + ", exitCode=" + commandResult.getExitCode()
                + ", output=" + commandResult.getOutput());
        }
    }

    private void recoverBrokenMountPoint(MinioConfig.Target target, String remoteDirectory) {
        String lazyUmountCommand = "umount -l " + shellQuote(remoteDirectory);
        CommandResult umountResult = execute(target, lazyUmountCommand, true);
        if (umountResult.getExitCode() == 0) {
            LOGGER.info("坏挂载点懒卸载成功, host={}, remoteDirectory={}", target.getHost(), remoteDirectory);
            return;
        }

        String fusermountCommand = "fusermount -uz " + shellQuote(remoteDirectory);
        CommandResult fusermountResult = execute(target, fusermountCommand, true);
        if (fusermountResult.getExitCode() == 0) {
            LOGGER.info("坏挂载点FUSE卸载成功, host={}, remoteDirectory={}", target.getHost(), remoteDirectory);
            return;
        }

        throw new BaseException("坏挂载点自愈卸载失败: host=" + target.getHost()
            + ", remoteDirectory=" + remoteDirectory
            + ", umountOutput=" + umountResult.getOutput()
            + ", fusermountOutput=" + fusermountResult.getOutput());
    }

    private boolean isBrokenMountDirectoryError(BaseException e) {
        return e != null && StringUtils.containsIgnoreCase(StringUtils.defaultString(e.getMessage()), BROKEN_MOUNT_MESSAGE);
    }

    private CommandResult execute(MinioConfig.Target target, String command, boolean logCommand) {
        validateTarget(target);
        Session session = null;
        ChannelExec channel = null;
        try {
            LOGGER.info("开始连接宿主机, host={}, port={}, user={}",
                target.getHost(), resolvePort(target), target.getUser());
            session = createSession(target);
            LOGGER.info("宿主机连接成功, host={}, port={}, user={}",
                target.getHost(), resolvePort(target), target.getUser());
            channel = (ChannelExec) session.openChannel("exec");
            channel.setCommand(command);
            channel.setInputStream(null);

            ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
            ByteArrayOutputStream errorStream = new ByteArrayOutputStream();
            channel.setOutputStream(outputStream);
            channel.setErrStream(errorStream);

            if (logCommand) {
                LOGGER.info("开始在宿主机执行命令, host={}, port={}, user={}, command={}",
                    target.getHost(), resolvePort(target), target.getUser(), command);
            }

            channel.connect();
            while (!channel.isClosed()) {
                Thread.sleep(200L);
            }
            String output = outputStream.toString(StandardCharsets.UTF_8);
            String error = errorStream.toString(StandardCharsets.UTF_8);
            String mergedOutput = mergeOutput(output, error);
            LOGGER.info("宿主机命令执行完成, host={}, port={}, user={}, exitCode={}, output={}",
                target.getHost(), resolvePort(target), target.getUser(), channel.getExitStatus(), mergedOutput);
            return new CommandResult(channel.getExitStatus(), mergedOutput);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            LOGGER.error("宿主机命令执行被中断, host={}, port={}, user={}, command={}",
                target.getHost(), resolvePort(target), target.getUser(), command, e);
            throw new BaseException("宿主机命令执行被中断: host=" + target.getHost(), e);
        } catch (Exception e) {
            LOGGER.error("宿主机命令执行异常, host={}, port={}, user={}, command={}, reason={}",
                target.getHost(), resolvePort(target), target.getUser(), command, e.getMessage(), e);
            throw new BaseException("宿主机命令执行失败: host=" + target.getHost(), e);
        } finally {
            if (channel != null && channel.isConnected()) {
                channel.disconnect();
            }
            if (session != null && session.isConnected()) {
                session.disconnect();
            }
        }
    }

    private Session createSession(MinioConfig.Target target) throws Exception {
        JSch jsch = new JSch();
        Session session = jsch.getSession(target.getUser(), target.getHost(), resolvePort(target));
        session.setPassword(target.getPassword());
        Properties config = new Properties();
        config.put("StrictHostKeyChecking", "no");
        session.setConfig(config);
        session.connect();
        return session;
    }

    private void validateTarget(MinioConfig.Target target) {
        if (target == null) {
            throw new BaseException("MinIO挂载宿主机配置不能为空");
        }
        if (StringUtils.isBlank(target.getHost())) {
            throw new BaseException("MinIO挂载宿主机host不能为空");
        }
        if (StringUtils.isBlank(target.getUser())) {
            throw new BaseException("MinIO挂载宿主机user不能为空, host=" + target.getHost());
        }
        if (StringUtils.isBlank(target.getPassword())) {
            throw new BaseException("MinIO挂载宿主机password不能为空, host=" + target.getHost());
        }
    }

    private int resolvePort(MinioConfig.Target target) {
        return target.getPort() == null ? 22 : target.getPort();
    }

    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }

    private static String mergeOutput(String output, String error) {
        String normalizedOutput = StringUtils.defaultString(output).trim();
        String normalizedError = StringUtils.defaultString(error).trim();
        if (StringUtils.isBlank(normalizedOutput)) {
            return normalizedError;
        }
        if (StringUtils.isBlank(normalizedError)) {
            return normalizedOutput;
        }
        return normalizedOutput + System.lineSeparator() + normalizedError;
    }

    private static class CommandResult {

        private final int exitCode;

        private final String output;

        private CommandResult(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output;
        }

        public int getExitCode() {
            return exitCode;
        }

        public String getOutput() {
            return output;
        }
    }
}
