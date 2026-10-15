FROM node:22-slim

WORKDIR /app

# Install production dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App sources
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER node

CMD ["node", "src/server.js"]
