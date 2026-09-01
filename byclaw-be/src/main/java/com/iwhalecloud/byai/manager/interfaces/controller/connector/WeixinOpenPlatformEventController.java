package com.iwhalecloud.byai.manager.interfaces.controller.connector;

import java.io.IOException;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen.WeixinOpenPlatformEventService;

@RestController
@RequestMapping("/connector/authorization/callback/weixin-open-platform/events")
public class WeixinOpenPlatformEventController {
    private static final int MAX_REQUEST_BYTES = 128 * 1024;
    private final WeixinOpenPlatformEventService eventService;

    public WeixinOpenPlatformEventController(WeixinOpenPlatformEventService eventService) {
        this.eventService = eventService;
    }

    @PostMapping(produces = MediaType.TEXT_PLAIN_VALUE)
    public ResponseEntity<String> receive(
            @RequestParam("msg_signature") String signature,
            @RequestParam("timestamp") String timestamp,
            @RequestParam("nonce") String nonce,
            HttpServletRequest request) {
        try {
            String requestBody = readBounded(request);
            String response = eventService.handle(signature, timestamp, nonce, requestBody);
            return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("text/plain;charset=UTF-8"))
                .cacheControl(CacheControl.noStore())
                .body(response);
        } catch (RuntimeException | IOException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid Weixin callback");
        }
    }

    private String readBounded(HttpServletRequest request) throws IOException {
        long contentLength = request.getContentLengthLong();
        if (contentLength > MAX_REQUEST_BYTES) {
            throw new IllegalArgumentException();
        }
        byte[] bytes = request.getInputStream().readNBytes(MAX_REQUEST_BYTES + 1);
        if (bytes.length == 0 || bytes.length > MAX_REQUEST_BYTES) {
            throw new IllegalArgumentException();
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(java.nio.ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            throw new IllegalArgumentException();
        }
    }
}
