package com.iwhalecloud.byai.manager.application.service.login;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jws;
import io.jsonwebtoken.Jwts;
import lombok.Data;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPoint;
import java.security.spec.ECPublicKeySpec;
import java.security.spec.EllipticCurve;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * @description 苹果登录服务
 * 处理苹果Sign In with Apple的JWT验证和用户信息提取
 */
@Service
public class AppleLoginService {

    private static final Logger logger = LoggerFactory.getLogger(AppleLoginService.class);

    /**
     * 苹果公钥URL，用于获取苹果的公钥
     */
    private static final String APPLE_PUBLIC_KEYS_URL = "https://appleid.apple.com/auth/keys";

    /**
     * 苹果绑定Token的Redis前缀
     */
    private static final String APPLE_BIND_TOKEN_PREFIX = "apple:bind:token:";

    /**
     * 苹果绑定Token的过期时间（秒）
     */
    private static final int APPLE_BIND_TOKEN_EXPIRE_SECONDS = 600;

    /**
     * APP端的clientId
     *  testClientId = "com.iwhalecloud.byai";
     *  proClientId = "com.iwhalecloud.jzby";
     */
    @Value("${apple.client-id:com.iwhalecloud.byai;com.iwhalecloud.jzby}")
    private String clientId;

    @Value("${apple.team-id:T5CG98P673}")
    private String teamId;

    @Value("${apple.key-id:6R52AF9R6R}")
    private String keyId;

    @Autowired
    private UserService userService;

    @Autowired
    private UserApplicationService userApplicationService;

    /**
     * 验证苹果identity token
     *
     * @param identityToken 苹果identity token
     * @return 验证成功返回用户信息，失败抛出异常
     */
    public AppleUserInfo verifyIdentityToken(String identityToken) {
        if (StringUtil.isEmpty(identityToken)) {
            throw new BaseException("苹果identity token不能为空");
        }

        try {
            // 解析JWT头部，获取kid（key id）
            String[] parts = identityToken.split("\\.");
            if (parts.length != 3) {
                throw new BaseException("无效的苹果identity token格式");
            }

            // 解码头部
            String headerJson = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            Map<String, Object> header = JSON.parseObject(headerJson, Map.class);
            String kid = (String) header.get("kid");

            if (StringUtil.isEmpty(kid)) {
                throw new BaseException("苹果identity token缺少key id");
            }

            // 获取苹果公钥
            PublicKey publicKey = getApplePublicKey(kid);
            if (publicKey == null) {
                throw new BaseException("无法获取苹果公钥");
            }

            // 验证JWT
            Jws<Claims> jws = Jwts.parserBuilder()
                .setSigningKey(publicKey)
                .build()
                .parseClaimsJws(identityToken);

            Claims claims = jws.getBody();

            // 验证发行者
            String issuer = claims.getIssuer();
            if (!"https://appleid.apple.com".equals(issuer)) {
                throw new BaseException("无效的token发行者: " + issuer);
            }

            // 验证受众
            // 从claims中获取受众标识
            String audience = claims.getAudience();
            // 按分号拆分客户端ID数组
            String[] clientIds = clientId.split(";");

            // 1. 先判断audience非空，避免空指针（根据业务场景，可选择是否保留此判断）
            if (audience == null || audience.trim().isEmpty()) {
                throw new IllegalArgumentException("受众标识audience不能为空");
            }
            // 2. 校验audience是否匹配clientIds中的任意一个值
            boolean isMatch = false;
            for (String clientId : clientIds) {
                // 去除clientId的首尾空格（避免拆分后有空格导致匹配失败，如"client1 ; client2"）
                String validClientId = clientId.trim();
                if (audience.equals(validClientId)) {
                    isMatch = true;
                    break; // 匹配到则直接退出循环，无需继续遍历
                }
            }
            // 3. 无匹配则抛出异常（推荐用业务自定义异常，也可使用IllegalArgumentException）
            if (!isMatch) {
                throw new RuntimeException(
                        String.format("受众标识audience[%s]未匹配到合法的客户端ID，合法ID：%s",
                                audience, String.join(";", clientIds))
                );
            }

            // 验证主题
            String subject = claims.getSubject();
            if (StringUtil.isEmpty(subject)) {
                throw new BaseException("苹果identity token缺少用户标识");
            }

            // 提取用户信息
            String email = claims.get("email", String.class);
            Boolean emailVerified = claims.get("email_verified", Boolean.class);
            Long authTime = claims.get("auth_time", Long.class);
            Integer realUserStatus = claims.get("real_user_status", Integer.class);

            // 构建用户信息
            AppleUserInfo userInfo = new AppleUserInfo();
            userInfo.setUserId(subject);
            userInfo.setEmail(email);
            userInfo.setEmailVerified(emailVerified != null ? emailVerified : false);
            userInfo.setAuthTime(authTime);
            userInfo.setRealUserStatus(realUserStatus);

            logger.info("苹果登录用户信息验证成功: userId={}, email={}", userInfo.getUserId(), userInfo.getEmail());

            return userInfo;

        } catch (Exception e) {
            logger.error("苹果identity token验证失败", e);
            throw new BaseException("苹果identity token验证失败: " + e.getMessage(), e);
        }
    }

