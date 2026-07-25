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
