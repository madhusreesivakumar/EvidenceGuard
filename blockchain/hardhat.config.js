require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config({ path: '../.env' });

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: process.env.LOCAL_CHAIN_RPC_URL || 'http://127.0.0.1:8545',
      chainId: 31337
    }
  }
};

// Add Sepolia only if RPC URL is defined
if (process.env.CHAIN_RPC_URL || process.env.SEPOLIA_RPC_URL) {
  const rpcUrl = process.env.CHAIN_RPC_URL || process.env.SEPOLIA_RPC_URL;
  const accounts = [];

  const pk = process.env.ANCHOR_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (pk) {
    accounts.push(pk.startsWith('0x') ? pk : `0x${pk}`);
  }

  config.networks.sepolia = {
    url: rpcUrl,
    chainId: 11155111,
    accounts
  };
}

if (process.env.ETHERSCAN_API_KEY) {
  config.etherscan = {
    apiKey: process.env.ETHERSCAN_API_KEY
  };
}

module.exports = config;
