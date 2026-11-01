# Isolate Organizations in a shared database with row-level security

Each Organization is a separate company, so one company's data must never reach another. All Organizations share one Postgres database: every tenant-owned table has an `organization_id`, and Postgres Row-Level Security enforces the boundary as a second layer behind application checks. We rejected one schema or one database per Organization because migrations and operations get much heavier for the handful of companies we expect to run.
