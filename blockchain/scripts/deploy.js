'use strict';

/**
 * blockchain/scripts/deploy.js
 * Sprint 10A – EvidenceAnchor Deployment Script
 *
 * Deploys EvidenceAnchor contract, writes deployment.json, and optionally
 * verifies contract source on Etherscan/block explorer.
 */

const { ethers, network, run } = require('hardhat');
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

  console.log('\nDeploying EvidenceAnchor...');
  const EvidenceAnchor = await ethers.getContractFactory('EvidenceAnchor');
  const anchorContract = await EvidenceAnchor.deploy(deployer.address);
  await anchorContract.waitForDeployment();

  const contractAddress = await anchorContract.getAddress();
  const deployTx = anchorContract.deploymentTransaction();
  const receipt = await deployTx.wait();
  const deployBlock = receipt.blockNumber;

  console.log(`✅ EvidenceAnchor deployed to: ${contractAddress}`);
  console.log(`   Transaction hash:          ${deployTx.hash}`);
  console.log(`   Block number:              ${deployBlock}`);
  console.log(`   Gas used:                  ${receipt.gasUsed.toString()}`);

  const deploymentData = {
    address: contractAddress,
    network: networkName,
    chainId: Number(chainId),
    deployBlock: Number(deployBlock),
    deployer: deployer.address,
    txHash: deployTx.hash,
    deployedAt: new Date().toISOString()
  };

  const deploymentPath = path.join(__dirname, '..', 'deployment.json');
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentData, null, 2));
  console.log(`\nDeployment details written to: ${deploymentPath}`);

  // Optional verification on block explorer
  if (networkName !== 'hardhat' && networkName !== 'localhost' && process.env.ETHERSCAN_API_KEY) {
    console.log('\nWaiting for 5 block confirmations before explorer verification...');
    await deployTx.wait(5);
    try {
      await run('verify:verify', {
        address: contractAddress,
        constructorArguments: [deployer.address]
      });
      console.log('✅ Source code successfully verified on explorer.');
    } catch (verifyErr) {
      console.warn('⚠️ Explorer verification note:', verifyErr.message);
    }
  }

  console.log('\n======================================================================');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('FATAL Deployment Error:', err);
    process.exit(1);
  });
