FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# Instalar Chromium + todas sus dependencias del sistema
RUN npx playwright install --with-deps chromium

COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/server.js"]
