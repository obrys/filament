# syntax=docker/dockerfile:1.6
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json* ./
# Workaround for npm optional dependencies bug (https://github.com/npm/cli/issues/4828)
# which can omit the platform-specific rollup binary (e.g. musl on Alpine).
RUN rm -f package-lock.json && npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM docker.io/library/nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
EXPOSE 8080
