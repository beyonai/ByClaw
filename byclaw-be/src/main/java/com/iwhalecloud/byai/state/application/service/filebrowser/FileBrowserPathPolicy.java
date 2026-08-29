package com.iwhalecloud.byai.state.application.service.filebrowser;

import java.util.List;

import org.apache.commons.lang3.StringUtils;

/** Central path policy for private runtime credentials mounted below the user's file workspace. */
final class FileBrowserPathPolicy {

    private static final List<String> PROTECTED_ROOTS = List.of(
        "/.connector-auth",
        "/by/.connector-auth");

    private FileBrowserPathPolicy() {
    }

    static void assertBrowsable(String path) {
        String normalized = normalize(path);
        if (isProtected(normalized)) {
            throw new IllegalArgumentException("该目录属于系统凭据目录，禁止访问");
        }
    }

    static void assertNoProtectedIntersection(String path) {
        String normalized = normalize(path);
        if (isProtected(normalized) || PROTECTED_ROOTS.stream().anyMatch(root -> isAncestor(normalized, root))) {
            throw new IllegalArgumentException("该操作涉及系统凭据目录，禁止执行");
        }
    }

    static boolean isProtected(String path) {
        String normalized = normalize(path);
        return PROTECTED_ROOTS.stream()
            .anyMatch(root -> normalized.equals(root) || normalized.startsWith(root + "/"));
    }

    static String normalize(String path) {
        String normalized = StringUtils.defaultIfBlank(path, "/").trim().replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.contains(normalized, "..")) {
            throw new IllegalArgumentException("非法路径: " + path);
        }
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        normalized = StringUtils.removeEnd(normalized, "/");
        return StringUtils.isBlank(normalized) ? "/" : normalized;
    }

    private static boolean isAncestor(String candidate, String path) {
        return "/".equals(candidate) || path.startsWith(candidate + "/");
    }
}
