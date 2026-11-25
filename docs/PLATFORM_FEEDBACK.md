# Platform feedback log

Things we ran into while building on QDay Aevum testnet, written so the QDay team can act on them.
Each entry says what we saw, when, and what would help. Checked items have been reported in Discord.

| # | Date (UTC) | Area | What we saw | Suggestion | Reported |
|---|---|---|---|---|---|
| 1 | 2026-11-25 | Explorer | The starter kit says contract verification doesn't work. **Update: it worked for us on 2026-11-25 (09:55 UTC)** with `forge verify-contract --verifier blockscout --verifier-url https://explorer-test.qday.info/api/`. | Update the starter kit README so builders know verification is back. | [ ] |
| 2 | 2026-11-25 | Docs | The starter kit FAQ says there's "no officially supported bundler or paymaster", while qday.io/build lists smart accounts, bundlers, a stablecoin paymaster, agent wallets and session keys as "live on testnet". Builders can't tell which is true. | One source of truth for account-abstraction support, with endpoints and addresses. | [ ] |
| 3 | 2026-11-25 | Docs | qday.io/build links an "Official contract addresses" page at wiki.qday.info/Knowledge/reference/contracts that returns 404. | Fix the link, or point to qday.io/official-links. | [ ] |
| 4 | 2026-11-25 | On-chain | EntryPoint v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`) and Kernel v3.1 contracts are deployed on 44005, but no official page lists them. | List them on the official links page if they're supported. | [ ] |
| 5 | 2026-11-25 | Docs | qday.io/build lists a WebSocket RPC (`wss://rpc-test.qday.info`); the starter kit says there is no WebSocket RPC. Not yet tested by us. | Confirm which is right. | [ ] |
| 6 | 2026-11-25 | Identity | The starter kit (commit `e87bcff`) says QDay's ERC-8004 registry is in internal testing and not open for this challenge, while the challenge brief lists ERC-8004 as integration evidence. | Say in the brief that ERC-8004 isn't expected for Challenge #1. | [ ] |
| 7 | 2026-11-25 | Faucet | The web faucet refuses new test wallets ("Not eligible: this address holds no ETH, USDT or USDC on Ethereum mainnet"). The Discord faucet gives 1 tQDAY + 5 tUSD8 once per Discord account, which is tight for a multi-role demo (parent, relayer, school, guardian). We scaled our demo amounts down to fit. | A builder allowance for registered challenge teams, or a per-address daily Discord claim. | [ ] |
