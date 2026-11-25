# Live demo run on Aevum testnet

Run on 2026-11-25 with `pnpm example demo-flow` against PocketRails
[`0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df`](https://explorer-test.qday.info/address/0x7d54567d9D40641907B76A6b2fe6cb046e2B40Df),
using the accounts in [TESTNET_ACCOUNTS.md](TESTNET_ACCOUNTS.md). The child only signed; the relayer paid all
child gas. Refusals are successful transactions that record a reason code and move no money.

| Step | Who | Action | Outcome | What the user sees | Transaction |
|---|---|---|---|---|---|
| 1 | Parent | `createVault` | — | Done. | [`0xdc918b81…`](https://explorer-test.qday.info/tx/0xdc918b81820befbdc55bf80cd569827cbc4cfa1295c8ed11708722ed2d2cafe1) |
| 1 | Parent | `deposit` | — | Done. | [`0x5d9471ab…`](https://explorer-test.qday.info/tx/0x5d9471ab2fbf28d609002a220e50777dd9836406baf120bc82b8fa4a87dadad0) |
| 2 | Child | `pay 0.3 tUSD8` | allow | Paid. | [`0xf93f411b…`](https://explorer-test.qday.info/tx/0xf93f411b5c21d1bd08ff23b84d46af5018089dcd3d4e273ac2aee57d6fce2c30) |
| 3 | Child | `pay 0.8 tUSD8` | refuse | This is more than you can spend in one payment. | [`0xb5a88dad…`](https://explorer-test.qday.info/tx/0xb5a88dad7b25a785382590b3275140d85aee0e5f7bc09c207af3e20901870296) |
| 4 | Child | `requestException` | pending | Request sent. Waiting for your parent. | [`0x784878d7…`](https://explorer-test.qday.info/tx/0x784878d7ba4587090f2130b2dca523ef934f240339c68ef0d2f0bc5183dd481d) |
| 5 | Parent | `allowOnce` | — | Done. | [`0x937791e2…`](https://explorer-test.qday.info/tx/0x937791e22d182d85eb3c54595559de627c9e3b5446d7960ee1e7932b6733c8ef) |
| 6 | Child | `pay 1.3 tUSD8` | refuse | This payment doesn't match the exception your parent approved. | [`0xeb43477f…`](https://explorer-test.qday.info/tx/0xeb43477f22adb30222cce8e59bb92ae13126cda7b8dbc73fdee233152cfc33f8) |
| 6 | Child | `pay 1.2 tUSD8` | allow | Paid. | [`0x7deb0893…`](https://explorer-test.qday.info/tx/0x7deb089303dcf29a3321ba03eb664305ca646113748e9b1a21496a1008c0020f) |
| 6 | Child | `pay 1.2 tUSD8` | refuse | That exception isn't approved, has expired, or was already used. | [`0x009f05e5…`](https://explorer-test.qday.info/tx/0x009f05e5a751c7bbbfce1390e74b576c5535a777a1b0f2dd1851967780dc1ddf) |
| 9 | Parent | `revokeChild` | — | Done. | [`0x3468f32f…`](https://explorer-test.qday.info/tx/0x3468f32fb67e8559d66693bfb78c1178e7e145a595d775351b8e1492419a06d2) |
| 9 | Child | `pay 0.1 tUSD8` | refuse | Your parent has paused your spending. | [`0xd8ccd222…`](https://explorer-test.qday.info/tx/0xd8ccd222a21a483290514b26c92d24c55a9b90515d0491bb5aab873fdb0079d2) |

Also checked in the same run, with no transaction (rejected by the relayer before spending gas):

- Step 7: a signed payment with its payee changed → "This wasn't signed by the child's key for this allowance. Nothing was sent."
- Step 8: the same signed payment submitted twice → "This exact request was already submitted."

Balances after the run, read from the chain: vault 0.4 tUSD8, School (canteen) +0.4, museum +1.2
(total 2.0, exactly the deposit). Child wallet: 0 tQDAY, it never paid gas.