    /**
     * 根据苹果用户ID查找用户
     * 仅通过苹果用户ID查找已绑定的用户，不自动创建用户
     *
     * @param appleUserInfo 苹果用户信息
     * @return 用户信息，如果未找到返回null
     */
    public Users findUserByAppleId(AppleUserInfo appleUserInfo) {
        if (appleUserInfo == null || StringUtil.isEmpty(appleUserInfo.getUserId())) {
            return null;
        }

        logger.info("根据苹果用户ID查找用户: appleUserId={}, email={}", 
            appleUserInfo.getUserId(), appleUserInfo.getEmail());

        // 根据苹果用户ID查找用户
        Users existingUser = userService.findByAppleUserId(appleUserInfo.getUserId());
        if (existingUser != null) {
            logger.info("找到已绑定苹果账号的用户: userId={}, appleUserId={}", 
                existingUser.getUserId(), appleUserInfo.getUserId());
            return existingUser;
        }

        logger.info("未找到与苹果账号绑定的用户: appleUserId={}", appleUserInfo.getUserId());
        return null;
    }

    /**
     * 根据苹果用户ID查找或创建用户（保留原有方法，兼容性）
     *
     * @param appleUserInfo 苹果用户信息
     * @return 用户信息
     */
    public Users findOrCreateUser(AppleUserInfo appleUserInfo) {
        return findUserByAppleId(appleUserInfo);
    }

    /**
     * 生成苹果绑定Token并存储到Redis
     *
     * @param appleUserInfo 苹果用户信息
     * @return 绑定Token
     */
    public String generateBindToken(AppleUserInfo appleUserInfo) {
        String bindToken = UUID.randomUUID().toString().replace("-", "");
        String redisKey = APPLE_BIND_TOKEN_PREFIX + bindToken;
        
        // 存储苹果用户信息到Redis
        JSONObject tokenData = new JSONObject();
        tokenData.put("appleUserId", appleUserInfo.getUserId());
        tokenData.put("email", appleUserInfo.getEmail());
        tokenData.put("emailVerified", appleUserInfo.isEmailVerified());
        tokenData.put("createTime", System.currentTimeMillis());
        
        RedisUtil.setex(redisKey, APPLE_BIND_TOKEN_EXPIRE_SECONDS, tokenData.toJSONString());
        
        logger.info("生成苹果绑定Token: bindToken={}, appleUserId={}", bindToken, appleUserInfo.getUserId());
        
        return bindToken;
    }

    /**
     * 验证并获取苹果绑定Token中的用户信息
     *
     * @param bindToken 绑定Token
     * @return 苹果用户信息，如果Token无效或过期返回null
     */
    public AppleUserInfo verifyBindToken(String bindToken) {
        if (StringUtil.isEmpty(bindToken)) {
            return null;
        }
        
        String redisKey = APPLE_BIND_TOKEN_PREFIX + bindToken;
        String tokenDataStr = RedisUtil.getString(redisKey);
        
        if (StringUtil.isEmpty(tokenDataStr)) {
            logger.warn("苹果绑定Token无效或已过期: bindToken={}", bindToken);
            return null;
        }
        
        JSONObject tokenData = JSON.parseObject(tokenDataStr);
        AppleUserInfo appleUserInfo = new AppleUserInfo();
        appleUserInfo.setUserId(tokenData.getString("appleUserId"));
        appleUserInfo.setEmail(tokenData.getString("email"));
        appleUserInfo.setEmailVerified(tokenData.getBooleanValue("emailVerified"));
        
        return appleUserInfo;
    }

    /**
     * 使用并删除苹果绑定Token
     *
     * @param bindToken 绑定Token
     * @return 苹果用户信息，如果Token无效或过期返回null
     */
    public AppleUserInfo consumeBindToken(String bindToken) {
        AppleUserInfo appleUserInfo = verifyBindToken(bindToken);
        if (appleUserInfo != null) {
            String redisKey = APPLE_BIND_TOKEN_PREFIX + bindToken;
            RedisUtil.del(redisKey);
            logger.info("苹果绑定Token已使用并删除: bindToken={}", bindToken);
        }
        return appleUserInfo;
    }

