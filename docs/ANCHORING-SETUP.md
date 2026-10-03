# EvidenceGuard Ethereum Anchoring Setup Guide

EvidenceGuard periodically anchors Merkle roots of the internal blockchain ledger to the public Ethereum network (e.g. Sepolia testnet or local devnet). This creates immutable, public proof of the ledger state at specific points in time.

> [!WARNING]
> **CRITICAL SECURITY WARNING**
> - **NEVER** use a real mainnet wallet containing real cryptocurrency for development or testing.
> - **NEVER** commit private keys, mnemonic phrases, or RPC provider API keys to git or repository files.
> - Always configure private keys via local `.env` variables that are excluded by `.gitignore`.

---

## 1. Local Offline Demo Node (Recommended for Development & Demos)

For local development and demos where no internet connection or Sepolia testnet ETH is available, you can run a local Hardhat Ethereum node:

1. Navigate to the `blockchain` directory and start the local node:
   ```bash
   cd blockchain
   npx hardhat node
   ```
   This spins up a local JSON-RPC server at `http://127.0.0.1:8545` with 20 pre-funded test accounts (10,000 ETH each).

2. In a separate terminal, deploy the `EvidenceAnchor` contract to the local node:
   ```bash
   cd blockchain
   npx hardhat run scripts/deploy.js --network localhost
   ```
   This compiles the contract, deploys it to the local node, and generates `blockchain/deployment.json`.

3. Update your root `.env`:
   ```ini
   FEATURE_ANCHORING=true
   CHAIN_RPC_URL=http://127.0.0.1:8545
   CHAIN_ID=31337
   ANCHOR_CONTRACT_ADDRESS=<address from blockchain/deployment.json>
   ANCHOR_PRIVATE_KEY=<one of the private keys printed by hardhat node>
   EXPLORER_BASE_URL=
   ```

---

## 2. Sepolia Testnet Setup

### A. Create a Dedicated Throwaway Wallet
1. Install MetaMask, Rabby, or use an offline key generator:
   ```bash
   node -e "console.log(require('ethers').Wallet.createRandom())"
   ```
2. Note the public address and export the private key.
3. Label this account strictly as **"EvidenceGuard Dev Throwaway"**.

### B. Obtain Sepolia Testnet ETH (Faucet)
Ethereum testnet transactions require test ETH for gas:
- **Google Cloud Web3 Faucet**: [cloud.google.com/application/web3/faucet/ethereum/sepolia](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
- **Alchemy Sepolia Faucet**: [sepoliafaucet.com](https://sepoliafaucet.com)
- **Infura Sepolia Faucet**: [infura.io/faucet/sepolia](https://infura.io/faucet/sepolia)
- **PoW Faucet**: [sepolia-faucet.pk910.de](https://sepolia-faucet.pk910.de)

A balance of `0.05 SepoliaETH` is more than enough for hundreds of anchoring batches.

### C. RPC Provider Setup
Acquire a free JSON-RPC endpoint for Sepolia from:
- **Alchemy**: Create an app and copy the HTTPS URL (`https://eth-sepolia.g.alchemy.com/v2/<API_KEY>`).
- **Infura**: Create a project and select network Sepolia (`https://sepolia.infura.io/v3/<API_KEY>`).
- **QuickNode**: Create an endpoint for Ethereum Sepolia.
- Or use a public RPC (e.g. `https://rpc.sepolia.org`).

### D. Deploy Contract to Sepolia
1. In your root `.env`, configure:
   ```ini
   CHAIN_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
   DEPLOYER_PRIVATE_KEY=your_throwaway_wallet_private_key_without_0x
   ETHERSCAN_API_KEY=your_etherscan_api_key_optional_for_verification
   ```

2. Run the deployment script:
   ```bash
   cd blockchain
   npx hardhat run scripts/deploy.js --network sepolia
   ```

3. The script will output the deployed contract address and save `blockchain/deployment.json`.

4. Update your EvidenceGuard backend configuration:
   ```ini
   FEATURE_ANCHORING=true
   CHAIN_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY
   CHAIN_ID=11155111
   ANCHOR_CONTRACT_ADDRESS=<deployed_address>
   ANCHOR_PRIVATE_KEY=your_throwaway_wallet_private_key
   EXPLORER_BASE_URL=https://sepolia.etherscan.io
   ANCHOR_CONFIRMATIONS=2
   ANCHOR_BATCH_SIZE=10
   ANCHOR_INTERVAL_MIN=15
   MAX_GAS_GWEI=50
   ```

---

## 3. Privacy & On-Chain Data Architecture
- **Zero Personal Data**: EvidenceGuard anchors **only** Merkle roots (`bytes32`), block sequence indices (`uint64 fromBlock, uint64 toBlock`), and timestamp.
- Evidence files, plaintexts, names, suspect identities, or case numbers are **NEVER** transmitted to or stored on the Ethereum blockchain.
- Even if the smart contract is publicly inspected on Etherscan, all that is visible is a 32-byte hash and a block sequence range.
