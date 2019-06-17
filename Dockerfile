FROM node:alpine AS BUILD
COPY . /tmp/src
# install some dependencies needed for the build process
RUN apk add --no-cache -t build-deps make gcc g++ python ca-certificates libc-dev wget git
RUN cd /tmp/src \
    && npm install \
    && npm run build

FROM node:alpine
ENV NODE_ENV=production
COPY --from=BUILD /tmp/src/build /build
COPY --from=BUILD /tmp/src/config /config
COPY --from=BUILD /tmp/src/node_modules /node_modules
RUN sh -c 'cd /build/tools; for TOOL in *.js; do LINK="/usr/bin/$(basename $TOOL .js)"; echo -e "#!/bin/sh\ncd /data;\nnode /build/tools/$TOOL \$@" > $LINK; chmod +x $LINK; done'
CMD node /build/src/discordas.js -p 9005 -c /data/config.yaml -f /data/discord-registration.yaml
EXPOSE 9005
VOLUME ["/data"]
