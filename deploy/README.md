# Deployment

The stand runs on a single server: Postgres, backend, frontend and Caddy in one
compose project. Nothing but Caddy is exposed. TLS certificates are issued and
renewed by Caddy itself.

Why one box rather than a managed platform: the backend reads the Solana role
keys **from files** and stores KYC documents **on disk**, so it needs a
persistent volume and a process that never sleeps. Free container platforms
fail on exactly those two points.

## Layout on the machine

```
/srv/dala/app        this repository
/srv/dala/secrets    role keypairs, mode 600, mounted read-only
/srv/dala/uploads    borrower and investor documents
/srv/dala/backups    nightly dumps, kept 14 days
```

## From zero

```bash
# 1. System
apt-get update && apt-get install -y ca-certificates curl postgresql-client-16
# swap first: 2 GB of RAM is not enough to build the images
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
ufw allow 22,80,443/tcp && ufw --force enable

# 2. Docker (official repository), then
git clone https://github.com/davydmk/dala-capital-monorepo /srv/dala/app
cd /srv/dala/app/deploy
cp .env.example .env     # fill JWT_SECRET, POSTGRES_PASSWORD, domains

# 3. Role keys — copied from the developer machine, never from the repository
scp backend/.secrets/devnet/{admin,operator,whitelist}.json root@server:/srv/dala/secrets/
chmod 600 /srv/dala/secrets/*.json

# 4. Build and start
docker compose build
docker compose up -d
./migrate.sh

# 5. First administrator
docker compose exec backend node -e '...'   # or pnpm seed:admin from the repo
```

## Day to day

| Task | Command |
|---|---|
| Deploy a new version | `git pull && docker compose build && docker compose up -d` |
| Apply migrations | `./migrate.sh` |
| Logs | `docker compose logs -f backend` |
| Backup now | `./backup.sh` |
| Restore a dump | `docker compose exec -T postgres pg_restore -U dala -d dala --clean < db-….dump` |

Cron entries worth having:

```
0 3 * * * /srv/dala/app/deploy/backup.sh
* * * * * /srv/dala/app/deploy/uptime.sh
```

## Notes

- **The role keys live on the server.** For a devnet stand that is an acceptable
  price for a public demo. Before mainnet they are replaced by a multisig —
  that item is already in the roadmap.
- **Postgres is tuned down** (`shared_buffers=192MB`) because the machine has
  2 GB of RAM shared with two Node processes.
- **Caddy limits request bodies to 12 MB** — documents are capped at 10 MB by
  the application, and the margin covers form overhead.
