package com.iwhalecloud.byai.gateway.sandbox.client;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Recovery must prove complete enumeration independently of the legacy best-effort list path. */
class OpenSandboxRecoveryInventoryTest {
    @Test void disabledQueryCannotReportAbsence() {
        var properties=new SandboxProperties();properties.getOpensandbox().setListSandboxesBeforeCreate(false);
        assertEquals("PROVIDER_QUERY_DISABLED",assertThrows(OpenSandboxClient.OpenSandboxException.class,
            ()->new OpenSandboxClient(properties).recoveryInventory(Map.of("enterpriseId","7"))).getMessage());
    }
    @Test void enumeratesAllPagesAndRejectsMissingPagination() throws Exception {
        var count=new AtomicInteger();var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/sandboxes",exchange->{
            int page=count.incrementAndGet();
            String body=page<=2 ? "{\"items\":[{\"id\":\"id-"+page+"\"}],\"pagination\":{\"page\":"+page+",\"totalItems\":2,\"hasNextPage\":"+(page==1)+"}}" : "[]";
            byte[] bytes=body.getBytes(StandardCharsets.UTF_8);exchange.sendResponseHeaders(200,bytes.length);
            try(var output=exchange.getResponseBody()){output.write(bytes);}
        });server.start();
        try {
            var properties=new SandboxProperties();properties.getOpensandbox().setBaseUrl("http://127.0.0.1:"+server.getAddress().getPort());
            var client=new OpenSandboxClient(properties);
            assertEquals(2,client.recoveryInventory(Map.of("enterpriseId","7")).size());assertEquals(2,count.get());
            assertEquals("PROVIDER_QUERY_INCOMPLETE",assertThrows(OpenSandboxClient.OpenSandboxException.class,
                ()->client.recoveryInventory(Map.of("enterpriseId","7"))).getMessage());
        } finally {server.stop(0);}
    }
    @Test void truncatedAndRepeatedPagesNeverAuthorizeZeroResources() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/v1/sandboxes",exchange->{
            byte[] bytes="{\"items\":[],\"pagination\":{\"totalItems\":1,\"hasNextPage\":false}}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200,bytes.length);try(var output=exchange.getResponseBody()){output.write(bytes);}
        });server.start();
        try {
            var properties=new SandboxProperties();properties.getOpensandbox().setBaseUrl("http://127.0.0.1:"+server.getAddress().getPort());
            assertEquals("PROVIDER_QUERY_INCOMPLETE",assertThrows(OpenSandboxClient.OpenSandboxException.class,
                ()->new OpenSandboxClient(properties).recoveryInventory(Map.of("enterpriseId","7"))).getMessage());
        } finally {server.stop(0);}
    }
}
