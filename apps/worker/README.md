# Hisaab Worker

This is a standalone application, not a Fastify API route or an API startup hook.
It connects to the same PostgreSQL, Redis and private R2/S3 bucket as `apps/api`.
Run and scale it separately. Starting the API never starts a worker.
