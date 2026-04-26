FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

CMD ["sh", "-c", "node_modules/.bin/payload migrate --no-prompt 2>&1 || true && node_modules/.bin/next start --port ${PORT:-3001}"]
