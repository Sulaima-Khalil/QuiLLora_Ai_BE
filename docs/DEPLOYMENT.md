# Deployment

The API is a stateless Node process plus MongoDB. The only stateful piece is
the uploads directory — see [Uploads](#uploads) before deploying to an
ephemeral host.

---

## Pre-flight checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are long, random and **different**
- [ ] `MONGO_URI` points at a managed database, with the host allow-listed
- [ ] `CLIENT_URL` is the deployed frontend origin
- [ ] `COOKIE_SECURE=true` (and `COOKIE_SAME_SITE=none` if cross-site)
- [ ] SMTP configured, or you accept that emails only reach the log
- [ ] Health checks point at `/api/v1/ready`
- [ ] `ENABLE_CRON=true` on exactly one instance

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Cookies: the one thing that catches people out

Auth rides in cookies, so the browser's rules decide whether sign-in works.

**Same site** — frontend and API share a domain
(`app.example.com` + `api.example.com` with `COOKIE_DOMAIN=.example.com`):

```bash
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_DOMAIN=.example.com
```

**Cross site** — frontend on Vercel, API on Render:

```bash
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
# leave COOKIE_DOMAIN unset
```

`SameSite=None` is rejected by browsers without `Secure`, and `Secure`
requires HTTPS. The config layer sets `secure` automatically when
`COOKIE_SAME_SITE=none`, but the deployment must still be served over HTTPS.

Symptom of getting this wrong: login appears to succeed, then every
subsequent request is 401 and the user looks signed out on reload.

---

## MongoDB Atlas

1. Create a free M0 cluster.
2. **Database Access** → add a user with *Read and write to any database*.
3. **Network Access** → add your host's egress IP, or `0.0.0.0/0` if the
   platform has no static IP.
4. Copy the connection string and append the database name:

```
mongodb+srv://user:password@cluster.mongodb.net/inkflow?retryWrites=true&w=majority
```

URL-encode any special characters in the password (`@` → `%40`).

---

## Render

**Build command**

```bash
npm ci
```

**Start command**

```bash
npm start
```

**Health check path**: `/api/v1/ready`

Add every variable from `.env.example` in the dashboard. Render's free tier
has an ephemeral filesystem — attach a disk and set `UPLOAD_DIR` to its mount
path, or move uploads to object storage.

---

## Railway

Railway detects Node automatically. Set the variables, then:

```bash
railway up
```

Add a MongoDB plugin, or point `MONGO_URI` at Atlas. Mount a volume if you
keep local uploads.

---

## Vercel

The API runs as a single serverless function: `api/index.js` re-exports the
Express app from `src/app.js` (which never calls `app.listen()`), and
`vercel.json` rewrites every `/api/*` request to it. `src/server.js` — the
file that calls `app.listen()`, connects to MongoDB on boot, and starts cron
jobs — is not part of this path; `npm start` still runs it unchanged for
local development or any non-serverless host.

**Framework preset**: Other
**Build command**: none required (leave blank, or `npm ci` if Vercel insists on one)
**Output directory**: not applicable
**Root directory**: the repository root (where `vercel.json` and `api/` live)

Add every variable from `.env.example` in the project's Environment Variables
settings — the same names used everywhere else in this document, including:

```
NODE_ENV
MONGO_URI
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
CLIENT_URL
COOKIE_SECURE
COOKIE_SAME_SITE
SAFEPAY_ENVIRONMENT
SAFEPAY_API_KEY
SAFEPAY_V1_SECRET
SAFEPAY_WEBHOOK_SECRET
SAFEPAY_PLAN_PRO_MONTHLY
SAFEPAY_PLAN_PRO_YEARLY
SAFEPAY_PLAN_BUSINESS_MONTHLY
SAFEPAY_PLAN_BUSINESS_YEARLY
```

Do not set `PORT` — Vercel's Node runtime does not use it, and nothing in the
serverless path reads it.

The production URL Vercel assigns follows `https://<project-name>.vercel.app`
(or a custom domain, if one is attached). The Safepay webhook URL is that
same origin plus the existing path:

```
https://<vercel-backend-domain>/api/v1/billing/webhook
```

Register that exact URL in Safepay's dashboard, not the frontend's domain —
they are two different Vercel projects.

**Known limitations of this deployment path**, neither of which this change
attempts to fix:

- **Uploads.** `upload.middleware.js` writes cover images and avatars to
  local disk via `multer.diskStorage`, and `app.js` serves them back with
  `express.static`. Vercel's serverless filesystem is read-only outside
  `/tmp`, and `/tmp` does not persist across invocations or share across
  instances — an upload can appear to succeed and then 404 on the very next
  request. This is the same ephemeral-filesystem limitation already
  documented under [Uploads](#uploads) for Render's free tier and Heroku; it
  is a harder blocker here because there is no volume to mount. Fixing it
  means swapping the storage engine for S3/Cloudinary/R2, which is a real
  feature change and out of scope for a deployment-only pass.
- **Cron jobs.** `startCronJobs()` is only called from `src/server.js`, which
  this path never runs — a serverless function has no persistent process for
  `node-cron` to run inside. Scheduled maintenance jobs (`ENABLE_CRON`)
  silently do not run under this deployment path. Running them requires
  either a host that keeps a process alive (Render, Railway, a VPS) or
  moving that logic to [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
  calling a dedicated route — also out of scope here.
- **Request duration.** Vercel's Node functions have a default execution
  time limit (10s on Hobby; configurable higher on Pro/Enterprise via
  `maxDuration`). Long-running AI generation requests should be checked
  against whatever plan this project runs on.

---

## Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Dependencies are installed first so the layer caches across code changes.
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Never run as root.
RUN mkdir -p uploads && chown -R node:node /app
USER node

ENV NODE_ENV=production
EXPOSE 4000

# Fails the container's health check while MongoDB is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:4000/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
```

```yaml
# docker-compose.yml
services:
  api:
    build: .
    ports: ["4000:4000"]
    env_file: .env
    environment:
      MONGO_URI: mongodb://mongo:27017/inkflow
    volumes:
      - uploads:/app/uploads
    depends_on: [mongo]
    restart: unless-stopped

  mongo:
    image: mongo:7
    volumes:
      - mongo-data:/data/db
    restart: unless-stopped

volumes:
  uploads:
  mongo-data:
```

---

## VPS with PM2 and Nginx

```bash
npm ci --omit=dev
pm2 start src/server.js --name inkflow-api
pm2 save && pm2 startup
```

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    # 5MB uploads plus multipart overhead.
    client_max_body_size 6M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;

        # The app trusts one proxy hop, so rate limiting sees the real client.
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Host              $host;
    }
}
```

`app.set('trust proxy', 1)` is already configured, which is what makes
`req.ip` the real client address behind exactly one proxy. Add hops only if
your topology has them — trusting more than you have lets a client spoof its
IP and evade the rate limiter.

**Scaling to multiple instances:** the app is stateless, so run as many as you
like behind the load balancer. Set `ENABLE_CRON=false` on all but one, or the
maintenance jobs run concurrently (they are idempotent, so this is wasteful
rather than harmful).

---

## Uploads

Cover images and avatars are written to `UPLOAD_DIR` on local disk. On Render
free, Heroku, and most container platforms that directory is **wiped on every
deploy**, so images silently disappear.

Options, in order of effort:

1. Mount a persistent volume and set `UPLOAD_DIR` to it.
2. Replace the multer storage engine in
   `src/middlewares/upload.middleware.js` with S3, Cloudinary or R2. Only
   `toPublicUrl` and `removeUpload` touch file paths besides it.
3. Accept the loss if images are decorative — the rest of the app is
   unaffected.

---

## Post-deploy checks

```bash
curl https://api.example.com/api/v1/health
curl https://api.example.com/api/v1/ready

# Should be blocked
curl -H "Origin: https://evil.example" https://api.example.com/api/v1/health

# Should be allowed
curl -H "Origin: https://app.example.com" -i https://api.example.com/api/v1/health \
  | grep -i access-control-allow-origin
```

Then sign in through the real frontend and reload the page. If the session
survives the reload, cookies are configured correctly.

Optionally seed the demo dataset:

```bash
MONGO_URI="<production uri>" npm run seed
```

Do not do this on a database with real users — use `npm run seed:destroy` to
remove it afterwards.

---

## Operations

**Logs** — structured to stdout/stderr, so the platform collects them.
`LOG_LEVEL=debug` temporarily for diagnosis; `info` in normal operation.

**Restarts** — `SIGTERM` triggers graceful shutdown: cron stops, in-flight
requests drain, then MongoDB disconnects, with a 10-second hard cap.

**Rotating JWT secrets** — changing a secret invalidates every existing token,
signing all users out. Do it during a quiet window.

**Backups** — Atlas snapshots, or `mongodump` on a schedule. Everything the
application needs is in MongoDB except uploaded files, which need their own
backup if you kept them on disk.