    /**
     * 通过手机号绑定苹果用户ID到已有用户
     *
     * @param phone 手机号
     * @param bindToken 绑定Token
     * @return 绑定后的用户信息
     */
    public Users bindAppleUserToExistingUser(String phone, String bindToken) {
        // 验证绑定Token
        AppleUserInfo appleUserInfo = consumeBindToken(bindToken);
        if (appleUserInfo == null) {
            throw new BaseException(I18nUtil.get("apple.bindtoken.expired"));
        }
        
        // 根据手机号查找用户
        Users user = userService.findByUserPhone(phone);
        if (user == null) {
            throw new BaseException(I18nUtil.get("apple.bindphone.notfound"));
        }
        
        // 绑定苹果用户ID
        userService.bindAppleUserId(user.getUserId(), appleUserInfo.getUserId());
        
        // 重新获取用户信息
        user = userService.findById(user.getUserId());
        
        logger.info("苹果账号绑定到已有用户成功: userId={}, appleUserId={}, phone={}", 
            user.getUserId(), appleUserInfo.getUserId(), phone);
        
        return user;
    }

    /**
     * 通过手机号注册新用户并绑定苹果用户ID
     *
     * @param phone 手机号
     * @param userName 用户名
     * @param bindToken 绑定Token
     * @return 新注册的用户信息
     */
    public Users registerAndBindAppleUser(String phone, String userName, String bindToken) {
        // 验证绑定Token
        AppleUserInfo appleUserInfo = consumeBindToken(bindToken);
        if (appleUserInfo == null) {
            throw new BaseException(I18nUtil.get("apple.bindtoken.expired"));
        }
        
        // 检查手机号是否已存在
        Users existingUser = userService.findByUserPhone(phone);
        if (existingUser != null) {
            throw new BaseException(I18nUtil.get("apple.register.phone.exists"));
        }

        appleUserInfo.setUserName(userName);

        // ios用户使用手机号注册
        Users savedUser = userApplicationService.registerIosByPhone(phone, appleUserInfo);
        
        logger.info("新用户注册并绑定苹果账号成功: userId={}, appleUserId={}, phone={}", 
            savedUser.getUserId(), appleUserInfo.getUserId(), phone);
        
        return savedUser;
    }

    /**
     * 获取苹果公钥
     * 从苹果服务器获取公钥列表并解析公钥（支持ES256和RS256）
     *
     * @param kid key id
     * @return 公钥
     */
    private PublicKey getApplePublicKey(String kid) {
        try {
            // 从苹果服务器获取公钥列表
            JSONObject keysResponse = fetchApplePublicKeys();
            if (keysResponse == null || !keysResponse.containsKey("keys")) {
                throw new BaseException("无法获取苹果公钥列表");
            }

            JSONArray keys = keysResponse.getJSONArray("keys");
            logger.debug("苹果公钥列表包含 {} 个公钥", keys.size());

            for (int i = 0; i < keys.size(); i++) {
                JSONObject keyInfo = keys.getJSONObject(i);
                String currentKid = keyInfo.getString("kid");
                String alg = keyInfo.getString("alg");

                logger.debug("检查公钥 {}: kid={}, alg={}", i, currentKid, alg);

                if (kid.equals(currentKid)) {
                    logger.info("找到匹配的公钥: kid={}, alg={}", kid, alg);
                    return buildPublicKey(keyInfo);
                }
            }

            throw new BaseException("未找到对应的苹果公钥: " + kid);

        } catch (Exception e) {
            logger.error("获取苹果公钥失败", e);
            throw new BaseException("获取苹果公钥失败: " + e.getMessage(), e);
        }
    }

    /**
     * 从苹果服务器获取公钥列表
     *
     * @return 公钥列表JSON
     */
    private JSONObject fetchApplePublicKeys() {
        OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build();

        Request request = new Request.Builder()
            .url(APPLE_PUBLIC_KEYS_URL)
            .get()
            .build();

        try (Response response = client.newCall(request).execute()) {
            logger.debug("苹果公钥API响应状态码: {}", response.code());

            if (!response.isSuccessful()) {
                logger.error("获取苹果公钥失败: HTTP {}", response.code());
                throw new BaseException("获取苹果公钥失败: HTTP " + response.code());
            }

            String responseBody = response.body() != null ? response.body().string() : null;
            if (StringUtil.isEmpty(responseBody)) {
                logger.error("苹果公钥响应为空");
                throw new BaseException("苹果公钥响应为空");
            }

            logger.debug("苹果公钥API响应: {}", responseBody);
            return JSON.parseObject(responseBody);
        } catch (Exception e) {
            logger.error("调用苹果公钥API失败", e);
            throw new BaseException("调用苹果公钥API失败: " + e.getMessage(), e);
        }
    }

