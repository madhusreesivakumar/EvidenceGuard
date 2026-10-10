'use strict';

/**
 * blockchain/scripts/deploy-sepolia.js
 * Deployment Script for EvidenceRegistry Smart Contract on Ethereum Sepolia Testnet
 */

const { ethers } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL || process.env.CHAIN_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com');
  
  let pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.ANCHOR_PRIVATE_KEY;
  if (!pk) {
    console.error('❌ Error: DEPLOYER_PRIVATE_KEY is missing in .env file.');
    console.error('Please add DEPLOYER_PRIVATE_KEY=your_private_key to your .env file to deploy to Sepolia.');
    process.exit(1);
  }

  if (!pk.startsWith('0x')) pk = '0x' + pk;
  const wallet = new ethers.Wallet(pk, provider);

  console.log('======================================================================');
  console.log('             EvidenceGuard – Sepolia Smart Contract Deployment        ');
  console.log('======================================================================');
  console.log(`Network:     Ethereum Sepolia Testnet (Chain ID: 11155111)`);
  console.log(`Deployer:    ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance:     ${ethers.formatEther(balance)} Sepolia ETH`);

  if (balance === 0n) {
    console.error('❌ Error: Deployer wallet has 0 Sepolia ETH. Send Sepolia ETH to ' + wallet.address);
    process.exit(1);
  }

  console.log('\nDeploying EvidenceRegistry contract to Sepolia...');
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'EvidenceRegistry.sol', 'EvidenceRegistry.json');
  if (!fs.existsSync(artifactPath)) {
    console.error('❌ Contract artifact not found. Please run: npx hardhat compile');
    process.exit(1);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = await deployTx.wait();

  console.log(`✅ EvidenceRegistry deployed to Sepolia at: ${contractAddress}`);
  console.log(`   Transaction hash:                       ${deployTx.hash}`);
  console.log(`   Block number:                           ${receipt.blockNumber}`);

  const deploymentData = {
    address: contractAddress,
    network: 'sepolia',
    chainId: 11155111,
    deployBlock: Number(receipt.blockNumber),
    deployer: wallet.address,
    txHash: deployTx.hash,
    deployedAt: new Date().toISOString()
  };

  const deploymentPath = path.join(__dirname, '..', 'deployment.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployment info written to: ${deploymentPath}`);

  const frontendContractConfig = {
    address: contractAddress,
    network: 'sepolia',
    chainId: 11155111,
    abi: artifact.abi
  };

  const publicConfigPath = path.join(__dirname, '..', '..', 'public', 'contract-config.json');
  fs.writeFileSync(publicConfigPath, JSON.stringify(frontendContractConfig, null, 2));
  console.log(`Frontend contract configuration written to: ${publicConfigPath}`);

  console.log('\n======================================================================');
}

main().catch((err) => {
  console.error('Deployment Error:', err);
  process.exit(1);
});
