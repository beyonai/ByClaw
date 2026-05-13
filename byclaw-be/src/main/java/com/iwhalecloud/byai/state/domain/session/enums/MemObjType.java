package com.iwhalecloud.byai.state.domain.session.enums;

public enum MemObjType {
    USER,
    AGENT;

    /**
     * 验证给定的类型字符串是否为有效的内存对象类型
     *
     * @param type 待验证的类型字符串
     * @return 如果类型有效返回true，否则返回false
     */
    public static boolean isValid(String type) {
        if (type == null) {
            return false;
        }

        // 遍历所有内存对象类型，检查是否存在匹配的类型名称
        for (MemObjType memObjType : values()) {
            if (memObjType.name().equals(type)) {
                return true;
            }
        }
        return false;
    }
}
