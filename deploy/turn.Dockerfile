FROM coturn/coturn:4.18.0-r0
USER root
# Either container may create the volume first when --no-deps starts both together.
# Both image mount points must seed the same API-owned directory permissions.
RUN mkdir -p /run/circle-turn && chown 1001:1001 /run/circle-turn
COPY --chmod=0555 turn-entrypoint.sh /usr/local/bin/circle-turn.sh
USER nobody:nogroup
ENTRYPOINT ["/bin/sh", "/usr/local/bin/circle-turn.sh"]
