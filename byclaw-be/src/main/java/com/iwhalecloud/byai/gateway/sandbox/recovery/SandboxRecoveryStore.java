package com.iwhalecloud.byai.gateway.sandbox.recovery;

import com.iwhaleai.byai.framework.common.Constants;
import com.iwhaleai.byai.framework.common.RedisClient;
import java.util.*;
import org.springframework.stereotype.Component;
import redis.clients.jedis.StreamEntryID;
import redis.clients.jedis.commands.JedisCommands;
import redis.clients.jedis.params.ScanParams;
import redis.clients.jedis.params.SetParams;
import redis.clients.jedis.params.XPendingParams;
import redis.clients.jedis.params.XAddParams;
import redis.clients.jedis.resps.ScanResult;
import redis.clients.jedis.Jedis;
import redis.clients.jedis.resps.StreamGroupInfo;
import redis.clients.jedis.resps.StreamPendingEntry;

/** Read-only discovery never consumes or claims a business message. */
@Component
public class SandboxRecoveryStore {
    private final RedisClient redis;
    public SandboxRecoveryStore(RedisClient redis) { this.redis = redis; }
    private <T> T execute(java.util.function.Function<JedisCommands, T> operation) {
        JedisCommands commands = redis.getCommands();
        try {
            return operation.apply(commands);
        } finally {
            // Standalone getCommands() borrows a pooled Jedis. The cluster client is shared.
            if (commands instanceof Jedis jedis) jedis.close();
        }
    }

    public record Queue(String stream, String group, String kind, long pending, Long waiting) {}
    public record QueuePage(List<Queue> items, String nextCursor) {}
    public record Message(String id, String consumer, long idleMs, long deliveries,
                          String state, Map<String, String> fields) {}
    public record MessagePage(List<Message> items, String nextCursor) {}

    public static String kind(String stream) {
        if (stream == null || stream.length() > 512) throw new IllegalArgumentException("缺少队列标识");
        if (stream.equals(Constants.QueueNames.controlPlaneManagementStream())) return "WAKEUP";
        if (stream.equals(Constants.QueueNames.controlPlanePendingQueue())) return "DELIVERY";
        if (stream.equals(Constants.QueueNames.controlPlaneDeadletterStream())) return "DEADLETTER";
        String agent = java.util.regex.Pattern.quote(Constants.QueueNames.ctrlStream("RECOVERYMARKER"))
            .replace("RECOVERYMARKER", "\\E(?:BYCLAW_(?:DSH|EXE|CODE)(?:_.+)?|HARNESS_.+)\\Q");
        String worker = java.util.regex.Pattern.quote(Constants.QueueNames.workerCtrlStream("RECOVERYMARKER"))
            .replace("RECOVERYMARKER", "\\E(?:byclaw-dsh-|openclaw-|byclaw-code-).+\\Q");
        if (stream.matches(agent) || stream.matches(worker)) return "COMMAND";
        throw new IllegalArgumentException("不是可管理的沙箱队列");
    }

    public List<Queue> queuesForStream(String stream) {
        kind(stream);
        if (!"stream".equals(execute(c -> c.type(stream)))) return List.of();
        return execute(c -> c.xinfoGroups(stream)).stream()
            .map(g -> new Queue(stream, g.getName(), "COMMAND", g.getPending(), null)).toList();
    }

    public QueuePage queues(String cursor) {
        // Bounded SCAN, with continuation across every cluster primary.
        var scan = scan(cursor);
        Set<String> streams = new LinkedHashSet<>(scan.getResult());
        if ("0".equals(cursor)) {
            streams.add(Constants.QueueNames.controlPlaneManagementStream());
            streams.add(Constants.QueueNames.controlPlanePendingQueue());
            streams.add(Constants.QueueNames.controlPlaneDeadletterStream());
        }
        List<Queue> result = new ArrayList<>();
        for (String stream : streams) {
            String type;
            try { type = kind(stream); } catch (IllegalArgumentException ignored) { continue; }
            if (!"stream".equals(execute(commands -> commands.type(stream)))) continue;
            List<StreamGroupInfo> groups = execute(commands -> commands.xinfoGroups(stream));
            if (groups.isEmpty() || "DEADLETTER".equals(type) || "DELIVERY".equals(type)) {
                long count = execute(commands -> commands.xlen(stream));
                if (count > 0) result.add(new Queue(stream, "", type, 0, count));
                continue;
            }
            for (var group : groups) {
                Object lag = group.getGroupInfo().get("lag");
                Long waiting = lag instanceof Number n ? n.longValue() : null;
                if (group.getPending() > 0 || waiting == null || waiting > 0)
                    result.add(new Queue(stream, group.getName(), type, group.getPending(), waiting));
            }
        }
        return new QueuePage(result, scan.getCursor());
    }

