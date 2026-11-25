# Third-party notices

Pocket Rails is MIT licensed (see [LICENSE](LICENSE)).

## Based on the Aevum Starter Kit

This project started from the [Aevum Starter Kit](https://github.com/qday-io/aevum-starter-kit)
(MIT, Copyright (c) 2026 PQA Labs), commit `e87bcff`. From the kit we kept the Foundry setup, the
`MockUSD8` test token, the Shanghai opcode check, the Makefile, the shared `@aevum-kit/aevum` package and
the Next.js scaffolding. Its original README is kept at [docs/STARTER_KIT.md](docs/STARTER_KIT.md).
`PocketRails.sol`, its tests and deploy script are new work for Aevum Builder Challenge #1.

## Open-source projects

The kit builds on the open-source projects below.
None of their code is copied into this repository: the Solidity libraries are git submodules that keep
their own LICENSE files, and the JavaScript packages are installed from npm.

## Solidity libraries (`contracts/lib`, git submodules)

| Project | Version | License | Source |
|---|---|---|---|
| forge-std | v1.9.6 | MIT or Apache-2.0 | https://github.com/foundry-rs/forge-std |
| OpenZeppelin Contracts | v5.1.0 | MIT | https://github.com/OpenZeppelin/openzeppelin-contracts |

## JavaScript packages (direct dependencies)

| Package | Version | License | Used in |
|---|---|---|---|
| next | 16.4.5 | MIT | web |
| react, react-dom | 19.2.0 | MIT | web |
| @rainbow-me/rainbowkit | 2.2.11 | MIT | web |
| wagmi | 2.19.5 | MIT | web |
| @tanstack/react-query | 5.90.2 | MIT | web |
| viem | 2.57.12 | MIT | web, examples, packages/aevum |
| tsx | 4.23.15 | MIT | examples (dev) |
| typescript | 5.9.3 | Apache-2.0 | all (dev) |

Their own dependencies carry their own licenses. To list them all, run `pnpm licenses list` in the repo root.
