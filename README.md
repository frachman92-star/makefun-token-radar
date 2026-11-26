# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/frachman92-star/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/frachman92-star/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar is a web dashboard that ranks pre-token protocols by what their launch would be worth, each with concrete steps to farm it. It reads the sealed DefiLlama snapshot (758 protocols, 40 on the watchlist), scores 198 protocols with a transparent model, and renders a static offline dashboard with a board, a detail view for every protocol, and filters.

The implied value model: TVL x 0.22, adjusted by 7-day TVL growth (clamped), by age without a token (older without a token scores higher, capped at 4 years), and by chain breadth (up to +15%). Every value is an estimate from the snapshot's own figures, never a claimed price or a guaranteed airdrop. Farm steps are suggested onchain actions with cost and time, not promises.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

Node 22.18 or later, standard library only. The grader mounts the sealed snapshot at /input/snapshot.json and runs main.ts with no network.

---

<sub>Entered on [make.fun](https://make.fun/?ref={referral_code}&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
