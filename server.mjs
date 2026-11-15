// ProofCheck — zkVerify Agent Games, Wildcard track
// A "verify-before-you-believe" agent: it checks claims about on-chain
// facts (NFT ownership, tx receipts, token supply) against public BSC RPC
// and returns a signed verdict with the evidence attached.
//
// Node 22 stdlib only — no dependencies, runs anywhere (Render, Fly.io,
// Railway, any VPS). No private keys, no wallet, no funds: read-only.
//
// Env:
//   PORT               (default 8080)
//   AGENT_HMAC_SECRET  32-byte secret issued once by the Agent Games
//                      dashboard at agent registration. If unset, responses
//                      are unsigned (health/verify still work) — set it
//                      before preflight.
//   BSC_RPC            (default https://bsc-dataseed.binance.org/)
//
// Endpoints:
//   GET  /         agent card
//   GET  /health   preflight health check
//   POST /verify   { type, ... } -> { verdict, evidence, checked_at }
//
// Response signing (official build guide https://agentgames.zkverify.io/build):
//   x-agent-games-signature: sha256=<hmac-sha256(secret, raw body)>
// Same format as GateCheck. If the dashboard expects bare hex, this is a
// 1-line change in signBody().
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8080);
// Public BSC RPCs, tried in order — first success wins, so one dead
// endpoint never bricks a verification. Override with BSC_RPC (single URL).
const BSC_RPCS = (process.env.BSC_RPC ? [process.env.BSC_RPC] : [
  'https://bsc-dataseed.binance.org/',
  'https://rpc.ankr.com/bsc',
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed1.bnbchain.org/',
]);
const HMAC_SECRET = process.env.AGENT_HMAC_SECRET || '';

const OWNER_OF = '0x6352211e'; // ownerOf(uint256)
const TOTAL_SUPPLY = '0x18160ddd'; // totalSupply()

function isAddress(a) {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
}

function toHex(n) {
  return '0x' + BigInt(n).toString(16);
}

function pad32(hex) {
  return hex.replace(/^0x/, '').padStart(64, '0');
}

let LAST_RPC = BSC_RPCS[0];

async function rpc(method, params) {
  let lastErr;
  for (const url of BSC_RPCS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(`RPC ${json.error.code}: ${json.error.message}`);
      LAST_RPC = url;
      return json.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all RPCs failed');
}

async function ethCall(to, data) {
  return rpc('eth_call', [{ to, data }, 'latest']);
}

function signBody(body) {
  if (!HMAC_SECRET) return {};
  const sig = crypto.createHmac('sha256', HMAC_SECRET).update(body).digest('hex');
  return { 'x-agent-games-signature': `sha256=${sig}` };
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', ...signBody(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 65536) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function verifyClaim(c) {
  const checked_at = new Date().toISOString();
  if (!c || typeof c !== 'object' || !c.type) {
    return { verdict: 'invalid', reason: 'missing type', checked_at };
  }

  // 1) Does wallet X own NFT #id of contract C?  (ownerOf, on-chain)
  if (c.type === 'nft-owner') {
    if (!isAddress(c.contract) || !isAddress(c.owner) || c.tokenId === undefined) {
      return { verdict: 'invalid', reason: 'need contract, owner (0x...), tokenId', checked_at };
    }
    const raw = await ethCall(c.contract, OWNER_OF + pad32(toHex(c.tokenId)));
    const actual = '0x' + raw.slice(-40);
    const match = actual.toLowerCase() === c.owner.toLowerCase();
    return {
      verdict: match ? 'verified' : 'refuted',
      claim: { type: c.type, contract: c.contract, tokenId: String(c.tokenId), owner: c.owner },
      evidence: { ownerOf: actual, rpc: LAST_RPC },
      checked_at,
    };
  }

  // 2) Is tx hash H mined, and did it succeed? (receipt status)
  if (c.type === 'tx') {
    if (typeof c.hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(c.hash)) {
      return { verdict: 'invalid', reason: 'need hash (0x + 64 hex)', checked_at };
    }
    const r = await rpc('eth_getTransactionReceipt', [c.hash]);
    if (!r) return { verdict: 'unverified', reason: 'receipt not found (pending or unknown hash)', claim: { type: c.type, hash: c.hash }, checked_at };
    return {
      verdict: r.status === '0x1' ? 'verified' : 'refuted',
      claim: { type: c.type, hash: c.hash },
      evidence: { status: r.status, blockNumber: r.blockNumber, from: r.from, to: r.to, gasUsed: r.gasUsed, rpc: LAST_RPC },
      checked_at,
    };
  }

  // 3) What is the total supply of contract C right now?
  if (c.type === 'supply') {
    if (!isAddress(c.contract)) {
      return { verdict: 'invalid', reason: 'need contract (0x...)', checked_at };
    }
    const raw = await ethCall(c.contract, TOTAL_SUPPLY);
    return {
      verdict: 'verified',
      claim: { type: c.type, contract: c.contract },
      evidence: { totalSupply: String(BigInt(raw)), totalSupplyHex: raw, rpc: LAST_RPC },
      checked_at,
    };
  }

  return { verdict: 'invalid', reason: `unknown type "${c.type}" (nft-owner | tx | supply)`, checked_at };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      return send(res, 200, {
        agent: 'ProofCheck',
        track: 'zkVerify Agent Games — Wildcard',
        idea: 'Verify-before-you-believe: every claim about on-chain facts gets checked against public RPC and returned with its receipt, never on trust.',
        endpoints: ['GET /health', 'POST /verify {type: nft-owner|tx|supply, ...}'],
        signed: Boolean(HMAC_SECRET),
      });
    }
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, agent: 'ProofCheck', ts: new Date().toISOString() });
    }
    if (req.method === 'POST' && req.url === '/verify') {
      const claim = await readBody(req);
      const out = await verifyClaim(claim);
      return send(res, 200, out);
    }
    return send(res, 404, { verdict: 'invalid', reason: 'unknown route' });
  } catch (e) {
    return send(res, 500, { verdict: 'error', reason: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`ProofCheck listening on ${PORT}`));
