#!/bin/bash
# Always run from project root (one level up from scripts/)
cd "$(dirname "$0")/.."

#------------------------------------------------------
# Usage / Help
#------------------------------------------------------
usage() {
    cat <<'USAGE'
Usage: sh scripts/deploy.sh <env> [options]

Arguments:
  <env>       Environment identifier. Loads envs/<env>/.env as .env
              Example: 203 → loads envs/203/.env

Options:
  -r          Remove old deploy directory on remote before deploying
              (without this flag, deploy files are overwritten in-place)
  -h, --help  Show this help message

Examples:
  sh scripts/deploy.sh 203              # Deploy to 203 environment
  sh scripts/deploy.sh 203 -r           # Deploy with clean remote deploy dir
USAGE
    exit 0
}

#------------------------------------------------------
# Parse arguments
#------------------------------------------------------
ENV_ID=""
FLAG_REMOVE=false

for arg in "$@"; do
    case "$arg" in
        -h|--help) usage ;;
        -r) FLAG_REMOVE=true ;;
        -*)
            echo "Error: Unknown option '$arg'"
            usage
            ;;
        *)
            if [ -z "$ENV_ID" ]; then
                ENV_ID="$arg"
            else
                echo "Error: Unexpected argument '$arg'"
                usage
            fi
            ;;
    esac
done

if [ -z "$ENV_ID" ]; then
    echo "Error: Environment identifier is required."
    echo ""
    usage
fi

#------------------------------------------------------
# Load environment file
#------------------------------------------------------
ENV_DIR="envs/${ENV_ID}"
ENV_FILE="${ENV_DIR}/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: Environment file not found: $ENV_FILE"
    echo "Available environments:"
    ls -d envs/*/ 2>/dev/null | sed 's|envs/||;s|/||' | sed 's/^/  /'
    exit 1
fi

echo "========== Loading environment: ${ENV_DIR} =========="
cp "$ENV_FILE" .env
echo "Copied $ENV_FILE → .env"

# Source variables from .env
set -a
. ./.env
set +a

REMOTE_HOST="${HOST}"
REMOTE_USER="${HOST_USER}"
REMOTE_PASS="${HOST_PASSWORD}"
REMOTE_DIR="${DEPLOY_DIR}"

if [ -z "$REMOTE_HOST" ] || [ -z "$REMOTE_USER" ] || [ -z "$REMOTE_PASS" ] || [ -z "$REMOTE_DIR" ]; then
    echo "Error: HOST, HOST_USER, HOST_PASSWORD, DEPLOY_DIR must be set in $ENV_FILE"
    exit 1
fi

echo "  HOST         = ${REMOTE_HOST}"
echo "  USER         = ${REMOTE_USER}"
echo "  DEPLOY_DIR   = ${REMOTE_DIR}"
echo "  Remove old   = ${FLAG_REMOVE}"
echo ""

# Check sshpass
if ! command -v sshpass &>/dev/null; then
    echo "Error: sshpass is not installed."
    echo "  macOS:  brew install esolitos/ipa/sshpass"
    echo "  Linux:  apt install sshpass / yum install sshpass"
    exit 1
fi

SSH_CMD="sshpass -p $REMOTE_PASS ssh -o StrictHostKeyChecking=no ${REMOTE_USER}@${REMOTE_HOST}"
SCP_CMD="sshpass -p $REMOTE_PASS scp -o StrictHostKeyChecking=no"

#------------------------------------------------------
# 1. Package deploy directory
#------------------------------------------------------
echo "========== Packaging deploy.zip =========="
ZIP_NAME="deploy.zip"
rm -f "$ZIP_NAME"
zip -r "$ZIP_NAME" deploy/ -x "deploy/middleware/data/*" "deploy/*/logs/*" "deploy/middleware/opensandbox-server.toml"
echo ""

#------------------------------------------------------
# 2. Upload deploy.zip and .env
#------------------------------------------------------
echo "========== Uploading deploy to ${REMOTE_HOST} =========="
$SCP_CMD "$ZIP_NAME" .env "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/"
echo ""

#------------------------------------------------------
# 3. Remote: stop → (optional) remove → extract → pull → start
#------------------------------------------------------
echo "========== Deploying on remote server =========="
$SSH_CMD bash -s -- "$FLAG_REMOVE" "$REMOTE_DIR" <<'REMOTE_SCRIPT'
set -e
FLAG_REMOVE="$1"
REMOTE_DIR="$2"
cd "$REMOTE_DIR"

if [ -d "deploy" ]; then
    echo ">>> Stopping standalone services..."
    cd deploy && sh stop-standalone.sh 2>/dev/null || true
    cd "$REMOTE_DIR"

    echo ">>> Stopping mono services..."
    cd deploy && sh stop-mono.sh 2>/dev/null || true
    cd "$REMOTE_DIR"

    if [ "$FLAG_REMOVE" = "true" ]; then
        echo ">>> Removing old deploy folder (-r flag)..."
        rm -rf deploy
    fi
fi

echo ">>> Extracting deploy.zip..."
unzip -o deploy.zip

chmod -R +x deploy/**/*.sh deploy/*.sh

echo ">>> Pulling images..."
cd deploy/middleware && sh pull.sh
cd "$REMOTE_DIR"
cd deploy/standalone && sh pull.sh
cd "$REMOTE_DIR"

echo ">>> Starting standalone..."
cd deploy && sh start-standalone.sh

echo ""
echo "========== Deploy complete =========="
REMOTE_SCRIPT

#------------------------------------------------------
# 4. Local: run environment-specific init scripts
#------------------------------------------------------
INITDB_DIR="${ENV_DIR}/initDb"
if [ -d "${INITDB_DIR}" ]; then
    if compgen -G "${INITDB_DIR}/*.sql" > /dev/null; then
        echo ""
        echo ">>> Running initDb SQL scripts from ${INITDB_DIR} ..."
        python3 "scripts/init_db_from_env.py" "${ENV_ID}"
    else
        echo ""
        echo ">>> No initDb/*.sql found in ${INITDB_DIR}, skipping initDb."
    fi
else
    echo ""
    echo ">>> No initDb directory in ${ENV_DIR}, skipping initDb."
fi

if [ -f "${ENV_DIR}/init.sh" ]; then
    echo ""
    echo ">>> Running ${ENV_DIR}/init.sh ..."
    sh "${ENV_DIR}/init.sh"
else
    echo ""
    echo ">>> No init.sh found in ${ENV_DIR}, skipping initialization."
fi
