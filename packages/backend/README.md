# Shared Backend Library

Server-only code used by the API and independent worker. This package is not a
server, reads no env files on import, and starts no listeners, queues or workers.
Runtime owners supply validated configuration.
