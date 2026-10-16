#!/usr/bin/env bash
# ==============================================================================
# Pipeline: Build & Deploy Vaultwarden Custom Web Vault (DnD Support)
# ==============================================================================

set -euo pipefail

# Configuration: customize or supply via environment variables
BUILD_HOST="${BUILD_HOST:-user@build-server}"
PROD_HOST="${PROD_HOST:-user@prod-server}"
BUILD_HOST_IP="${BUILD_HOST_IP:-10.x.x.x}"
VAULT_DOMAIN="${VAULT_DOMAIN:-vault.example.com}"

SRC_DIR="${SRC_DIR:-/opt/bw_web_builds/web-vault}"
CUSTOM_BUILD_DIR="${CUSTOM_BUILD_DIR:-/opt/custom-vw-build}"
IMAGE_TAG="${IMAGE_TAG:-vaultwarden:dnd-final}"
TAR_NAME="${TAR_NAME:-vaultwarden-dnd-deploy.tar.gz}"
HTTP_PORT="${HTTP_PORT:-8877}"

echo "=== [1/6] Running Angular Production Build on ${BUILD_HOST} ==="
ssh "${BUILD_HOST}" "cd ${SRC_DIR}/apps/web && NODE_OPTIONS='--max-old-space-size=8192' npm run dist:oss:selfhost"

echo "=== [2/6] Verifying DnD markers in generated bundle ==="
ssh "${BUILD_HOST}" "
  BUNDLE=\$(ls -t ${SRC_DIR}/apps/web/build/app/main.*.js | head -1)
  echo \"Latest bundle: \${BUNDLE}\"
  grep -q 'appVaultCipherRow' \"\${BUNDLE}\" || (echo 'ERROR: DnD patch not found in compiled bundle!' && exit 1)
  grep -q 'dragstart' \"\${BUNDLE}\" || (echo 'ERROR: dragstart handler missing!' && exit 1)
  echo 'Verification passed: DnD markers present.'
"

echo "=== [3/6] Packaging Docker Image on ${BUILD_HOST} ==="
ssh "${BUILD_HOST}" "
  rm -rf ${CUSTOM_BUILD_DIR}/web-vault-custom
  cp -r ${SRC_DIR}/apps/web/build ${CUSTOM_BUILD_DIR}/web-vault-custom
  cd ${CUSTOM_BUILD_DIR}
  docker build --no-cache -t ${IMAGE_TAG} .
  docker save ${IMAGE_TAG} | gzip > /tmp/${TAR_NAME}
  echo \"Image archive prepared: /tmp/${TAR_NAME}\"
"

echo "=== [4/6] Serving archive via temporary HTTP bridge ==="
ssh "${BUILD_HOST}" "
  pkill -f 'http.server ${HTTP_PORT}' || true
  nohup python3 -m http.server ${HTTP_PORT} --directory /tmp > /dev/null 2>&1 &
  sleep 2
"

echo "=== [5/6] Transferring and loading image on ${PROD_HOST} ==="
ssh "${PROD_HOST}" "
  curl -sL http://${BUILD_HOST_IP}:${HTTP_PORT}/${TAR_NAME} | docker load
  cd /opt/docker/vaultwarden
  sudo sed -i 's|image: vaultwarden:.*|image: ${IMAGE_TAG}|g' docker-compose.yml
  docker compose down && docker compose up -d
"

echo "=== [6/6] Cleanup & End-to-End Verification ==="
ssh "${BUILD_HOST}" "
  pkill -f 'http.server ${HTTP_PORT}' || true
  rm -f /tmp/${TAR_NAME}
"

sleep 5
echo "Verifying external domain (${VAULT_DOMAIN})..."
MAIN_JS=$(curl -sL "https://${VAULT_DOMAIN}/" | grep -oE 'main\.[^.]+\.js' | head -1)
echo "Active script in index.html: ${MAIN_JS}"

MATCHES=$(curl -sL "https://${VAULT_DOMAIN}/app/${MAIN_JS}" | grep -c 'appVaultCipherRow' || echo 0)
if [ "${MATCHES}" -gt 0 ]; then
  echo "SUCCESS: Vaultwarden DnD is live on ${VAULT_DOMAIN}!"
else
  echo "WARNING: Check live deployment, markers not found in served main JS."
fi
