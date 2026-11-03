package com.iwhalecloud.byai.manager.application.service.resource;

import org.apache.commons.lang3.StringUtils;
import java.util.regex.Pattern;

/** Published Skill display names and SKILL.md names use the same enterprise suffix. */
public final class SkillPublicationNames {
    private static final String SUFFIX = "_企业";
    // Same grammar as the Harness registry/tool patch and ByClaw Skill loader.
    private static final Pattern RUNTIME_NAME = Pattern.compile("[\\p{L}\\p{N}]+(?:[-_][\\p{L}\\p{N}]+)*");

    private SkillPublicationNames() { }

    public static String enterpriseName(String name) {
        if (StringUtils.isBlank(name)) return name;
        String base = baseName(name);
        return base.isEmpty() ? base : base + SUFFIX;
    }

    public static String enterpriseName(String name, String publisher) {
        if (StringUtils.isBlank(name)) return name;
        String base = baseName(name);
        String qualifier = normalize(StringUtils.trimToEmpty(publisher));
        return base.isEmpty() ? base : base + (qualifier.isEmpty() ? "" : "_" + qualifier) + SUFFIX;
    }

    public static boolean isRuntimeCompatible(String name) {
        return name != null && RUNTIME_NAME.matcher(name).matches();
    }

    private static String baseName(String name) {
        return normalize(name.strip().replaceFirst("(?:\\s*[（(](?:企业|Enterprise)[）)]|_(?:企业|Enterprise))$", ""));
    }

    private static String normalize(String name) {
        return name.replaceAll("[^\\p{L}\\p{N}_-]+", "_")
            .replaceAll("[-_]{2,}", "_").replaceAll("^[-_]+|[-_]+$", "");
    }
}
