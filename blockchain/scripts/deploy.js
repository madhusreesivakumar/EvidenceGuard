'use strict';

/**
 * blockchain/scripts/deploy.js
 * Deployment Script for EvidenceRegistry Smart Contract
 */

const { ethers, network } = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log('======================================================================');
  console.log('             EvidenceGuard – Smart Contract Deployment                ');
  console.log('======================================================================');
  console.log(`Network:     ${networkName} (Chain ID: ${chainId})`);
  console.log(`Deployer:    ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:     ${ethers.formatEther(balance)} ETH`);

  console.log('\nDeploying EvidenceRegistry contract...');
  const EvidenceRegistry = await ethers.getContractFactory('EvidenceRegistry');
  const contract = await EvidenceRegistry.deploy();
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  const deployTx = contract.deploymentTransaction();
  const receipt = await deployTx.wait();
  const deployBlock = receipt.blockNumber;

  console.log(`✅ EvidenceRegistry deployed to: ${contractAddress}`);
  console.log(`   Transaction hash:          ${deployTx.hash}`);
  console.log(`   Block number:              ${deployBlock}`);

  const deploymentData = {
    address: contractAddress,
    network: networkName,
    chainId: Number(chainId),
    deployBlock: Number(deployBlock),
    deployer: deployer.address,
    txHash: deployTx.hash,
    deployedAt: new Date().toISOString()
  };

  // Write deployment.json in blockchain folder
  const deploymentPath = path.join(__dirname, '..', 'deployment.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployment info written to: ${deploymentPath}`);

  // Write contract address & ABI to public folder for frontend consumption
  const artifactPath = path.join(__dirname, '..', 'artifacts', 'contracts', 'EvidenceRegistry.sol', 'EvidenceRegistry.json');
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const frontendContractConfig = {
      address: contractAddress,
      network: networkName,
      chainId: Number(chainId),
      abi: artifact.abi
    };
    
    const publicConfigPath = path.join(__dirname, '..', '..', 'public', 'contract-config.json');
    fs.writeFileSync(publicConfigPath, JSON.stringify(frontendContractConfig, null, 2));
    console.log(`Frontend contract configuration written to: ${publicConfigPath}`);
  }

  console.log('\n======================================================================');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FATAL Deployment Error:', err);
    process.exit(1);
  });
