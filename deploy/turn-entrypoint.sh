#!/bin/sh
set -eu

# The API creates this key before it starts serving requests. Keep it across rebuilds.
attempt=0
key_file="${CALL_TURN_SECRET_FILE:-/run/circle-turn/key}"
until [ -s "$key_file" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 180 ]; then
    echo 'TURN: waiting for API to initialize the shared key; restarting.' >&2
    exit 1
  fi
  sleep 1
done
secret="${CALL_TURN_SECRET:-$(cat "$key_file")}"

exec turnserver -n --log-file=stdout --fingerprint --use-auth-secret \
  --static-auth-secret="$secret" \
  --realm=circle-calls --external-ip="${TURN_PUBLIC_IP:-13.140.148.251}" \
  --listening-port=3478 --min-port=49160 --max-port=49260 \
  --cli=false --no-tls --no-multicast-peers --no-tcp-relay \
  --denied-peer-ip=0.0.0.0-0.255.255.255 \
  --denied-peer-ip=10.0.0.0-10.255.255.255 \
  --denied-peer-ip=100.64.0.0-100.127.255.255 \
  --denied-peer-ip=169.254.0.0-169.254.255.255 \
  --denied-peer-ip=172.16.0.0-172.31.255.255 \
  --denied-peer-ip=192.168.0.0-192.168.255.255 \
  --denied-peer-ip=::ffff:0:0-::ffff:ffff:ffff \
  --denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
  --denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff \
  --user-quota=12 --total-quota=1200
