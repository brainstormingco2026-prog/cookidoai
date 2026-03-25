# Imagen base con Node.js + dependencias de Playwright/Chromium
FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

# Instalar dependencias de Node
COPY package*.json ./
RUN npm ci --omit=dev

# Instalar solo Chromium (no Firefox ni WebKit)
RUN npx playwright install chromium

# Copiar código fuente
COPY src/ ./src/

EXPOSE 3000

CMD ["node", "src/server.js"]
