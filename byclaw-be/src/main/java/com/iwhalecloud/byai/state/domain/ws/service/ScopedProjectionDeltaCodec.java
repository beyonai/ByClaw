package com.iwhalecloud.byai.state.domain.ws.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;

/** Builds bounded patches for a scoped child message projection. */
final class ScopedProjectionDeltaCodec {

    static final String DELTA_TYPE = "SCOPED_MESSAGE_DELTA";
    private static final int MAX_JSON_PATCH_DEPTH = 24;
    private static final int MAX_JSON_PATCH_OPERATIONS = 256;

    JSONObject createDelta(JSONObject previousEnvelope, JSONObject currentEnvelope, boolean terminal) {
        JSONObject previous = previousEnvelope == null ? null : previousEnvelope.getJSONObject("data");
        JSONObject current = currentEnvelope == null ? null : currentEnvelope.getJSONObject("data");
        if (!sameProjection(previous, current)) {
            return null;
        }

        JSONArray operations = new JSONArray();
        Set<String> fields = new LinkedHashSet<>(previous.keySet());
        fields.addAll(current.keySet());
        for (String field : fields) {
            boolean currentContains = current.containsKey(field);
            if (!currentContains) {
                operations.add(operation(field, "remove"));
                continue;
            }
            Object before = previous.get(field);
            Object after = current.get(field);
            if (Objects.equals(before, after)) {
                continue;
            }
            JSONObject operation = stringOperation(field, before, after);
            if (operation == null) {
                operation = operation(field, "set");
                operation.put("value", after);
            }
            operations.add(operation);
        }

        JSONObject payload = new JSONObject();
        payload.put("baseStreamId", previousEnvelope.getString("streamId"));
        payload.put("streamId", currentEnvelope.getString("streamId"));
        payload.put("sessionId", current.getString("sessionId"));
        payload.put("messageId", current.getString("messageId"));
        payload.put("terminal", terminal);
        payload.put("operations", operations);

        JSONObject delta = new JSONObject();
        delta.put("type", DELTA_TYPE);
        delta.put("sessionId", currentEnvelope.getString("sessionId"));
        delta.put("streamId", currentEnvelope.getString("streamId"));
        delta.put("data", payload);
        return delta;
    }

    private boolean sameProjection(JSONObject previous, JSONObject current) {
        if (previous == null || current == null) {
            return false;
        }
        return Objects.equals(previous.getString("sessionId"), current.getString("sessionId"))
            && Objects.equals(previous.getString("messageId"), current.getString("messageId"));
    }

    private JSONObject stringOperation(String field, Object before, Object after) {
        if (!(before instanceof String previous) || !(after instanceof String current)) {
            return null;
        }
        Object previousJson = parseJsonContainer(previous);
        Object currentJson = parseJsonContainer(current);
        if (previousJson != null && currentJson != null && previousJson.getClass().equals(currentJson.getClass())) {
            JSONObject nested = jsonPatchOperation(field, previousJson, currentJson);
            JSONObject splice = null;
            if (previousJson instanceof JSONArray previousArray && currentJson instanceof JSONArray currentArray) {
                int common = commonPrefix(previousArray, currentArray);
                splice = operation(field, "json-array-splice");
                splice.put("index", common);
                splice.put("deleteCount", previousArray.size() - common);
                splice.put("value", new JSONArray(currentArray.subList(common, currentArray.size())));
            }
            return smaller(nested, splice);
        }
        if (current.startsWith(previous)) {
            JSONObject operation = operation(field, "append");
            operation.put("offset", previous.length());
            operation.put("value", current.substring(previous.length()));
            return operation;
        }
        return null;
    }

    private Object parseJsonContainer(String value) {
        if (value == null) {
            return null;
        }
        String leading = value.stripLeading();
        if (!leading.startsWith("[") && !leading.startsWith("{")) {
            return null;
        }
        try {
            Object parsed = JSON.parse(value);
            return parsed instanceof JSONArray || parsed instanceof JSONObject ? parsed : null;
        }
        catch (RuntimeException ignored) {
            return null;
        }
    }

