# ProofCheck — Verify-Before-You-Believe for On-Chain Claims

**zkVerify Agent Games — Wildcard track.** An agent that checks claims about
on-chain facts against live public RPC and returns a verdict **with the
evidence attached** — never on trust.

Live endpoint: **https://proofcheck-wildcard.onrender.com/**

## The problem

Agent-to-agent claims ("I own NFT #840", "this tx succeeded", "supply is
X") are usually taken on trust. ProofCheck makes them checkable: give it a
claim, it queries the chain and answers `verified` or `refuted`, with the
receipt data that proves it.

## What it verifies

`POST /verify` with one of three claim types. All read-only — no wallet, no
private keys, no funds.

**1. NFT ownership** — does wallet X own token #id of contract C?

```bash
curl -X POST https://proofcheck-wildcard.onrender.com/verify \
  -H 'Content-Type: application/json' \
  -d '{"type":"nft-owner","contract":"0x587C303982187Ec578dF309d27670327b13202F8","tokenId":840,"owner":"0xD99A6a19Bb7A59e0bd22134CDA94768EF999c3c1"}'
# -> {"verdict":"verified","claim":{...},"evidence":{"ownerOf":"0xD99A...","rpc":"..."},"checked_at":"..."}
```

**2. Transaction receipt** — is tx hash H mined, and did it succeed?

```bash
curl -X POST https://proofcheck-wildcard.onrender.com/verify \
  -H 'Content-Type: application/json' \
  -d '{"type":"tx","hash":"0x...64 hex chars..."}'
# -> {"verdict":"verified","evidence":{"status":"0x1","blockNumber":"...","from":"...","to":"...","gasUsed":"..."},"checked_at":"..."}
```

**3. Token supply** — what is the total supply of contract C right now?

```bash
curl -X POST https://proofcheck-wildcard.onrender.com/verify \
  -H 'Content-Type: application/json' \
  -d '{"type":"supply","contract":"0x265B2A6b32045af53d142f4e32123B28B0df4d7c"}'
# -> {"verdict":"verified","evidence":{"totalSupply":"...","totalSupplyHex":"0x..."},"checked_at":"..."}
```

## Verdicts

| verdict | meaning |
|---|---|
| `verified` | the chain agrees with the claim |
| `refuted` | the chain disagrees (evidence shows the real value) |
| `unverified` | no receipt found yet (pending or unknown hash) |
| `invalid` | malformed claim (missing/wrong fields) |
| `error` | RPC failure — nothing is asserted |

Every response carries `checked_at` and the RPC endpoint that answered, so a
verdict is reproducible: re-run the same `eth_call` / receipt lookup against
the same RPC and you get the same answer.

## How it works

- Node 22 stdlib only — **zero dependencies**, runs anywhere.
- BSC mainnet, four public RPCs tried in order (first success wins), so one
  dead endpoint never bricks a verification. Override with `BSC_RPC`.
- `ownerOf(uint256)` / `totalSupply()` via `eth_call`; receipts via
  `eth_getTransactionReceipt`.
- Responses are signed with `x-agent-games-signature` when
  `AGENT_HMAC_SECRET` is set — **bare lowercase hex** HMAC-SHA256 over the
  raw body, the format the Agent Games platform expects (proven by our
  sibling Gatekeeper agent's preflight: the platform hex-decodes the header,
  so a `sha256=` prefix makes every signature invalid).

## Endpoints

| route | returns |
|---|---|
| `GET /` | agent card |
| `GET /health` | `{ok:true, agent, ts}` |
| `POST /verify` | verdict + evidence (see above) |

## Run it yourself

```bash
node server.mjs            # PORT=8080 by default
BSC_RPC=https://bsc-dataseed.binance.org/ node server.mjs
```

Deploy: `render.yaml` (Render free tier) or any host that runs `node
server.mjs` — see [DEPLOY.md](DEPLOY.md).

## Honest scope note

Today ProofCheck verifies facts against public RPC. The natural next step —
attesting the check itself with zkTLS so the verdict is provable to a third
party without re-running the query — is **not built yet**. What is built and
live is the verification core: claims in, verdicts with receipts out.
