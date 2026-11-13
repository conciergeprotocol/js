FROM node:22-alpine

WORKDIR /app

COPY packages/mcp/package.json ./package.json
COPY packages/mcp/src ./src

RUN npm install --omit=dev

ENV CAP_FROM=agent:cap-mcp

ENTRYPOINT ["node", "src/index.js"]
