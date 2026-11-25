# Demo accounts on Aevum testnet (chain 44005)

Test-only wallets used for the live demo. They hold test tokens only. Private keys are never stored in
this repository.

| Role | Address | What it does | Needs tQDAY | Needs tUSD8 |
|---|---|---|---|---|
| Parent | [`0xD0357C705f8Bade6C3e87691871D55E24fb3a485`](https://explorer-test.qday.info/address/0xD0357C705f8Bade6C3e87691871D55E24fb3a485) | Deploys PocketRails, creates and funds the vault, sets rules, approves | Yes | Yes |
| Child | [`0x79611f4010B0b1768F995484b5910Dacea8B0d16`](https://explorer-test.qday.info/address/0x79611f4010B0b1768F995484b5910Dacea8B0d16) | Signs payments and exception requests; never pays gas | No | No |
| Relayer | [`0xF5348F7Dc6B66DFB8A7aCD345114d0467ac0016E`](https://explorer-test.qday.info/address/0xF5348F7Dc6B66DFB8A7aCD345114d0467ac0016E) | Server wallet that submits the child's signed intents | Yes | No |
| School | [`0x8C6a84C3B1463EB302214D8356280aE218e0368F`](https://explorer-test.qday.info/address/0x8C6a84C3B1463EB302214D8356280aE218e0368F) | Runs the canteen (approved payee) and the billing key + treasury | A little | No |
| Guardian | [`0xEA667C1da9752e09d5dB9E1aeE8Da44b8DE300db`](https://explorer-test.qday.info/address/0xEA667C1da9752e09d5dB9E1aeE8Da44b8DE300db) | Owner of the guardian smart account (and an EOA guardian for the Guardian page) | A little | No |
| Guardian smart account | [`0x4D22c96D456CA81892C925bB2044DD28d21a31B0`](https://explorer-test.qday.info/address/0x4D22c96D456CA81892C925bB2044DD28d21a31B0) | Kernel v3.1 account owned by Guardian; guards allowance #1 on v2; pays its own gas | Yes (has 0.0097) | No |
| Guardian session key | `0xE0078d6bE769bEe23Ad5D4eAcE941A2053a61F97` | The guardian agent's key: can only make the smart account call `vetoCharge` (30 days) | No | No |

Gas on Aevum is about 1 gwei, so deploying PocketRails costs roughly 0.005 tQDAY. One faucet claim
(5 tQDAY) covers each account for the whole challenge.
