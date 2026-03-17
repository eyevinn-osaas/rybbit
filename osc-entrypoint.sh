#!/bin/bash
set -e

# === Section 1: Port Configuration ===
# The Rybbit backend hardcodes port 3001. We patch the compiled dist to use $PORT.
BIND_PORT="${PORT:-8080}"

# Patch the compiled dist/index.js to use $PORT instead of hardcoded 3001
if [ -f "dist/index.js" ]; then
  sed -i "s/port: 3001/port: ${BIND_PORT}/g" dist/index.js
  sed -i "s/0\.0\.0\.0:3001/0.0.0.0:${BIND_PORT}/g" dist/index.js
fi

# === Section 2: OSC Public URL Configuration ===
# BASE_URL is the public URL of this service - used for OAuth callbacks, email links etc.
# SERVER_URL is what the server uses for Google OAuth redirect URIs
if [ -n "$OSC_HOSTNAME" ]; then
  export BASE_URL="${BASE_URL:-https://$OSC_HOSTNAME}"
  export SERVER_URL="${SERVER_URL:-https://$OSC_HOSTNAME}"
fi

# === Section 3: PostgreSQL Connection ===
# Support both individual vars (POSTGRES_*) and a single DATABASE_URL
if [ -n "$DATABASE_URL" ] && [[ "$DATABASE_URL" =~ ^(postgresql|postgres):// ]]; then
  echo "Parsing DATABASE_URL for PostgreSQL connection..."
  if [[ "$DATABASE_URL" =~ ^([^:]+)://([^:]*):?([^@]*)@([^:/]+):?([0-9]*)/?(.*)$ ]]; then
    DB_USER="${BASH_REMATCH[2]}"
    DB_PASS="${BASH_REMATCH[3]}"
    DB_HOST="${BASH_REMATCH[4]}"
    DB_PORT="${BASH_REMATCH[5]:-5432}"
    DB_NAME="${BASH_REMATCH[6]}"

    export POSTGRES_HOST="${POSTGRES_HOST:-$DB_HOST}"
    export POSTGRES_PORT="${POSTGRES_PORT:-$DB_PORT}"
    export POSTGRES_USER="${POSTGRES_USER:-$DB_USER}"
    export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$DB_PASS}"
    export POSTGRES_DB="${POSTGRES_DB:-$DB_NAME}"
  fi
fi

# === Section 4: ClickHouse Connection ===
# Support CLICKHOUSE_URL as a convenience alias for CLICKHOUSE_HOST
if [ -n "$CLICKHOUSE_URL" ] && [ -z "$CLICKHOUSE_HOST" ]; then
  export CLICKHOUSE_HOST="$CLICKHOUSE_URL"
fi

# === Section 5: Redis Connection ===
# Support REDIS_URL for BullMQ (uptime monitoring job queue)
if [ -n "$REDIS_URL" ]; then
  if [[ "$REDIS_URL" =~ ^redis://([^:@]*):?([^@]*)@([^:]+):([0-9]+) ]]; then
    export REDIS_HOST="${REDIS_HOST:-${BASH_REMATCH[3]}}"
    export REDIS_PORT="${REDIS_PORT:-${BASH_REMATCH[4]}}"
    REDIS_PASS="${BASH_REMATCH[2]}"
    if [ -n "$REDIS_PASS" ]; then
      export REDIS_PASSWORD="${REDIS_PASSWORD:-$REDIS_PASS}"
    fi
  elif [[ "$REDIS_URL" =~ ^redis://([^:]+):([0-9]+) ]]; then
    export REDIS_HOST="${REDIS_HOST:-${BASH_REMATCH[1]}}"
    export REDIS_PORT="${REDIS_PORT:-${BASH_REMATCH[2]}}"
  fi
fi

# === Section 6: Database Migrations ===
echo "Running PostgreSQL database migrations..."
npm run db:push -- --force || echo "Warning: migrations failed, continuing startup..."

# === Section 7: Execute the original command ===
exec "$@"
