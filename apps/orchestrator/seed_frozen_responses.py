"""Create/update the controlled-experiment responses in PostgreSQL."""

import asyncio
import os

import asyncpg

from frozen_responses import migrate_frozen_explanations, seed_frozen_explanations


async def main() -> None:
    conn = await asyncpg.connect(
        user=os.getenv("POSTGRES_USER", "orchestrator"),
        password=os.getenv("POSTGRES_PASSWORD", "orchestrator"),
        database=os.getenv("POSTGRES_DB", "orchestrator_db"),
        host=os.getenv("POSTGRES_HOST", "orchestrator-postgres"),
        port=int(os.getenv("POSTGRES_PORT", "5432")),
    )
    try:
        await migrate_frozen_explanations(conn)
        count = await seed_frozen_explanations(conn)
    finally:
        await conn.close()
    print(f"Seeded {count} frozen experiment responses.")


if __name__ == "__main__":
    asyncio.run(main())
