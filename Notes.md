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


## Fix: Presence Rows Never Expired

### Issue

User dots remained visible on the map after users closed the app.

### Root Cause

The polling endpoint refreshed `lastSeen` for all presence records on every poll request. Because every row was continuously updated, no presence record could become stale and expire.

### Resolution

Updated the heartbeat logic to refresh only the requesting user's presence record (`where: { id }`) instead of all rows.

### Verification

1. Open two clients and join the map.
2. Close one client.
3. Wait longer than `STALE_MS` (15 seconds by default).
4. Confirm the closed client's dot disappears from the remaining client's map.

### Result

Inactive users now expire correctly and are removed from the map once their `lastSeen` timestamp exceeds the stale timeout.
