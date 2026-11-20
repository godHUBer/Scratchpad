#!/usr/bin/env python3
"""
Run the real migration SQL against a throwaway PostgreSQL and prove the RPCs work.

Why this exists: the repository only ever parsed its migrations (pglast) and ran
UI/helper tests. A migration can be perfectly valid SQL and still create a
function that raises the first time it is called — `admin_list_users` referenced
a `v.derived_seen` column with no `v` in its FROM clause, which no parser can
catch but any call exposes.

What it does:
  1. boots an embedded PostgreSQL (pgserver),
  2. installs supabase/tests/support/00_supabase_shim.sql so the Supabase-managed
     `auth`, `extensions` and `realtime` bits exist,
  3. applies every file in supabase/migrations in order,
  4. runs supabase/tests/sql/*.sql and fails on any RAISE.

Usage:
    python3 -m pip install --break-system-packages pgserver
    python3 supabase/tests/run_sql_tests.py

Exit code 0 means every migration applied and every assertion passed.
"""
from __future__ import annotations

import glob
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = os.path.join(REPO, "supabase", "migrations")
SHIM = os.path.join(REPO, "supabase", "tests", "support", "00_supabase_shim.sql")
COMPAT_DIR_HINT = os.path.join(REPO, "supabase", "tests", "support")
TESTS = os.path.join(REPO, "supabase", "tests", "sql")


def psql(server, sql: str) -> None:
    """
    Run SQL and raise on the first error.

    psql read from stdin does NOT stop on error unless told to, and it still
    exits 0 — so a broken migration or a failing assertion would pass silently.
    This is why the runner drives psql itself instead of pgserver's helper.
    """
    binary = os.path.join(str(server.pgdata.parent), "..", "..", "..", "..", "..", "bin", "psql")
    # pgserver exposes the binary path on the module; fall back to PATH lookup.
    import pgserver  # noqa: F401  (imported for its BIN path constant)
    candidate = str(getattr(pgserver.postgres_server, "POSTGRES_BIN_PATH", "")) + "/psql"
    if os.path.exists(candidate):
        binary = candidate
    elif not os.path.exists(binary):
        binary = "psql"

    result = subprocess.run(
        [binary, server.get_uri(), "-v", "ON_ERROR_STOP=1", "-q", "--no-psqlrc", "-f", "-"],
        input=sql.encode(),
        capture_output=True,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", "replace")
        raise RuntimeError(stderr.strip() or f"psql exited {result.returncode}")


def install_pgcrypto_standin(server) -> None:
    """
    Give PostgreSQL a `pgcrypto` extension when the build has no contrib.

    20261119000100_init_schema.sql opens with
        create extension if not exists pgcrypto with schema extensions;
    Without contrib that raises and every later migration is skipped, so the
    whole suite would pass while testing nothing. Writing a control file and an
    install script into share/extension makes the statement succeed unchanged.
    """
    import pgserver

    share = os.path.join(str(pgserver.postgres_server.POSTGRES_BIN_PATH), "..", "share", "postgresql", "extension")
    share = os.path.abspath(share)
    if not os.path.isdir(share):
        return  # not pgserver; assume the image already has pgcrypto

    control = os.path.join(share, "pgcrypto.control")
    script = os.path.join(share, "pgcrypto--1.3.sql")
    if os.path.exists(control) and os.path.exists(script):
        return  # a real pgcrypto is present; leave it alone

    with open(control, "w") as handle:
        handle.write("comment = 'local test stand-in for pgcrypto'\n"
                     "default_version = '1.3'\n"
                     "relocatable = true\n")
    with open(script, "w") as handle:
        handle.write(COMPAT_SQL)
    print("pgcrypto    stand-in installed (no contrib in this PostgreSQL build)")


COMPAT_SQL = """
create function pg_catalog.gen_salt(kind text) returns text
  language sql volatile
  as $b$ select 'shim$' || substr(md5(random()::text || clock_timestamp()::text), 1, 32) $b$;
create function pg_catalog.gen_salt(kind text, rounds int) returns text
  language sql volatile
  as $b$ select 'shim$' || substr(md5(random()::text || clock_timestamp()::text), 1, 32) $b$;
create function pg_catalog.crypt(password text, salt text) returns text
  language sql immutable
  as $b$
    select case
      when salt is null or left(salt, 5) <> 'shim$' then 'shim$invalid'
      when length(salt) = 37 then salt || md5(salt || password)
      when length(salt) = 68 then
        case when md5(left(salt, 37) || password) = substr(salt, 38) then salt else 'shim$nomatch' end
      else 'shim$invalid'
    end
  $b$;
create function pg_catalog.digest(data text, kind text) returns bytea
  language sql immutable
  as $b$ select decode(md5(data || ':' || kind), 'hex') $b$;
create function pg_catalog.gen_random_bytes(len int) returns bytea
  language sql volatile
  as $b$
    select decode(substr(string_agg(md5(random()::text), ''), 1, len * 2), 'hex')
    from generate_series(1, (len + 15) / 16)
  $b$;
"""


def main() -> int:
    try:
        import pgserver
    except ImportError:
        print("pgserver is not installed:", file=sys.stderr)
        print("  python3 -m pip install --break-system-packages pgserver", file=sys.stderr)
        return 2

    workdir = tempfile.mkdtemp(prefix="scratchpad-sql-")
    failures = 0
    try:
        server = pgserver.get_server(os.path.join(workdir, "data"), cleanup_mode=None)

        install_pgcrypto_standin(server)

        with open(SHIM) as handle:
            psql(server, handle.read())
        print("shim        ok")

        applied = 0
        for path in sorted(glob.glob(os.path.join(MIGRATIONS, "*.sql"))):
            with open(path) as handle:
                try:
                    psql(server, handle.read())
                except Exception as exc:  # noqa: BLE001 - report, do not crash
                    print(f"migration   FAIL {os.path.basename(path)}")
                    for line in str(exc).splitlines():
                        if "ERROR" in line or "LINE" in line:
                            print(f"            {line.strip()[:200]}")
                            break
                    return 1
                applied += 1
                print(f"migration   ok   {os.path.basename(path)}")

        for path in sorted(glob.glob(os.path.join(TESTS, "*.sql"))):
            with open(path) as handle:
                try:
                    psql(server, handle.read())
                except Exception as exc:  # noqa: BLE001
                    failures += 1
                    print(f"test        FAIL {os.path.basename(path)}")
                    for line in str(exc).splitlines():
                        if "ERROR" in line or "DETAIL" in line or "CONTEXT" in line:
                            print(f"            {line.strip()[:200]}")
                            break
                else:
                    print(f"test        ok   {os.path.basename(path)}")

        server.cleanup()
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print(f"\n{applied} migration(s) applied, {failures} test file(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
