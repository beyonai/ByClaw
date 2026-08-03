package com.iwhalecloud.byai.manager.domain.devloop.exec;

import lombok.Getter;

/**
 * 一次命令执行的封闭结果:退出码 + 合并日志 + 是否超时。
 * timedOut=true 时 exitCode 无意义(命令被强制中断),编排层据此标 run=timeout。
 */
@Getter
public class SshExecResult {

    private final int exitCode;

    private final String output;

    private final boolean timedOut;

    public SshExecResult(int exitCode, String output, boolean timedOut) {
        this.exitCode = exitCode;
        this.output = output;
        this.timedOut = timedOut;
    }

    /** 退出码为0且未超时视为成功。 */
    public boolean isSuccess() {
        return !timedOut && exitCode == 0;
    }
}
