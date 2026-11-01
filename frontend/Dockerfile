FROM node:24-bookworm-slim

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

ENV COPILOTKIT_TELEMETRY_DISABLED=true
EXPOSE 3000
CMD ["bun", "run", "dev"]
