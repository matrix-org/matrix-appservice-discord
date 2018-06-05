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
    && apk del build-deps

ENV NODE_ENV=production

CMD node /build/discordas.js -p 9005 -c /data/config.yaml -f /data/discord-registration.yaml

EXPOSE 9005
VOLUME ["/data"]
