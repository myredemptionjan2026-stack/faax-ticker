FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# Install ALL deps (including devDeps) so tsc is available for the build step
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune devDeps after build — keeps the final image lean
RUN npm prune --omit=dev

EXPOSE 8080

CMD ["node", "dist/index.js"]
