FROM apify/actor-node:22 AS builder
COPY package*.json ./
RUN npm install --include=dev --audit=false
COPY . ./
RUN npm run build

FROM apify/actor-node:22
COPY package*.json ./
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional --audit=false \
    && rm -rf ~/.npm
COPY --from=builder /usr/src/app/dist ./dist
CMD npm run start:prod --silent