    /**
     * 构建公钥
     * 支持ES256 (ECDSA)和RS256 (RSA)算法
     *
     * @param keyInfo 公钥信息
     * @return 公钥
     */
    private PublicKey buildPublicKey(JSONObject keyInfo) {
        String alg = keyInfo.getString("alg");

        if ("ES256".equals(alg)) {
            // ES256 使用ECDSA算法
            return buildECPublicKey(keyInfo);
        } else if ("RS256".equals(alg)) {
            // RS256 使用RSA算法
            return buildRSAPublicKey(keyInfo);
        } else {
            throw new BaseException("不支持的算法: " + alg + " (仅支持ES256和RS256)");
        }
    }

    /**
     * 构建EC公钥 (ES256)
     *
     * @param keyInfo 公钥信息
     * @return EC公钥
     */
    private PublicKey buildECPublicKey(JSONObject keyInfo) {
        try {
            // 获取x和y坐标
            String xBase64 = keyInfo.getString("x");
            String yBase64 = keyInfo.getString("y");

            if (StringUtil.isEmpty(xBase64) || StringUtil.isEmpty(yBase64)) {
                throw new BaseException("EC公钥坐标信息不完整");
            }

            // Base64解码
            byte[] xBytes = Base64.getUrlDecoder().decode(xBase64);
            byte[] yBytes = Base64.getUrlDecoder().decode(yBase64);

            // 转换为BigInteger
            BigInteger x = new BigInteger(1, xBytes);
            BigInteger y = new BigInteger(1, yBytes);

            // 创建ECPoint
            ECPoint ecPoint = new ECPoint(x, y);

            // 使用P-256曲线参数（ES256使用P-256）
            ECParameterSpec ecParameterSpec = getP256ParameterSpec();

            // 创建公钥规范
            ECPublicKeySpec pubKeySpec = new ECPublicKeySpec(ecPoint, ecParameterSpec);

            // 生成公钥
            KeyFactory kf = KeyFactory.getInstance("EC");
            return kf.generatePublic(pubKeySpec);
        } catch (Exception e) {
            throw new BaseException("构建EC公钥失败: " + e.getMessage(), e);
        }
    }

    /**
     * 构建RSA公钥 (RS256)
     *
     * @param keyInfo 公钥信息
     * @return RSA公钥
     */
    private PublicKey buildRSAPublicKey(JSONObject keyInfo) {
        try {
            // 获取模数和指数
            String nBase64 = keyInfo.getString("n");
            String eBase64 = keyInfo.getString("e");

            if (StringUtil.isEmpty(nBase64) || StringUtil.isEmpty(eBase64)) {
                throw new BaseException("RSA公钥参数不完整");
            }

            // Base64解码
            byte[] nBytes = Base64.getUrlDecoder().decode(nBase64);
            byte[] eBytes = Base64.getUrlDecoder().decode(eBase64);

            // 转换为BigInteger
            BigInteger modulus = new BigInteger(1, nBytes);
            BigInteger exponent = new BigInteger(1, eBytes);

            // 创建RSA公钥规范
            java.security.spec.RSAPublicKeySpec pubKeySpec = new java.security.spec.RSAPublicKeySpec(modulus, exponent);

            // 生成公钥
            KeyFactory kf = KeyFactory.getInstance("RSA");
            return kf.generatePublic(pubKeySpec);
        } catch (Exception e) {
            throw new BaseException("构建RSA公钥失败: " + e.getMessage(), e);
        }
    }

    /**
     * 获取P-256椭圆曲线参数
     *
     * @return EC参数规范
     */
    private ECParameterSpec getP256ParameterSpec() {
        // P-256曲线参数
        BigInteger p = new BigInteger("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF", 16);
        BigInteger a = new BigInteger("FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC", 16);
        BigInteger b = new BigInteger("5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B", 16);
        BigInteger gx = new BigInteger("6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296", 16);
        BigInteger gy = new BigInteger("4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5", 16);
        BigInteger n = new BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16);
        int h = 1;

        EllipticCurve curve = new EllipticCurve(
            new java.security.spec.ECFieldFp(p),
            a, b
        );

        ECPoint g = new ECPoint(gx, gy);

        return new ECParameterSpec(
            curve, g, n, h
        );
    }

    /**
     * 苹果用户信息类
     */
    @Data
    public static class AppleUserInfo {
        private String userId;
        private String email;
        private boolean emailVerified;
        private Long authTime;
        private Integer realUserStatus;
        private String userName;
    }
}