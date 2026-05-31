# Smart Contract Deployment Report

## Deployment Date
March 27, 2026

## Contract Information

### AgentRegistry Contract
- **Network**: Stellar Testnet
- **Contract ID**: `CDTLE6RKAXDXMKDTBLNXYQFIDQKXFM4ARYBX6DG6XDHJPXRESIJEL3MU`
- **WASM Hash**: `469a2815b8fedacae79d95d1a00413ae3ce9766f0854ac6d61bc3b66305fedc9`
- **Optimized WASM Size**: 4,460 bytes

### Explorer Links
- **Contract Deployment Tx**: https://stellar.expert/explorer/testnet/tx/5fbdafc23a4b05e30daba4c5628f93313959bb7262b3ec89d18c41644534804d
- **Contract Explorer**: https://lab.stellar.org/r/testnet/contract/CDTLE6RKAXDXMKDTBLNXYQFIDQKXFM4ARYBX6DG6XDHJPXRESIJEL3MU

## Deployment Account

### Alice Account (Deployment)
- **Public Key**: `GARN7A6OJKPR3HAPVIKM6GRUD7KMEHYQ76VJJCO4AAKQ6ETEKFQPQ24T`
- **Secret Key**: `SC22G2DCY443NWBCIMTBA4CSUGTZ4T5HLCCLWJDRCKGMSMNG2KEL6QB7`

## Exported Contract Functions

The AgentRegistry contract exposes the following functions:

1. `register_agent` - Register a new agent
2. `get_agent` - Retrieve agent information
3. `fork_agent` - Fork an existing agent
4. `pay_for_request` - Pay for agent service request
5. `update_price` - Update agent pricing

## Test Transaction
A test registration was performed:
- **Test Tx**: https://stellar.expert/explorer/testnet/tx/72d57d00e18a6ca74008f0e7857f6d1945f56e3d9cd039bc6af65d126d767ec8
- **Agent ID**: `test_agent_1`
- **Price**: 500,000 stroops (0.05 XLM)
- **Owner**: Alice account

## Environment Setup

Update your `.env.local` with:

```env
NEXT_PUBLIC_SOROBAN_CONTRACT_ID=CDTLE6RKAXDXMKDTBLNXYQFIDQKXFM4ARYBX6DG6XDHJPXRESIJEL3MU
STELLAR_AGENT_SECRET=SC22G2DCY443NWBCIMTBA4CSUGTZ4T5HLCCLWJDRCKGMSMNG2KEL6QB7
```

## Additional Resources

- **Stellar Testnet Explorer**: https://stellar.expert/explorer/testnet
- **Soroban Documentation**: https://developers.stellar.org/docs/build/smart-contracts
