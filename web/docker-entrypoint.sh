#!/bin/sh
# Apply database migrations with the migration role, then start the server
# with the runtime role. Set RUN_MIGRATIONS=false when migrations run as a
# separate job.
set -eu
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node /app/dist/migrate.mjs
fi
# The migration URL is only needed for the step above.
unset MIGRATION_DATABASE_URL
exec node /app/server.js
