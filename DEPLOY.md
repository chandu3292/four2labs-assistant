# Deploying Four2Labs Assistant (free, 24/7) on Oracle Cloud

This guide hosts the **entire stack** — FastAPI app, RAG, voice agent, and a
**self-hosted LiveKit** server with TLS + TURN — on an **Oracle Cloud "Always Free"**
ARM instance, reachable at `https://assistant.four2labs.com`.

> Why Oracle: it's the only genuinely free tier with enough RAM (24 GB) + a real
> public IP + open UDP ports, all of which this voice/WebRTC app needs. AWS/GCP
> free tiers (1 GB RAM) and Render/Railway/Fly free (sleep, no UDP) cannot run it.

Architecture (all on one host, talking over `localhost`):

```
assistant.four2labs.com  ──TLS──>  Caddy  ──>  localhost:8005   FastAPI app + UI
livekit.four2labs.com    ──TLS──>  Caddy  ──>  localhost:7880   LiveKit signaling (wss)
turn.four2labs.com       ──TLS──>  Caddy  ──>  localhost:5349   TURN (WebRTC fallback)
                                              + UDP 7882        WebRTC media
voice agent  ──> localhost:7880 (LiveKit) + localhost:8005/mcp/sse (tools)
```

---

## 1. Create the Oracle Always Free instance

1. Sign up at <https://cloud.oracle.com> (needs a credit card for identity — **Always
   Free resources are never charged**; just don't add paid ones).
2. **Compute → Instances → Create instance**:
   - Image: **Ubuntu 22.04**
   - Shape: **Ampere (ARM) — VM.Standard.A1.Flex**, set **2–4 OCPU and 12–24 GB RAM**
     (all within Always Free). If you get an "out of capacity" error, retry another
     Availability Domain or region — ARM capacity is sometimes tight.
   - Add your SSH public key.
   - Keep "Assign a public IPv4 address" enabled.
3. Note the instance's **public IP**.

---

## 2. Open the firewall (TWO places on Oracle)

Oracle blocks ports at both the cloud network layer **and** inside the OS.

**a) Cloud network (VCN):** Networking → Virtual Cloud Networks → your VCN →
Security Lists → default → **Add Ingress Rules** (Source `0.0.0.0/0`):

| Port | Protocol | Purpose |
|------|----------|---------|
| 80   | TCP | HTTP (Let's Encrypt + redirect) |
| 443  | TCP | App + LiveKit signaling (TLS) |
| 5349 | TCP | TURN over TLS |
| 7881 | TCP | LiveKit ICE/TCP fallback |
| 7882 | UDP | WebRTC media |

**b) Inside the instance** (Oracle Ubuntu ships restrictive iptables):

```bash
sudo iptables -I INPUT -p tcp --dport 80   -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443  -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 5349 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 7881 -j ACCEPT
sudo iptables -I INPUT -p udp --dport 7882 -j ACCEPT
sudo netfilter-persistent save
```

> Do **not** open 7880 or 8005 — Caddy reaches those over localhost only.

---

## 3. DNS in Cloudflare

Add three **A records**, all pointing to the instance's public IP, and set each to
**DNS only (grey cloud, NOT proxied)** — Cloudflare's orange proxy breaks
Let's Encrypt issuance and WebRTC:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | `assistant` | `<public-ip>` | DNS only (grey) |
| A | `livekit`   | `<public-ip>` | DNS only (grey) |
| A | `turn`      | `<public-ip>` | DNS only (grey) |

---

## 4. Install Docker

```bash
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker
```

---

## 5. Deploy self-hosted LiveKit + Caddy (official generator)

Use LiveKit's official generator — it produces a correct, version-matched
`caddy.yaml` + `livekit.yaml` + `docker-compose.yaml` for your domains:

```bash
cd ~ && docker run --rm -it -v $PWD:/output livekit/generate
```

When prompted:
- **Domain (LiveKit):** `livekit.four2labs.com`
- **TURN domain:** `turn.four2labs.com`

This creates a folder (e.g. `~/livekit.four2labs.com/`) with the configs. Note the
generated **API key + secret** (in `livekit.yaml` under `keys:`) — you'll reuse them.

**Add the app to Caddy:** edit the generated `caddy.yaml`. Find the `layer4`
route block that matches `livekit.four2labs.com` and proxies to `localhost:7880`.
**Duplicate it**, changing the SNI to `assistant.four2labs.com` and the upstream to
`localhost:8005`. Then add `assistant.four2labs.com` to the `tls → certificates →
automate` list so Caddy issues its certificate too.

Start LiveKit + Caddy:

```bash
cd ~/livekit.four2labs.com && docker compose up -d
```

---

## 6. Deploy the app + voice agent

```bash
git clone https://github.com/chandu3292/four2labs-assistant.git ~/four2labs-assistant && cd ~/four2labs-assistant

# credentials (Google Calendar) — copy your credentials/*.json into ./credentials/
mkdir -p credentials   # then scp your calendar.json / client_secret.json / key.json here

# environment
cp deploy/.env.example deploy/.env
nano deploy/.env       # fill in keys; LIVEKIT_API_KEY/SECRET must MATCH livekit.yaml
cp deploy/livekit.yaml.example deploy/livekit.yaml   # set the same secret here

# seed the demo knowledge base
cp /path/to/your/four2labs-docs/* deploy/seed/   # PDFs, DOCX, etc.

# build + run (first build pulls torch/model — a few minutes)
cd deploy && docker compose -f docker-compose.app.yml up -d --build
```

Watch logs (first chat/voice query downloads the BGE-M3 model, ~2.3 GB, once):

```bash
docker compose -f docker-compose.app.yml logs -f
```

---

## 7. Verify

- Open `https://assistant.four2labs.com` → UI loads, padlock is valid.
- **Chat tab** → ask about a seeded doc → should answer from it.
- **Speech tab** → pick a persona → connect → talk. (Mic needs the valid HTTPS cert,
  which step 5 provides.)
- If voice connects but no audio: TURN/UDP issue → re-check step 2 (ports 5349/tcp,
  7882/udp) and that DNS records are **grey/DNS-only**.

---

## Updating later

```bash
cd ~/four2labs-assistant && git pull
cd deploy && docker compose -f docker-compose.app.yml up -d --build
```

## Notes
- **RAG is in-memory.** Anything uploaded via the UI is lost on restart; only the
  `deploy/seed/` docs are reloaded automatically. Keep demo content in `seed/`.
- **Rotate your API keys** if the repo's git history was ever shared — old secrets
  remain in past commits (see the earlier cleanup note).
- This same kit runs on any Linux VPS (Hetzner, DigitalOcean, EC2). Oracle is just
  the free one.
