-- Creates the two database roles Quiz.me uses. Run once as an administrator.
-- Passwords are passed as psql variables, never stored in this file:
--
--   psql "$ADMIN_URL" -v migrator_password="$MIGRATOR_PW" \
--        -v app_password="$APP_PW" -v db_name=quizme -f web/db/roles.sql
--
-- quizme_migrator owns the schema and runs migrations at container start.
-- quizme_app is the runtime role: DML only, no DDL, owns nothing.
\set ON_ERROR_STOP on

SELECT format('CREATE ROLE quizme_migrator LOGIN PASSWORD %L', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quizme_migrator') \gexec
SELECT format('CREATE ROLE quizme_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'quizme_app') \gexec

ALTER ROLE quizme_migrator NOSUPERUSER NOCREATEROLE NOCREATEDB;
ALTER ROLE quizme_app NOSUPERUSER NOCREATEROLE NOCREATEDB NOINHERIT;

-- Some managed services (Azure Flexible Server) require the admin to be a
-- member of a role before it can transfer ownership to it.
GRANT quizme_migrator TO CURRENT_USER;

ALTER DATABASE :"db_name" OWNER TO quizme_migrator;
REVOKE ALL ON DATABASE :"db_name" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db_name" TO quizme_app;

\connect :"db_name"

ALTER SCHEMA public OWNER TO quizme_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO quizme_app;

-- Existing tables (if roles are created after the first migration).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quizme_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO quizme_app;

-- Tables created by future migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE quizme_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quizme_app;
ALTER DEFAULT PRIVILEGES FOR ROLE quizme_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO quizme_app;
