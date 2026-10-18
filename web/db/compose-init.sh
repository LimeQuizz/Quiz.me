#!/bin/sh
# docker-compose only: runs once when the local Postgres volume is created and
# creates the migration and runtime roles with passwords from the environment.
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres \
  -v migrator_password="$POSTGRES_MIGRATOR_PASSWORD" \
  -v app_password="$POSTGRES_APP_PASSWORD" \
  -v db_name="$POSTGRES_DB" \
  -f /quizme/roles.sql
