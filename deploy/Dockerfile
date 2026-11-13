FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
COPY scripts/setup.js ./scripts/setup.js
USER node
ENV HOST=0.0.0.0
CMD ["node", "src/gateway.js"]
