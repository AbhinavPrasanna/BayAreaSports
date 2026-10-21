#!/bin/sh
# Lightsail prepends its initialization script and invokes user data with /bin/sh.
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose-v2 curl unzip ca-certificates python3
systemctl enable --now docker
install -d -m 0700 /opt/bayline/deploy/secrets
install -d /etc/systemd/journald.conf.d
cat >/etc/systemd/journald.conf.d/bayline.conf <<'EOF'
[Journal]
SystemMaxUse=100M
EOF
systemctl restart systemd-journald
curl --fail --silent --show-error --location https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp/bayline-awscli
/tmp/bayline-awscli/aws/install
printf 'ready\n' >/opt/bayline/host-ready