    private ScanResult<String> scan(String cursor) {
        var cluster = redis.getJedisCluster();
        var params = new ScanParams().match("*ctrl:*").count(200);
        if (cluster == null) {
            if (cursor == null || !cursor.matches("[0-9]{1,20}")) throw new IllegalArgumentException("无效查询游标");
            return execute(commands -> commands.scan(cursor, params));
        }
        var nodes = new TreeMap<>(cluster.getClusterNodes());
        if (nodes.isEmpty()) throw new IllegalStateException("Redis cluster nodes unavailable");
        String fingerprint = Integer.toHexString(nodes.keySet().hashCode());
        int index = 0;
        String position = "0";
        if (!"0".equals(cursor)) {
            if (cursor == null || !cursor.matches("[0-9]{1,5}:[0-9]{1,20}:[a-f0-9]{1,8}"))
                throw new IllegalArgumentException("无效集群查询游标");
            String[] parts = cursor.split(":");
            index = Integer.parseInt(parts[0]); position = parts[1];
            if (!parts[2].equals(fingerprint) || index >= nodes.size())
                throw new IllegalArgumentException("Redis 集群拓扑已变化，请重新刷新队列");
        }
        var pools = new ArrayList<>(nodes.values());
        try (var connection = pools.get(index).getResource()) {
            Jedis node = new Jedis(connection);
            Object role = node.role().getFirst();
            String roleName = role instanceof byte[] bytes ? new String(bytes, java.nio.charset.StandardCharsets.UTF_8)
                : String.valueOf(role);
            var page = "master".equals(roleName) ? node.scan(position, params) : new ScanResult<String>("0", List.of());
            int nextIndex = "0".equals(page.getCursor()) ? index + 1 : index;
            String next = nextIndex >= pools.size() ? "0" : nextIndex + ":" + page.getCursor() + ":" + fingerprint;
            return new ScanResult<>(next, page.getResult());
        }
    }

    public MessagePage messages(String stream, String group, String state, String after) {
        kind(stream);
        if (after != null && !after.isEmpty() && !after.matches("[0-9]+-[0-9]+"))
            throw new IllegalArgumentException("无效消息游标");
        List<Message> result = new ArrayList<>();
        if ("PENDING".equals(state)) {
            requireGroup(stream, group);
            var pending = execute(commands -> commands.xpending(stream, group,
                new XPendingParams(after == null || after.isEmpty() ? "-" : "(" + after, "+", 51)));
            for (var p : pending.subList(0, Math.min(50, pending.size()))) result.add(message(stream, p));
            return new MessagePage(result, pending.size() > 50 ? result.getLast().id() : null);
        }
        String start = after == null || after.isEmpty() ? "-" : "(" + after;
        if ("WAITING".equals(state)) {
            var info = requireGroup(stream, group);
            String delivered = info.getLastDeliveredId().toString();
            if (after == null || after.isEmpty() || new StreamEntryID(after).compareTo(info.getLastDeliveredId()) < 0)
                start = "(" + delivered;
        } else if (!"RECORD".equals(state) || (!group.isEmpty())) {
            throw new IllegalArgumentException("无效队列状态");
        }
        String rangeStart = start;
        var entries = execute(commands -> commands.xrange(stream, rangeStart, "+", 51));
        for (var e : entries.subList(0, Math.min(50, entries.size())))
            result.add(new Message(e.getID().toString(), null, 0, 0, state, e.getFields()));
        return new MessagePage(result, entries.size() > 50 ? result.getLast().id() : null);
    }

    private StreamGroupInfo requireGroup(String stream, String group) {
        return execute(commands -> commands.xinfoGroups(stream)).stream().filter(g -> g.getName().equals(group)).findFirst()
            .orElseThrow(() -> new IllegalArgumentException("消费组已不存在，请刷新"));
    }

