package com.iwhalecloud.byai.manager.application.service.digitemploy;

/** 仅服务端受控的版本恢复上下文，不能由客户端 DTO 设置跳过权限或审核。 */
final class EmployeeVersionContext implements AutoCloseable {
    private record Target(Long versionId, String requestId) { }
    private static final ThreadLocal<Target> TARGET = new ThreadLocal<>();
    private final Target previous;
    EmployeeVersionContext(Long versionId, String requestId) { previous = TARGET.get(); TARGET.set(new Target(versionId, requestId)); }
    static Long target() { return TARGET.get() == null ? null : TARGET.get().versionId(); }
    static String requestId() { return TARGET.get() == null ? null : TARGET.get().requestId(); }
    @Override public void close() { if (previous == null) TARGET.remove(); else TARGET.set(previous); }
}
