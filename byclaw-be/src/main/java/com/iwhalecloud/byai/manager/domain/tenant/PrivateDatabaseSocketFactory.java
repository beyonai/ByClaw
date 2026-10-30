package com.iwhalecloud.byai.manager.domain.tenant;

import java.io.*;
import java.net.*;
import java.net.http.*;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Arrays;
import java.util.Properties;
import java.util.concurrent.*;
import javax.net.SocketFactory;

/** PostgreSQL socket over authenticated private MicroVM ingress; no public fallback. */
public final class PrivateDatabaseSocketFactory extends SocketFactory {
    private static final HttpClient CLIENT = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();
    private final Properties properties;
    public PrivateDatabaseSocketFactory(Properties properties) { this.properties = properties; }

    public static URI privateUrl(String value) {
        URI uri = URI.create(value);
        if (!"wss".equals(uri.getScheme()) || uri.getHost() == null
            || !uri.getHost().matches("15432-[a-z0-9-]+\\.[a-z0-9-]+-vpc\\.sandbox\\.aliyuncs\\.com")
            || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
            || (uri.getPort() != -1 && uri.getPort() != 443) || !"/postgresql".equals(uri.getPath())) {
            throw new IllegalArgumentException("Invalid private database transport");
        }
        return uri;
    }

    @Override public Socket createSocket() { return new TunnelSocket(privateUrl(properties.getProperty("byclawDatabaseUrl")), properties.getProperty("byclawDatabaseToken")); }
    @Override public Socket createSocket(String host, int port) throws IOException { Socket s=createSocket();s.connect(new InetSocketAddress(host,port));return s; }
    @Override public Socket createSocket(InetAddress host, int port) throws IOException { return createSocket(host.getHostAddress(),port); }
    @Override public Socket createSocket(String host, int port, InetAddress local, int localPort) throws IOException { return createSocket(host,port); }
    @Override public Socket createSocket(InetAddress host, int port, InetAddress local, int localPort) throws IOException { return createSocket(host,port); }

    static final class TunnelSocket extends Socket {
        private static final byte[] END = new byte[0];
        private final URI uri;
        private final String token;
        private final BlockingQueue<byte[]> incoming = new ArrayBlockingQueue<>(2);
        private volatile boolean closed;
        private volatile boolean ended;
        private volatile IOException failure;
        private volatile int timeout;
        private WebSocket webSocket;
        private final InputStream input = new InputStream() {
            private byte[] chunk = new byte[0];
            private int position;
            @Override public int read() throws IOException { byte[] b=new byte[1];return read(b,0,1)<0?-1:b[0]&255; }
            @Override public int read(byte[] b,int off,int len) throws IOException {
                java.util.Objects.checkFromIndexSize(off,len,b.length);
                if(len==0)return 0;
                while(position==chunk.length) {
                    if(failure!=null)throw failure;
                    if((closed || ended) && incoming.isEmpty())return -1;
                    try {
                        byte[] next=incoming.poll(timeout==0?1000:timeout,TimeUnit.MILLISECONDS);
                        if(next==null) { if(timeout>0)throw new SocketTimeoutException("Private database read timed out");continue; }
                        if(next==END) {
                            if(failure!=null)throw failure;
                            return -1;
                        }
                        chunk=next;position=0;
                        if(webSocket!=null)webSocket.request(1);
                    } catch(InterruptedException e) {Thread.currentThread().interrupt();throw new IOException("Private database read interrupted");}
                }
                int n=Math.min(len,chunk.length-position);System.arraycopy(chunk,position,b,off,n);position+=n;return n;
            }
        };
        private final OutputStream output = new OutputStream() {
            @Override public void write(int b) throws IOException {write(new byte[]{(byte)b},0,1);}
            @Override public synchronized void write(byte[] b,int off,int len) throws IOException {
                if(closed || webSocket==null)throw new IOException("Private database transport is closed");
                try {
                    for(int position=off;position<off+len;) {
                        int end=Math.min(off+len,position+65536);
                        webSocket.sendBinary(ByteBuffer.wrap(Arrays.copyOfRange(b,position,end)),true).get(10,TimeUnit.SECONDS);
                        position=end;
                    }
                }
                catch(Exception e){throw new IOException("Private database write failed");}
            }
        };
        TunnelSocket(URI uri,String token) {this.uri=uri;this.token=token;}
        @Override public void connect(SocketAddress ignored) throws IOException {connect(ignored,5000);}
        @Override public synchronized void connect(SocketAddress ignored,int milliseconds) throws IOException {
            if(webSocket!=null || closed || token==null || token.isBlank())throw new IOException("Invalid private database connection");
            try {
                webSocket=CLIENT.newWebSocketBuilder()
                    .connectTimeout(Duration.ofMillis(milliseconds<=0?5000:milliseconds))
                    .header("e2b-traffic-access-token",token).buildAsync(uri,new WebSocket.Listener() {
                        @Override public void onOpen(WebSocket ws){ws.request(1);}
                        @Override public CompletionStage<?> onBinary(WebSocket ws,ByteBuffer data,boolean last) {
                            byte[] bytes=new byte[data.remaining()];data.get(bytes);
                            if(!incoming.offer(bytes)) {failure=new IOException("Private database receive buffer exceeded");ws.abort();}
                            return null;
                        }
                        @Override public CompletionStage<?> onClose(WebSocket ws,int code,String reason){ended=true;incoming.offer(END);return null;}
                        @Override public void onError(WebSocket ws,Throwable error){failure=new IOException("Private database transport failed");ended=true;incoming.clear();incoming.offer(END);}
                    }).get(10,TimeUnit.SECONDS);
            } catch(Exception e){closed=true;throw new IOException("Private database handshake failed");}
        }
        @Override public InputStream getInputStream(){return input;}
        @Override public OutputStream getOutputStream(){return output;}
        @Override public void setSoTimeout(int value){timeout=value;}
        @Override public int getSoTimeout(){return timeout;}
        @Override public int getSendBufferSize(){return 65536;}
        @Override public int getReceiveBufferSize(){return 65536;}
        @Override public void setSendBufferSize(int value) { }
        @Override public void setReceiveBufferSize(int value) { }
        @Override public void setTcpNoDelay(boolean value) { }
        @Override public void setKeepAlive(boolean value) { }
        @Override public boolean isConnected(){return webSocket!=null && !closed;}
        @Override public boolean isClosed(){return closed;}
        @Override public synchronized void close(){closed=true;incoming.clear();incoming.offer(END);if(webSocket!=null)webSocket.abort();}
    }
}