    private JSONObject jsonPatchOperation(String field, Object previous, Object current) {
        JSONArray patches = new JSONArray();
        PatchBudget budget = new PatchBudget();
        if (!diffJson(previous, current, new ArrayList<>(), patches, budget, 0) || patches.isEmpty()) {
            return null;
        }
        JSONObject operation = operation(field, "json-patch");
        operation.put("patches", patches);
        return operation;
    }

    private boolean diffJson(Object previous, Object current, List<Object> path, JSONArray patches,
                             PatchBudget budget, int depth) {
        if (Objects.equals(previous, current)) {
            return true;
        }
        if (depth > MAX_JSON_PATCH_DEPTH) {
            return false;
        }
        if (previous instanceof String before && current instanceof String after && after.startsWith(before)) {
            JSONObject patch = jsonPatch("append", path);
            patch.put("offset", before.length());
            patch.put("value", after.substring(before.length()));
            return addPatch(patches, patch, budget);
        }
        if (previous instanceof JSONObject before && current instanceof JSONObject after) {
            Set<String> keys = new LinkedHashSet<>(before.keySet());
            keys.addAll(after.keySet());
            for (String key : keys) {
                path.add(key);
                boolean ok;
                if (!after.containsKey(key)) {
                    ok = addPatch(patches, jsonPatch("remove", path), budget);
                }
                else if (!before.containsKey(key)) {
                    JSONObject patch = jsonPatch("set", path);
                    patch.put("value", after.get(key));
                    ok = addPatch(patches, patch, budget);
                }
                else {
                    ok = diffJson(before.get(key), after.get(key), path, patches, budget, depth + 1);
                }
                path.remove(path.size() - 1);
                if (!ok) {
                    return false;
                }
            }
            return true;
        }
        if (previous instanceof JSONArray before && current instanceof JSONArray after) {
            if (before.size() == after.size()) {
                for (int index = 0; index < before.size(); index++) {
                    path.add(index);
                    boolean ok = diffJson(before.get(index), after.get(index), path, patches, budget, depth + 1);
                    path.remove(path.size() - 1);
                    if (!ok) {
                        return false;
                    }
                }
                return true;
            }
            int prefix = commonPrefix(before, after);
            int suffix = commonSuffix(before, after, prefix);
            JSONObject patch = jsonPatch("splice", path);
            patch.put("index", prefix);
            patch.put("deleteCount", before.size() - prefix - suffix);
            patch.put("value", new JSONArray(after.subList(prefix, after.size() - suffix)));
            return addPatch(patches, patch, budget);
        }
        JSONObject patch = jsonPatch("set", path);
        patch.put("value", current);
        return addPatch(patches, patch, budget);
    }

    private boolean addPatch(JSONArray patches, JSONObject patch, PatchBudget budget) {
        if (++budget.count > MAX_JSON_PATCH_OPERATIONS) {
            return false;
        }
        patches.add(patch);
        return true;
    }

    private JSONObject jsonPatch(String type, List<Object> path) {
        JSONObject patch = new JSONObject();
        patch.put("op", type);
        JSONArray pathSnapshot = new JSONArray(path.size());
        pathSnapshot.addAll(path);
        patch.put("path", pathSnapshot);
        return patch;
    }

    private JSONObject smaller(JSONObject first, JSONObject second) {
        if (first == null) {
            return second;
        }
        if (second == null) {
            return first;
        }
        return first.toJSONString().length() <= second.toJSONString().length() ? first : second;
    }

    private int commonPrefix(JSONArray previous, JSONArray current) {
        int limit = Math.min(previous.size(), current.size());
        int index = 0;
        while (index < limit && Objects.equals(previous.get(index), current.get(index))) {
            index++;
        }
        return index;
    }

    private int commonSuffix(JSONArray previous, JSONArray current, int prefix) {
        int previousIndex = previous.size() - 1;
        int currentIndex = current.size() - 1;
        int suffix = 0;
        while (previousIndex >= prefix && currentIndex >= prefix
            && Objects.equals(previous.get(previousIndex), current.get(currentIndex))) {
            previousIndex--;
            currentIndex--;
            suffix++;
        }
        return suffix;
    }

    private JSONObject operation(String field, String type) {
        JSONObject operation = new JSONObject();
        operation.put("field", field);
        operation.put("op", type);
        return operation;
    }

    private static final class PatchBudget {
        private int count;
    }
}
