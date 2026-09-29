package com.iwhalecloud.byai.common.constants.resource;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 四类已下线资源业务类型（本体库 / 对象 / 视图 / 场景）的统一停用规则。
 *
 * <p>本类是资源查询与员工关联资源读取路径上「停用类型」判定的<b>单一事实来源</b>：
 * 各 Controller / Service / Mapper 必须引用本类，禁止再书写类型清单字面量。
 *
 * <p>规则语义（与插件侧 {@code 0008} 共用同一份用例表，但不共享源码）：
 * <ul>
 *   <li>停用类型码恰为 {@code OBJECT} / {@code VIEW} / {@code ONTOLOGY_BASE} / {@code SCENE}；</li>
 *   <li>归一化 = {@code trim} + {@code toUpperCase(Locale.ROOT)}；</li>
 *   <li>{@code null} / 空白 / 未知类型 ⇒ 非停用（保持既有空值语义）；</li>
 *   <li>历史别名集合当前已核实为<b>空</b>，保留扩展位。</li>
 * </ul>
 *
 * <p>本类为无状态纯函数工具，无 Spring 依赖，可直接单测。
 */
public final class DisabledResourceBizTypes {

    /** 停用调用对外/日志统一原因码（运行时资源查询的 {@code reason} 取值；插件侧必须识别同一取值）。 */
    public static final String REASON_CODE = "RESOURCE_TYPE_DISABLED";

    /** 停用类型码：恰好四类，大写、不可变。类型码由 {@link ResourceBizType} 枚举派生，本类不写类型字符串。 */
    private static final Set<String> DISABLED_CODES = Set.of(
        ResourceBizType.OBJECT.getCode(),
        ResourceBizType.VIEW.getCode(),
        ResourceBizType.ONTOLOGY_BASE.getCode(),
        ResourceBizType.SCENE.getCode()
    );

    /** 已核实的历史别名（当前为空集；若后续核实出新别名，在此扩展，调用方无需改动）。 */
    private static final Set<String> DISABLED_ALIASES = Set.of();

    /** 判定用全集：规范化类型码 ∪ 历史别名。 */
    private static final Set<String> DISABLED_ALL = Set.copyOf(union(DISABLED_CODES, DISABLED_ALIASES));

    private DisabledResourceBizTypes() {
    }

    /** 停用类型码：恰好 {@code OBJECT} / {@code VIEW} / {@code ONTOLOGY_BASE} / {@code SCENE}。 */
    public static Set<String> codes() {
        return DISABLED_CODES;
    }

    /** 历史别名集合（已核实为空集，保留扩展位）。 */
    public static Set<String> aliases() {
        return DISABLED_ALIASES;
    }

    /** 归一化：{@code null} → {@code ""}；否则 {@code trim} + {@code toUpperCase(Locale.ROOT)}。 */
    public static String normalize(String rawBizType) {
        return rawBizType == null ? "" : rawBizType.trim().toUpperCase(Locale.ROOT);
    }

    /** 是否为停用类型；{@code null} / 空白 / 未知类型 → {@code false}。 */
    public static boolean isDisabled(String rawBizType) {
        return DISABLED_ALL.contains(normalize(rawBizType));
    }

    /** 是否为可用类型；等价于 {@code !isDisabled(rawBizType)}。 */
    public static boolean isEnabled(String rawBizType) {
        return !isDisabled(rawBizType);
    }

    /** 集合中是否存在任一停用类型；{@code null} 集合 → {@code false}。 */
    public static boolean containsAnyDisabled(Collection<String> rawBizTypes) {
        if (rawBizTypes == null || rawBizTypes.isEmpty()) {
            return false;
        }
        return rawBizTypes.stream().anyMatch(DisabledResourceBizTypes::isDisabled);
    }

    /** 归一化 + 去重 + 保序，剔除停用类型与空白项；空入参返回空列表。 */
    public static List<String> enabledOnly(Collection<String> candidates) {
        if (candidates == null || candidates.isEmpty()) {
            return List.of();
        }
        Set<String> normalized = new LinkedHashSet<>();
        for (String candidate : candidates) {
            String value = normalize(candidate);
            if (!value.isEmpty() && !DISABLED_ALL.contains(value)) {
                normalized.add(value);
            }
        }
        return List.copyOf(normalized);
    }

    private static Set<String> union(Set<String> left, Set<String> right) {
        Set<String> merged = new LinkedHashSet<>(left);
        merged.addAll(right);
        return merged;
    }
}
