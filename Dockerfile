FROM node:22-slim

# Устанавливаем пакеты для сборки native C++ модулей (better-sqlite3 / node-gyp)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN mkdir -p /app/data /app/public/uploads

EXPOSE 3000

CMD ["npm", "start"]