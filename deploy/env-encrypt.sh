#!/bin/bash
# env-encrypt.sh — 加密 .env 中的敏感字段 (SM4/ECB/PKCS5Padding + Base64)
#
# 与 Java Sm4Util.encrypt/decrypt 完全兼容。
#
# 用法:
#   ./env-encrypt.sh                    # 加密 ../.env (原地, 备份到 .env.plaintext)
#   ./env-encrypt.sh /path/to/.env      # 加密指定文件
#   ./env-encrypt.sh --decrypt .env     # 解密(恢复明文)
#
# 密钥 (16字节 hex, 与 Java Sm4Util.DEFAULT_KEY_HEX 一致):
#   优先级: BYCLAW_SM4_KEY > BYCLAW_SM4_KEY_FILE > /etc/byclaw/sm4.key > 内置默认
#
# 已经是 ENC(...) 格式的字段会跳过(幂等)。

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Java Sm4Util 内置的默认密钥
_BUILTIN_KEY_HEX="7734484041394b6c6d214530364f5e38"

# 获取 SM4 密钥 (32位 hex string = 16字节密钥)
_get_sm4_key() {
    if [ -n "${BYCLAW_SM4_KEY:-}" ]; then
        echo "$BYCLAW_SM4_KEY"
        return 0
    fi

    local key_file="${BYCLAW_SM4_KEY_FILE:-}"
    if [ -z "$key_file" ]; then
        if [ -f /etc/byclaw/sm4.key ]; then
            key_file="/etc/byclaw/sm4.key"
        elif [ -f "$HOME/.byclaw/sm4.key" ]; then
            key_file="$HOME/.byclaw/sm4.key"
        fi
    fi

    if [ -n "$key_file" ] && [ -f "$key_file" ]; then
        cat "$key_file" | tr -d '\n'
        return 0
    fi

    # 使用内置默认密钥 (与 Java Sm4Util.DEFAULT_KEY_HEX 一致)
    echo "$_BUILTIN_KEY_HEX"
}

# 需要加密的字段名模式
SENSITIVE_PATTERN="(_PASS$|_PASS=|PASSWORD|SECRET|API_KEY|ACCESS_KEY|TOKEN)"

MODE="encrypt"
ENV_FILE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --decrypt|-d) MODE="decrypt"; shift ;;
        --pattern|-p) SENSITIVE_PATTERN="$2"; shift 2 ;;
        --help|-h)
            echo "用法: $0 [--decrypt] [--pattern REGEX] [env-file]"
            echo ""
            echo "选项:"
            echo "  --decrypt, -d     解密模式(ENC → 明文)"
            echo "  --pattern, -p     自定义敏感字段正则"
            echo ""
            echo "密钥来源(优先级从高到低):"
            echo "  1. 环境变量 BYCLAW_SM4_KEY (32位hex字符串)"
            echo "  2. 环境变量 BYCLAW_SM4_KEY_FILE 指定的文件"
            echo "  3. /etc/byclaw/sm4.key"
            echo "  4. ~/.byclaw/sm4.key"
            echo "  5. 内置默认密钥 (与 Java Sm4Util 一致)"
            echo ""
            echo "示例:"
            echo "  $0 ../.env                        加密"
            echo "  $0 --decrypt ../.env              解密"
            echo "  BYCLAW_SM4_KEY=xxx $0 .env        用指定密钥加密"
            exit 0
            ;;
        *) ENV_FILE="$1"; shift ;;
    esac
done

if [ -z "$ENV_FILE" ]; then
    ENV_FILE="$SCRIPT_DIR/../.env"
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: 文件不存在 — $ENV_FILE"
    exit 1
fi

SM4_KEY=$(_get_sm4_key)

# SM4/ECB/PKCS5Padding 加密 → Base64
_sm4_encrypt() {
    echo -n "$1" | openssl enc -sm4-ecb -K "$SM4_KEY" -base64 | tr -d '\n'
}

# Base64 → SM4/ECB/PKCS5Padding 解密
_sm4_decrypt() {
    echo "$1" | openssl enc -sm4-ecb -K "$SM4_KEY" -base64 -d 2>/dev/null
}

TMPFILE=$(mktemp)
trap "rm -f '$TMPFILE'" EXIT

count=0

while IFS= read -r line || [ -n "$line" ]; do
    if [[ "$line" =~ ^[[:space:]]*# ]] || [[ -z "$line" ]]; then
        echo "$line" >> "$TMPFILE"
        continue
    fi

    if [[ "$line" =~ ^([^=]+)=(.*)$ ]]; then
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"

        if [ "$MODE" = "encrypt" ]; then
            if [[ "$value" =~ ^ENC\( ]]; then
                echo "$line" >> "$TMPFILE"
                continue
            fi
            if echo "$key" | grep -qE "$SENSITIVE_PATTERN"; then
                encrypted=$(_sm4_encrypt "$value")
                echo "${key}=ENC(${encrypted})" >> "$TMPFILE"
                count=$((count + 1))
            else
                echo "$line" >> "$TMPFILE"
            fi
        else
            if [[ "$value" =~ ^ENC\((.+)\)$ ]]; then
                cipher="${BASH_REMATCH[1]}"
                plain=$(_sm4_decrypt "$cipher")
                if [ $? -ne 0 ] || [ -z "$plain" ]; then
                    echo "ERROR: 解密失败 — $key" >&2
                    exit 1
                fi
                echo "${key}=${plain}" >> "$TMPFILE"
                count=$((count + 1))
            else
                echo "$line" >> "$TMPFILE"
            fi
        fi
    else
        echo "$line" >> "$TMPFILE"
    fi
done < "$ENV_FILE"

if [ "$MODE" = "encrypt" ]; then
    cp "$ENV_FILE" "${ENV_FILE}.plaintext"
    echo "备份明文: ${ENV_FILE}.plaintext"
else
    cp "$ENV_FILE" "${ENV_FILE}.encrypted.bak"
fi

mv "$TMPFILE" "$ENV_FILE"

echo "完成: ${MODE} $count 个字段 — $ENV_FILE"
echo "算法: SM4/ECB/PKCS5Padding, 密钥: ${SM4_KEY:0:8}..."
