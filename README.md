# Psyche Protocol Lab

**An interactive simulator for the Psyche coordinator state machine — tune a run config, watch it play out, export the TOML.**

🔗 **[Live demo](https://izmiradami.github.io/psyche-protocol-lab/)** · Single HTML file, no build step, no dependencies.

---

## Why

Psyche's docs describe the protocol precisely, but reading them leaves you with questions that
prose can't answer:

- What actually happens when a node drops mid-epoch?
- Why did my epoch fall into `Cooldown` instead of starting the next round?
- Is `witness_nodes = 2` enough, or am I one slow GPU away from missing quorum every round?
- If I set `max_round_train_time = 30`, which hardware am I silently excluding?

Those are *config* questions, and today the only way to answer them is to spend real devnet SOL
and wait. This tool answers them in ten seconds by running the state machine in front of you.

## What it does

**Live protocol simulation.** Clients ring the coordinator. Watch them download the model during
`Warmup`, train their assigned batches, gossip results over p2p (the green packets), and elected
witnesses fire bloom-filter proofs. Quorum fills, the phase advances early via opportunistic
witnessing — exactly as the protocol specifies.

**Every config knob is live.** `min_clients`, `init_min_clients`, `witness_nodes`, `warmup_time`,
`max_round_train_time`, `round_witness_time`, `cooldown_time`, `rounds_per_epoch`,
`global_batch_size`, `total_steps`. Change one, watch what breaks.

**Failure scenarios, one click each.** Drop a random client. Drop below `min_clients` and watch the
epoch abort. Add a slow node and watch it miss `max_round_train_time`. Add a client mid-run and
watch it sit `pending` until the next epoch — as the FAQ says it will.

**`config.toml` generator.** The panel on the right emits a valid run config matching the real
schema — model checkpoint, GCP data location, cosine LR schedule, DisTrO optimizer. Copy it
straight into `run-manager update-config`.

**Hermes Doctor.** Paste a real client log or error and [Hermes](https://portal.nousresearch.com/)
diagnoses it against Psyche's known failure modes — NVIDIA Container Toolkit, docker group, wallet
paths, RPC rate limits, join authorization, version-mismatch restart loops, delegate-key mistakes
across multiple machines. A second button feeds it your current config plus the simulation outcome
for a review.

**Bilingual.** Full TR/EN toggle, including Hermes responses.

## Run it

```bash
git clone https://github.com/izmiradami/psyche-protocol-lab
cd psyche-protocol-lab
open index.html      # that's it
```

No bundler, no `npm install`. One file, vanilla JS, hand-rolled SVG.

## Deploy

**GitHub Pages.** Rename `psyche-protocol-lab.html` to `index.html`, push, then
Settings → Pages → Source: `main` / root. Live in about a minute.

**Hermes Doctor uses your own key.** Paste a [Nous Portal](https://portal.nousresearch.com/) key
into the panel; it stays in memory for that tab and is never stored, logged, or sent anywhere except
Nous's inference API. Nothing to configure, and nobody is spending anyone else's credit.

If you'd rather host the key yourself so visitors don't need one, `worker.js` is an optional
Cloudflare Worker proxy — set `PROXY_URL` in the HTML and the key field disappears:

```bash
npx wrangler kv namespace create RATE_LIMIT   # paste the id into wrangler.toml
npx wrangler secret put NOUS_API_KEY
npx wrangler deploy
```

It enforces an origin allowlist, a model allowlist, a prompt-size cap, a `max_tokens` ceiling, a
per-IP hourly limit, and a global daily budget — and refuses to serve at all if the KV binding is
missing, so the key can never end up behind an unmetered endpoint. Never put the key in
client-side JS; anyone can read it.

> **CORS note:** calling the inference API directly from a browser may be blocked. If it is, the
> proxy is not optional, it's the fix.

## Accuracy

The simulation follows the documented state machine:

```
WaitingForMembers → Warmup → RoundTrain → RoundWitness ⇄ RoundTrain
                                              ↓
                        Cooldown → WaitingForMembers (next epoch)
```

Modelled faithfully: `init_min_clients` gating entry to `Warmup`; early exit from `Warmup` when all
clients report the model loaded; opportunistic witnessing short-circuiting `RoundTrain`; the three
documented paths into `Cooldown` (last round of the epoch, healthy clients below `min_clients`,
witness quorum missed); the checkpoint flipping to `P2P` on epoch teardown; deterministic batch
assignment seeded from epoch and round; `witness_nodes = 0` electing every node.

Simplified deliberately: quorum is approximated at two-thirds of the witnesses; training and model
download times are randomised per client rather than derived from real hardware; verification and
slashing are out of scope. It's a teaching and config-sanity tool, not a reimplementation of the
coordinator.

## Contributing

Corrections to protocol accuracy are the most valuable contributions — if a transition here doesn't
match the coordinator, that's a bug worth filing. Issues and PRs welcome.

## Links

- [Psyche](https://github.com/PsycheFoundation/psyche) · [docs](https://docs.psyche.network/)
- [Nous Research](https://nousresearch.com/) · [Nous Portal](https://portal.nousresearch.com/)

## License

MIT
