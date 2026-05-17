# Database Migrations

Migrations are managed by [`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/) (v8, plain SQL, ESM-friendly).

## Directory layout

```
db/
  migrations/          # versioned SQL migration files (committed to repo)
    0001_core_schema.sql
    ...
  README.md            # this file
```

## Migration history

`node-pg-migrate` tracks applied migrations in a `pgmigrations` table that it creates automatically in your database on first run. This table is **not** managed by hand — it is owned by the tool.

## Scripts

All scripts are run from the **monorepo root** via `pnpm`:

| Command | Description |
|---|---|
| `pnpm migrate:up` | Apply all pending migrations |
| `pnpm migrate:down` | Roll back the most recent migration |
| `pnpm migrate:create -- <name>` | Scaffold a new migration file |

## Configuration

The tool reads the database connection string from the `DATABASE_URL` environment variable. Set it in `.env` or your deployment environment before running any migration command:

```
DATABASE_URL=postgres://user:password@localhost:5432/swrap
```

See `.env.example` for the full list of required environment variables.

## Running in CI / at deploy time

```sh
DATABASE_URL=$DATABASE_URL pnpm migrate:up
```

Migrations are idempotent — re-running `migrate:up` when all migrations are already applied is a no-op.

## Naming convention

Migration files follow the pattern `NNNN_<snake_case_description>.sql` where `NNNN` is a zero-padded sequence number:

```
0001_core_schema.sql
0002_add_form_tags.sql
```

## What Postgres MUST NOT contain

Per the architecture requirements, no migration may add columns of type `bytea`, or columns named `body`, `plaintext`, `cipher`, or `private_key`. A schema lint (`db/lint/forbidden-columns.sql`) enforces this in CI.
