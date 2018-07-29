FROM node:alpine
COPY . /tmp/src

RUN apk add --no-cache -t build-deps make gcc g++ python ca-certificates libc-dev wget \
    && cd /tmp/src \
    && npm install \
    && npm run build \
    && mv build / \
    && mv config / \
    && mv node_modules / \
    && cd / \
    && rm -rf /tmp/* \
    && apk del build-deps \
    && sh -c 'cd /build/tools; for TOOL in *.js; do LINK="/usr/bin/$(basename $TOOL .js)"; echo -e "#!/bin/sh\nnode /build/tools/$TOOL \$@" > $LINK; chmod +x $LINK; done'

ENV NODE_ENV=production

CMD node /build/src/discordas.js -p 9005 -c /data/config.yaml -f /data/discord-registration.yaml

EXPOSE 9005
VOLUME ["/data"]
WORKDIR "/data"
