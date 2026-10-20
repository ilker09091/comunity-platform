FROM coturn/coturn:4.18.0-r0
USER root
# Either container may create the volume first when --no-deps starts both together.
# Both image mount points must seed the same API-owned directory permissions.
RUN mkdir -p /run/circle-turn && chown 1001:1001 /run/circle-turn
COPY --chmod=0555 turn-entrypoint.sh /usr/local/bin/circle-turn.sh
# Test the actual pinned binary, including every startup flag, before shipping the image.
# A healthy foreground daemon is stopped by timeout (124); parser failures fail the build.
RUN printf '%s\n' build-smoke-test-key-not-used-at-runtime > /tmp/turn-smoke-key; \
    status=0; \
    CALL_TURN_SECRET_FILE=/tmp/turn-smoke-key TURN_PUBLIC_IP=127.0.0.1 \
      timeout 3s /bin/sh /usr/local/bin/circle-turn.sh > /tmp/turn-smoke.log 2>&1 || status=$?; \
    if [ "$status" != 124 ]; then cat /tmp/turn-smoke.log; exit 1; fi; \
    rm /tmp/turn-smoke-key /tmp/turn-smoke.log
USER nobody:nogroup
ENTRYPOINT ["/bin/sh", "/usr/local/bin/circle-turn.sh"]
