FROM node:20-alpine

WORKDIR /app
RUN apk add --no-cache su-exec
COPY package.json ./
COPY src ./src
COPY packages ./packages
COPY configs ./configs
COPY docker-entrypoint.sh /usr/local/bin/xinchao-entrypoint
RUN chmod 0755 /usr/local/bin/xinchao-entrypoint \
    && mkdir -p /app/state \
    && chown -R node:node /app

USER node
ENV NODE_ENV=production
EXPOSE 18110
ENTRYPOINT ["xinchao-entrypoint"]
CMD ["node", "src/server.js"]
