import os
from logging.config import fileConfig
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

from alembic import context

# Load .env from project root
load_dotenv(Path(__file__).parent.parent / ".env")

config = context.config

# Override sqlalchemy.url from env var
db_url = os.environ.get("OBSERVER_DATABASE_URL", "postgresql://observer:observer@localhost:5436/observer")
# Use psycopg3 driver (postgresql+psycopg://) instead of psycopg2
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
config.set_main_option("sqlalchemy.url", db_url)

# Only configure logging from alembic.ini when running alembic CLI directly
# (not when called from main.py which has its own logging setup)
import logging as _logging
if not _logging.root.handlers:
    if config.config_file_name is not None:
        fileConfig(config.config_file_name)

target_metadata = None


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
