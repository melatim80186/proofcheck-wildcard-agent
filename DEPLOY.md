# ProofCheck — zkVerify Agent Games, Wildcard track — deploy guide

## What this is
A "verify-before-you-believe" agent: it takes a claim about an on-chain
fact and checks it against public BSC RPC, returning a signed verdict with
the evidence (ownerOf address, receipt status, supply). It is the agent
version of the work in the Creator Track thread — receipts, not trust.

- `server.mjs` — Node 22 stdlib only, no dependencies, no wallet, no keys,
  read-only. Endpoints: `GET /` (agent card), `GET /health` (preflight),
  `POST /verify` with `{type: "nft-owner" | "tx" | "supply", ...}`.
- Responses are HMAC-SHA256 signed when `AGENT_HMAC_SECRET` is set
  (headers `x-agent-timestamp` + `x-agent-signature`). The exact header
  names must be aligned to whatever the dashboard shows at registration —
  the signing lives in `signBody()` in server.mjs, a 2-line change.
- `render.yaml` — Render free web service (recommended first try).
- `Dockerfile` — Fly.io / Railway / any Docker host.
- `package.json` — `npm start` runs it. Local git repo is committed
  (`9c4ab72`); **not yet pushed — see "Repo" below.**

## What was tested (2026-11-14 ~16:15 WIB, this VM)
- `node --check server.mjs` OK; server runs; `GET /` and `GET /health`
  return 200 with the HMAC signature headers present; bad `/verify` input
  returns `invalid` with a clear reason.
- **NOT tested live:** the on-chain RPC calls. This research stage blocks
  outbound RPC POSTs (verified: curl POST to bsc-dataseed, ankr and
  publicnode all denied by stage egress policy). The calldata is standard
  (`ownerOf` selector `0x6352211e` + 32-byte token id) and the server tries
  4 public RPCs in order with fallback, but the first live `/verify`
  against real RPC must be run after deploy — see "Smoke test".
- Cloudflare quick tunnel is NOT a path: `api.trycloudflare.com` TLS
  handshake is blocked from this VM (tested 15:55 WIB). Outbound HTTPS to
  Cloudflare/Render/Fly/HuggingFace/Vercel APIs is otherwise reachable.

## Deploy — recommended: Render free (no card, ~5 min)
1. Create the GitHub repo (see "Repo") and push.
2. Render dashboard → New → Web Service → connect the repo.
   `render.yaml` is picked up automatically; set env var
   `AGENT_HMAC_SECRET` **after** registration (step 3) — or leave unset
   for the first deploy and add it before preflight.
3. Register the agent (user's dashboard, logged in as @singakuuu):
   Manage Agents → name `ProofCheck` → paste the Render URL
   (`https://proofcheck-wildcard.onrender.com`) → the dashboard shows a
   32-byte HMAC secret **once** — save it, set it as `AGENT_HMAC_SECRET`
   in Render, redeploy.
4. Wake the service first (`GET /health` — free tier sleeps after ~15 min
   idle and takes ~30–60s to wake), then run preflight in the dashboard.
   If preflight times out on a cold start, wake it and retry.
5. Pick the Wildcard event, run practice mode, confirm a `/verify` round
   trip, then enter.

## Smoke test after deploy (do this before preflight)
- `curl <URL>/health` → `{"ok":true,...}`
- `curl -X POST <URL>/verify -d '{"type":"nft-owner","contract":"0x485be9daa4620fcee4e2baed7cc85ea57acb44b0","tokenId":1234,"owner":"0x0000000000000000000000000000000000000000"}'`
  → `verdict: "refuted"` with `evidence.ownerOf` = the real owner address
  (DRIFTWIRE #1234, minted 2026-11-10).
- `curl -X POST <URL>/verify -d '{"type":"supply","contract":"0x485be9daa4620fcee4e2baed7cc85ea57acb44b0"}'`
  → `verdict: "verified"` with a numeric `totalSupply`.

## Repo
Local: `~/workspace/bug-bounty/zkverify-agent-games/wildcard-agent/`
(commit `9c4ab72`, branch `main`, remote `origin` already set to
`https://github.com/melatim80186/proofcheck-wildcard-agent.git`).
`gh repo create` failed in this research stage — the stage egress policy
denied the api.github.com GraphQL POST (stream refused). At delivery, run:
`gh repo create melatim80186/proofcheck-wildcard-agent --public` then
`git push -u origin main`. If that also fails, create the repo in the
GitHub web UI and push from the same directory.

## Alternatives (if Render free is too sleepy for preflight)
- **Fly.io** (Dockerfile included): always-on small machine is steadier,
  but new accounts need a payment method on file. `fly launch` from this
  directory, then `fly secrets set AGENT_HMAC_SECRET=...`.
- **Hugging Face Spaces**: free CPU space, no card; needs an HF account.
- **Vercel**: needs a serverless adapter (this server is a long-running
  Node http server, not a serverless function) — not built; only if the
  above two fail.

## Prize / deadline (from the 2026-11-14 inspection)
Wildcard: 100,000 VFY pool (~$456 at $0,004559), 1st/2nd/3rd =
50,000/30,000/20,000 VFY (~$228/$137/$91). Judged by reviewers.
Season ends **21 Nov 2026**. Creator Track already SUBMITTED by the user
~16:13 WIB (dashboard, title "How Do I Know My Agent Did the Job?").
Gatekeeper + Steal the VFY were recommended skip (need live Groth16
endpoint + rounds already running); Wildcard is the remaining "gas"
track the user approved ("Gas semua nya", 2026-11-14 ~15:48 WIB).
