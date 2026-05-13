package com.iwhalecloud.byai.state.common.filter.request;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

import org.springframework.util.StreamUtils;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;

public class RequestWrapper extends HttpServletRequestWrapper {
    private final byte[] body;

    public RequestWrapper(HttpServletRequest request) throws IOException {
        super(request);
        // body = getBody(request);
        body = StreamUtils.copyToByteArray(request.getInputStream());
    }

    // 重写读取，从存储的字节数组中读
    @Override
    public BufferedReader getReader() throws IOException {
        return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
    }

    @Override
    public ServletInputStream getInputStream() throws IOException {
        final ByteArrayInputStream bais = new ByteArrayInputStream(body);

        return new ServletInputStream() {
            @Override
            public boolean isFinished() {
                return false;
            }

            @Override
            public boolean isReady() {
                return false;
            }

            @Override
            public void setReadListener(ReadListener readListener) {
            }

            @Override
            public int read() throws IOException {
                return bais.read();
            }
        };
    }

    // private byte[] getBody(HttpServletRequest request) throws IOException {
    // InputStream inputStream = request.getInputStream();
    // byte[] buffer = new byte[513]; // 513 to check for more than 512 bytes
    // int bytesRead = -1;
    // ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream();
    //
    // while ((bytesRead = inputStream.read(buffer)) != -1) {
    // byteArrayOutputStream.write(buffer, 0, bytesRead);
    // if (byteArrayOutputStream.size() > 512) { // stop reading after 512 bytes
    // break;
    // }
    // }
    //
    // return byteArrayOutputStream.toByteArray();
    // }
}
