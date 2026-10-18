package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

/** Conservative lexical protection shared by sentence buffering and translation. */
final class ReasoningTranslationText {
    private static final Pattern ABBREVIATION = Pattern.compile("(?i).*\\b(?:e\\.g|i\\.e|mr|mrs|ms|dr|prof|vs|etc)\\.$");
    private static final Pattern TECHNICAL = Pattern.compile(
        "https?://[^\\s<>]+|(?:[A-Za-z]:\\\\|/|\\./|\\.\\./)[\\w./\\\\-]+"
            + "|\\b[\\w.-]+@[\\w.-]+\\.[A-Za-z]+\\b"
            + "|\\b\\w*(?:_\\w+|[a-z][A-Z]\\w*)\\b");

    private ReasoningTranslationText() { }

    record Span(int start, int end, boolean closed) { }

    static List<Span> spans(String text) {
        List<Span> spans = new ArrayList<>();
        for (int i = 0; i < text.length();) {
            int start = i;
            char c = text.charAt(i);
            if (c == '`' || text.startsWith("~~~", i)) {
                String delimiter = c == '`' ? "`" : "~~~";
                if (c == '`') {
                    while (i + delimiter.length() < text.length() && text.charAt(i + delimiter.length()) == '`') {
                        delimiter += "`";
                    }
                }
                int end = text.indexOf(delimiter, start + delimiter.length());
                boolean closed = end >= 0;
                i = closed ? end + delimiter.length() : text.length();
                spans.add(new Span(start, i, closed));
            }
            else if (c == '"') {
                boolean escaped = false;
                boolean closed = false;
                i++;
                while (i < text.length()) {
                    char current = text.charAt(i++);
                    if (escaped) escaped = false;
                    else if (current == '\\') escaped = true;
                    else if (current == '"') { closed = true; break; }
                }
                spans.add(new Span(start, i, closed));
            }
            else if (c == '{' || c == '[') {
                int depth = 0;
                boolean quoted = false;
                boolean escaped = false;
                do {
                    char current = text.charAt(i++);
                    if (quoted) {
                        if (escaped) escaped = false;
                        else if (current == '\\') escaped = true;
                        else if (current == '"') quoted = false;
                    }
                    else if (current == '"') quoted = true;
                    else if (current == '{' || current == '[') depth++;
                    else if (current == '}' || current == ']') depth--;
                } while (i < text.length() && (depth > 0 || quoted));
                spans.add(new Span(start, i, depth == 0 && !quoted));
            }
            else i++;
        }
        var matcher = TECHNICAL.matcher(text);
        while (matcher.find()) {
            if (spans.stream().noneMatch(span -> matcher.start() < span.end() && matcher.end() > span.start())) {
                spans.add(new Span(matcher.start(), matcher.end(), true));
            }
        }
        spans.sort(java.util.Comparator.comparingInt(Span::start));
        return spans;
    }

    /** No arbitrary character/time cut: unfinished syntax waits for more input or the segment end. */
    static int boundary(String text, boolean flush) {
        List<Span> protectedSpans = spans(text);
        int boundary = 0;
        int parentheses = 0;
        for (int i = 0; i < text.length(); i++) {
            final int index = i;
            Span protectedSpan = protectedSpans.stream()
                .filter(span -> index >= span.start() && index < span.end()).findFirst().orElse(null);
            if (protectedSpan != null) {
                i = protectedSpan.end() - 1;
                continue;
            }
            char c = text.charAt(i);
            if (c == '(' || c == '（') parentheses++;
            if (c == ')' || c == '）') parentheses = Math.max(0, parentheses - 1);
            boolean stop = "。！？!?".indexOf(c) >= 0
                || c == '.' && i + 1 < text.length() && Character.isWhitespace(text.charAt(i + 1))
                    && !ABBREVIATION.matcher(text.substring(Math.max(0, i - 12), i + 1)).matches()
                || c == '\n' && i > 0 && text.charAt(i - 1) == '\n';
            if (stop && parentheses == 0) {
                boundary = i + 1;
                // A small paragraph per request, with preceding source supplied as context.
                if (boundary >= 1200) break;
            }
        }
        return boundary > 0 ? boundary : flush ? text.length() : 0;
    }

    static ProtectedText protect(String source) {
        String prefix = "KEEP_" + UUID.randomUUID().toString().replace("-", "") + "_";
        StringBuilder masked = new StringBuilder();
        List<String> originals = new ArrayList<>();
        int cursor = 0;
        for (Span span : spans(source)) {
            masked.append(source, cursor, span.start());
            masked.append(prefix).append(originals.size()).append("_END");
            originals.add(source.substring(span.start(), span.end()));
            cursor = span.end();
        }
        masked.append(source.substring(cursor));
        return new ProtectedText(masked.toString(), prefix, originals);
    }

    record ProtectedText(String masked, String prefix, List<String> originals) {
        boolean needsTranslation() {
            String prose = masked;
            for (int i = 0; i < originals.size(); i++) prose = prose.replace(token(i), "");
            return prose.codePoints().anyMatch(Character::isLetter)
                && prose.codePoints().anyMatch(c -> Character.isLetter(c) && Character.UnicodeScript.of(c) != Character.UnicodeScript.HAN);
        }

        private String token(int index) { return prefix + index + "_END"; }

        String restore(String translated) {
            // Reject missing, repeated, reordered or fabricated placeholders before exposing the result.
            int previous = -1;
            String checked = translated;
            for (int i = 0; i < originals.size(); i++) {
                String token = token(i);
                int position = translated.indexOf(token);
                if (position <= previous || position != translated.lastIndexOf(token)) {
                    throw new IllegalArgumentException("Invalid translation placeholders");
                }
                previous = position;
                checked = checked.replace(token, "");
            }
            if (checked.contains(prefix) || checked.contains("<think>")) {
                throw new IllegalArgumentException("Unexpected translation output");
            }
            String result = translated;
            for (int i = 0; i < originals.size(); i++) result = result.replace(token(i), originals.get(i));
            return result;
        }
    }
}
