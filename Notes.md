# Development Notes

## Fix: Prisma `Presence` Table Not Found

### Issue

While testing the polling endpoint, requests to `/api/poll` were failing with a Prisma `P2021` error:

```text
The table `public.Presence` does not exist in the current database.
```

This caused the endpoint to return:

```text
GET /api/poll?id=<id> 500
```

### Root Cause

The Prisma schema contained the `Presence` model, but the corresponding table had not yet been created in the PostgreSQL database.

As a result, Prisma Client attempted to query a table that did not exist.

### Resolution

Applied the pending Prisma migration:

```bash
npx prisma migrate dev
```

Migration output confirmed that the database schema was synchronized and the following tables were created:

- `Presence`
- `Signal`

### Verification

After running the migration:

- `POST /api/join` returned `200 OK`
- `GET /api/poll` returned `200 OK`
- Prisma queries executed successfully
- No further `P2021` errors occurred

Example successful logs:

```text
POST /api/join 200
GET /api/poll?id=<id> 200
GET /api/poll?id=<id> 200
GET /api/poll?id=<id> 200
```

### Additional Notes

The polling endpoint consistently responds in approximately 500ms. This appears to be expected behavior from the application's polling/long-polling implementation and is not related to database performance or Prisma.
