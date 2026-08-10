package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;

/** Immutable, validated command templates parsed from a connector Runtime Manifest. */
public final class ManifestCommandCatalog {

    private static final Pattern PLACEHOLDER = Pattern.compile("^\\$\\{([A-Za-z][A-Za-z0-9]*)}$");

    private final Map<String, List<List<String>>> commands;
    private final String digest;
    private final Map<String, PlaceholderPolicy> placeholderPolicies;

    public ManifestCommandCatalog(
            Map<String, List<List<String>>> commands,
            String digest,
            Map<String, PlaceholderPolicy> placeholderPolicies) {
        this.commands = immutableCommands(commands);
        this.digest = Objects.requireNonNull(digest, "digest");
        this.placeholderPolicies = Map.copyOf(placeholderPolicies == null ? Map.of() : placeholderPolicies);
        validateTemplatePlaceholders();
    }

    public List<String> command(String action, int index) {
        return command(action, index, Map.of());
    }

    public List<String> command(String action, int index, Map<String, String> values) {
        List<String> template = template(action, index);
        Map<String, String> safeValues = values == null ? Map.of() : Map.copyOf(values);
        Set<String> expected = placeholders(template);
        for (String supplied : safeValues.keySet()) {
            if (!expected.contains(supplied)) {
                throw invalid("Unknown command placeholder value: " + supplied);
            }
        }
        List<String> resolved = new ArrayList<>(template.size());
        for (String argument : template) {
            Matcher matcher = PLACEHOLDER.matcher(argument);
            if (!matcher.matches()) {
                resolved.add(argument);
                continue;
            }
            String name = matcher.group(1);
            String value = safeValues.get(name);
            if (value == null) {
                throw invalid("Missing command placeholder value: " + name);
            }
            PlaceholderPolicy policy = placeholderPolicies.get(name);
            if (policy == null || !policy.isValid(value)) {
                throw invalid("Invalid command placeholder value: " + name);
            }
            resolved.add(value);
        }
        return List.copyOf(resolved);
    }

    public int size(String action) {
        List<List<String>> group = commands.get(action);
        if (group == null) {
            throw invalid("Manifest command action is missing: " + action);
        }
        return group.size();
    }

    public String digest() {
        return digest;
    }

    private List<String> template(String action, int index) {
        List<List<String>> group = commands.get(action);
        if (group == null) {
            throw invalid("Manifest command action is missing: " + action);
        }
        if (index < 0 || index >= group.size()) {
            throw invalid("Manifest command is missing: " + action + "[" + index + "]");
        }
        return group.get(index);
    }

    private Map<String, List<List<String>>> immutableCommands(Map<String, List<List<String>>> source) {
        if (source == null || source.isEmpty()) {
            throw invalid("Manifest commands must not be empty");
        }
        Map<String, List<List<String>>> copy = new LinkedHashMap<>();
        source.forEach((action, group) -> {
            if (action == null || action.isBlank() || group == null || group.isEmpty()) {
                throw invalid("Manifest command group is invalid");
            }
            List<List<String>> groupCopy = new ArrayList<>();
            for (List<String> argv : group) {
                if (argv == null || argv.isEmpty()) {
                    throw invalid("Manifest command argv is invalid: " + action);
                }
                groupCopy.add(List.copyOf(argv));
            }
            copy.put(action, List.copyOf(groupCopy));
        });
        return Map.copyOf(copy);
    }

    private void validateTemplatePlaceholders() {
        commands.forEach((action, group) -> group.forEach(argv -> argv.forEach(argument -> {
            boolean containsMarker = argument.contains("${");
            Matcher matcher = PLACEHOLDER.matcher(argument);
            if (containsMarker && !matcher.matches()) {
                throw invalid("Command placeholder must occupy a whole argv element: " + action);
            }
            if (matcher.matches() && !placeholderPolicies.containsKey(matcher.group(1))) {
                throw invalid("Unknown command placeholder: " + matcher.group(1));
            }
        })));
    }

    private Set<String> placeholders(List<String> argv) {
        Set<String> names = new LinkedHashSet<>();
        for (String argument : argv) {
            Matcher matcher = PLACEHOLDER.matcher(argument);
            if (matcher.matches()) {
                names.add(matcher.group(1));
            }
        }
        return names;
    }

    private InvalidConnectorManifestException invalid(String message) {
        return new InvalidConnectorManifestException(message);
    }

    @FunctionalInterface
    public interface PlaceholderPolicy {

        boolean isValid(String value);

        static PlaceholderPolicy safeValue(int maxLength) {
            if (maxLength <= 0) {
                throw new IllegalArgumentException("maxLength must be positive");
            }
            return value -> value != null
                && !value.isBlank()
                && value.length() <= maxLength
                && value.codePoints().noneMatch(Character::isISOControl)
                && value.indexOf('\0') < 0;
        }
    }
}
