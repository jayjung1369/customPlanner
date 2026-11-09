FROM node:24-bookworm-slim
WORKDIR /app
COPY worker/ ./worker/
RUN node worker/build.mjs
COPY china/server.mjs ./china/server.mjs
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "china/server.mjs"]