    public Message pending(String stream, String group, String id) {
        kind(stream);
        if (id == null || !id.matches("[0-9]+-[0-9]+")) throw new IllegalArgumentException("无效消息 ID");
        requireGroup(stream, group);
        var items = execute(commands -> commands.xpending(stream, group, new XPendingParams(id, id, 1)));
        if (items.isEmpty()) throw new IllegalArgumentException("消息已被处理，请刷新列表");
        return message(stream, items.getFirst());
    }

    private Message message(String stream, StreamPendingEntry p) {
        var entries = execute(commands -> commands.xrange(stream, p.getID(), p.getID(), 1));
        return new Message(p.getID().toString(), p.getConsumerName(), p.getIdleTime(), p.getDeliveredTimes(),
            "PENDING", entries.isEmpty() ? Map.of() : entries.getFirst().getFields());
    }

    public boolean workerOnline(String worker) {
        return worker != null && execute(commands -> commands.exists(Constants.RegistryKeys.workerOnlineLease(worker)));
    }

    // Compare the current consumer/delivery generation atomically with ACK. A newly reclaimed
    // message must never be acknowledged by a stale administration page. Do not XDEL the payload.
    public boolean acknowledge(String stream, String group, Message expected) {
        Object result = execute(commands -> commands.eval("""
            local p = redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1)
            if #p == 0 then return 0 end
            if p[1][2] ~= ARGV[3] or tostring(p[1][4]) ~= ARGV[4] or p[1][3] < 60000 then return 0 end
            return redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
            """, List.of(stream), List.of(group, expected.id(), expected.consumer(), Long.toString(expected.deliveries()))));
        return result instanceof Number n && n.longValue() == 1;
    }

    private String auditKey(String stream, String group, String id) {
        return "byclaw:sandbox:recovery:audit:" + UUID.nameUUIDFromBytes(
            (stream + "\n" + group + "\n" + id).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    public Map<String, String> audit(String stream, String group, String id) {
        return execute(commands -> commands.hgetAll(auditKey(stream, group, id)));
    }
    public void audit(String stream, String group, String id, Map<String, String> values) {
        String key = auditKey(stream, group, id);
        Map<String, String> latest = new LinkedHashMap<>(values);
        latest.putIfAbsent("error", "");
        execute(commands -> commands.hset(key, latest));
        execute(commands -> commands.expire(key, 30 * 24 * 3600));
        Map<String, String> event = new LinkedHashMap<>(values);
        event.put("messageId", id);
        event.put("stream", stream);
        event.put("group", group);
        execute(commands -> commands.xadd("byclaw:sandbox:recovery:history", new XAddParams().maxLen(10000).approximateTrimming(), event));
    }
    public List<Map<String, String>> history() {
        return execute(commands -> commands.xrevrange("byclaw:sandbox:recovery:history", "+", "-", 100)).stream()
            .map(e -> { Map<String, String> value = new LinkedHashMap<>(e.getFields());
                value.put("eventId", e.getID().toString()); return value; }).toList();
    }
    public boolean lock(String identity, String token) {
        return "OK".equals(execute(commands -> commands.set("byclaw:sandbox:recovery:lock:" + identity, token,
            new SetParams().nx().ex(300))));
    }
    public void unlock(String identity, String token) {
        execute(commands -> commands.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
            List.of("byclaw:sandbox:recovery:lock:" + identity), List.of(token)));
    }
    public void trackRecovery(String key, Map<String, String> event) {
        execute(c -> c.set("byclaw:sandbox:recovery:tracking:" + key,
            com.alibaba.fastjson.JSON.toJSONString(event), new SetParams().ex(7200)));
        execute(c -> c.zadd("byclaw:sandbox:recovery:tracking-index", System.currentTimeMillis(), key));
    }
    public Map<String, Map<String, String>> trackedRecoveries() {
        Map<String, Map<String, String>> result = new LinkedHashMap<>();
        var keys = execute(c -> c.zrange("byclaw:sandbox:recovery:tracking-index", 0, 199));
        for (String key : keys) {
            String json = execute(c -> c.get("byclaw:sandbox:recovery:tracking:" + key));
            if (json == null) { stopTracking(key); continue; }
            Map<String, String> value = new LinkedHashMap<>();
            com.alibaba.fastjson.JSON.parseObject(json).forEach((k, v) -> value.put(k, String.valueOf(v)));
            result.put(key, value);
        }
        return result;
    }
    public void stopTracking(String key) {
        execute(c -> c.del("byclaw:sandbox:recovery:tracking:" + key));
        execute(c -> c.zrem("byclaw:sandbox:recovery:tracking-index", key));
    }

}
