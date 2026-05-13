package com.iwhalecloud.byai.state.domain.session.enums;

public enum UserRole {
    OWNER,
    ADMIN,
    MEMBER;


    /**
     * 验证给定的字符串是否为有效的用户角色类型
     *
     * @param type 待验证的角色类型字符串
     * @return 如果字符串对应有效的UserRole枚举值则返回true，否则返回false
     */
    public static boolean isValid(String type) {
        if (type == null) {
            return false;
        }

        // 遍历所有UserRole枚举值，检查是否存在匹配的类型
        for (UserRole role : values()) {
            if (role.name().equals(type)) {
                return true;
            }
        }
        return false;
    }
}
