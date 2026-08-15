FROM node:22-bookworm-slim
WORKDIR /app

COPY package*.json ./
RUN npm ci --legacy-peer-deps --include=optional

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
EXPOSE 3001

CMD ["sh", "-c", "node node_modules/.bin/payload migrate && node_modules/.bin/next start --port ${PORT:-3001}"]
