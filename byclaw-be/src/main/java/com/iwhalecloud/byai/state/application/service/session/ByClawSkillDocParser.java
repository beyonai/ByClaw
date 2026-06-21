package com.iwhalecloud.byai.state.application.service.session;

import java.util.Arrays;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;

/**
 * Extracts user-facing metadata from SKILL.md while hiding YAML front matter.
 *
 * @author qin.guoquan
 * @date 2026-06-21 17:38:38
 */
final class ByClawSkillDocParser {

    private ByClawSkillDocParser() {
    }

    static String extractDescription(String content) {
        if (StringUtils.isBlank(content)) {
            return null;
        }
        String frontMatterDescription = extractFrontMatterValue(content, "description");
        if (StringUtils.isNotBlank(frontMatterDescription)) {
            return frontMatterDescription;
        }
        String text = stripFrontMatter(content);
        return text.lines()
            .map(StringUtils::trimToEmpty)
            .filter(StringUtils::isNotBlank)
            .filter(line -> !line.startsWith("#"))
            .limit(3)
            .collect(Collectors.joining(" "));
    }

    private static String extractFrontMatterValue(String content, String key) {
        FrontMatterText frontMatterText = normalizeFrontMatter(content);
        if (!frontMatterText.hasFrontMatter()) {
            return null;
        }
        String[] lines = frontMatterText.text().split("\\R");
        for (int i = frontMatterText.startLine(); i < lines.length; i++) {
            String line = StringUtils.trimToEmpty(lines[i]);
            if ("---".equals(line) || "...".equals(line)) {
                break;
            }
            if (StringUtils.startsWithIgnoreCase(line, key + ":")) {
                return StringUtils.strip(StringUtils.substringAfter(line, ":"), "\"' ");
            }
        }
        return null;
    }

    private static String stripFrontMatter(String content) {
        FrontMatterText frontMatterText = normalizeFrontMatter(content);
        if (!frontMatterText.hasFrontMatter()) {
            return frontMatterText.text();
        }
        String[] lines = frontMatterText.text().split("\\R", -1);
        for (int i = frontMatterText.startLine(); i < lines.length; i++) {
            String line = StringUtils.trimToEmpty(lines[i]);
            if ("---".equals(line) || "...".equals(line)) {
                return String.join("\n", Arrays.copyOfRange(lines, i + 1, lines.length));
            }
        }
        int firstContentLine = frontMatterText.startLine();
        while (firstContentLine < lines.length && isYamlMetadataLine(lines[firstContentLine])) {
            firstContentLine++;
        }
        return String.join("\n", Arrays.copyOfRange(lines, firstContentLine, lines.length));
    }

    private static FrontMatterText normalizeFrontMatter(String content) {
        String text = StringUtils.removeStart(content, "\uFEFF");
        if (!text.startsWith("---")) {
            return new FrontMatterText(text, false, 0);
        }
        String[] lines = text.split("\\R", -1);
        String firstLine = StringUtils.trimToEmpty(lines[0]);
        if ("---".equals(firstLine)) {
            return new FrontMatterText(text, true, 1);
        }
        if (firstLine.startsWith("--- ")) {
            lines[0] = StringUtils.trimToEmpty(firstLine.substring(4));
            return new FrontMatterText(String.join("\n", lines), true, 0);
        }
        return new FrontMatterText(text, true, 1);
    }

    private static boolean isYamlMetadataLine(String line) {
        String trimmed = StringUtils.trimToEmpty(line);
        return StringUtils.isBlank(trimmed) || "---".equals(trimmed) || "...".equals(trimmed)
            || trimmed.matches("[A-Za-z_][A-Za-z0-9_-]*\\s*:.*");
    }

    private record FrontMatterText(String text, boolean hasFrontMatter, int startLine) {
    }
}
