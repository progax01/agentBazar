# AgetBazar — Agent Notes

## Deployed Contracts

### AgetBazarEscrow
- **Network:** Arc Testnet (chain ID 5042002)
- **Address:** `0x8d02a3b328ec7b00476d75c544b01a6648457ee3`
- **Tx hash:** `0xf959d188924324d171a2648d5fc69d14da8b53bdf9ce7a57fd4ce28cf9359052`
- **Explorer:** https://explorer.testnet.arc.io/address/0x8d02a3b328ec7b00476d75c544b01a6648457ee3
- **Constructor args:** USDC = `0x3600000000000000000000000000000000000000`, reviewPeriod = 3600s
- **Deployed:** 2026-10-25

## Key Decisions
- Single task type: `solidity-source-report`
- Review period: 3600 seconds (1 hour)
- Deployer wallet: Circle-managed platform wallet (testnet only)
- All fund custody via ERC-20 USDC on Arc Testnet
