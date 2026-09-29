package com.iwhalecloud.byai.state.domain.linkpreview.application;

import com.google.common.net.InetAddresses;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import okhttp3.Dns;
import okhttp3.HttpUrl;

/** Applied both to each redirect URL and to the actual addresses used by OkHttp. */
final class PublicUrlPolicy {
    // Native DNS can outlive an interrupted lookup. Bound both threads and queued work.
    private static final ThreadPoolExecutor DNS_POOL = new ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS,
        new ArrayBlockingQueue<>(8), task -> {
            Thread thread = new Thread(task, "link-preview-dns");
            thread.setDaemon(true);
            return thread;
        });
    private PublicUrlPolicy() {}

    static HttpUrl parse(String input) {
        if (input == null || input.length() > 4096) throw new IllegalArgumentException("Invalid preview URL");
        HttpUrl url = HttpUrl.parse(input);
        if (url == null || !url.username().isEmpty() || !url.password().isEmpty()) {
            throw new IllegalArgumentException("Invalid preview URL");
        }
        String host = url.host();
        if (InetAddresses.isInetAddress(host)) {
            if (!isPublic(InetAddresses.forString(host))) throw new IllegalArgumentException("Non-public preview URL");
        } else if (!host.contains(".") || host.endsWith(".localhost") || host.endsWith(".local")
            || host.matches("[0-9.]+")) {
            throw new IllegalArgumentException("Non-public preview URL");
        }
        return url.newBuilder().fragment(null).build();
    }

    static Dns guardedDns(Dns delegate) {
        return hostname -> {
            Future<List<InetAddress>> lookup = null;
            try {
                lookup = DNS_POOL.submit(() -> delegate.lookup(hostname));
                List<InetAddress> addresses = lookup.get(2, TimeUnit.SECONDS);
                if (addresses.isEmpty() || addresses.stream().anyMatch(address -> !isPublic(address))) {
                    throw new UnknownHostException("Non-public preview destination");
                }
                // These exact addresses are used for the connection; no second DNS lookup.
                return addresses;
            } catch (Exception failure) {
                if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
                throw new UnknownHostException("Preview destination unavailable");
            } finally {
                if (lookup != null && !lookup.isDone()) lookup.cancel(true);
            }
        };
    }

    static boolean isPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
            || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] bytes = address.getAddress();
        int a = bytes[0] & 255;
        int b = bytes[1] & 255;
        if (bytes.length == 4) {
            int c = bytes[2] & 255;
            return !(a == 0 || a == 10 || a == 127 || a >= 224
                || (a == 100 && b >= 64 && b <= 127)
                || (a == 169 && b == 254) || (a == 172 && b >= 16 && b <= 31)
                || (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2))))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113));
        }
        // Global IPv6 only; exclude transition/special-purpose and documentation ranges.
        return (a & 0xe0) == 0x20 && !(a == 0x20 && b == 0x02)
            && !(a == 0x20 && b == 0x01 && ((bytes[2] & 255) < 2
                || ((bytes[2] & 255) == 0x0d && (bytes[3] & 255) == 0xb8)));
    }
}
