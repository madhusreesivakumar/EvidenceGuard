'use strict';

/**
 * blockchain/test/EvidenceAnchor.test.js
 * Sprint 10A – EvidenceAnchor Hardhat Test Suite
 *
 * Verifies:
 * 1. Only ANCHORER_ROLE can anchor
 * 2. Contiguity enforcement (no gaps, no overlaps, fromBlock <= toBlock)
 * 3. Correct event emission (Anchored)
 * 4. Role management (Admin can grant/revoke ANCHORER_ROLE; non-admin cannot)
 * 5. View functions and anchor storage integrity
 * 6. Gas reporting per transaction
 */

const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('EvidenceAnchor Smart Contract', function () {
  let EvidenceAnchor;
  let contract;
  let admin, anchorer, stranger, otherAccount;
  let ANCHORER_ROLE, DEFAULT_ADMIN_ROLE;

  const sampleRoot1 = ethers.keccak256(ethers.toUtf8Bytes('sample_merkle_root_batch_1'));
  const sampleRoot2 = ethers.keccak256(ethers.toUtf8Bytes('sample_merkle_root_batch_2'));
  const sampleRoot3 = ethers.keccak256(ethers.toUtf8Bytes('sample_merkle_root_batch_3'));

  beforeEach(async function () {
    [admin, anchorer, stranger, otherAccount] = await ethers.getSigners();

    EvidenceAnchor = await ethers.getContractFactory('EvidenceAnchor');
    contract = await EvidenceAnchor.deploy(admin.address);
    await contract.waitForDeployment();

    ANCHORER_ROLE = await contract.ANCHORER_ROLE();
    DEFAULT_ADMIN_ROLE = await contract.DEFAULT_ADMIN_ROLE();

    // Grant ANCHORER_ROLE to anchorer account
    await contract.connect(admin).grantRole(ANCHORER_ROLE, anchorer.address);
  });

  describe('Deployment & Initial State', function () {
    it('grants DEFAULT_ADMIN_ROLE and ANCHORER_ROLE to the initial admin', async function () {
      expect(await contract.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.be.true;
      expect(await contract.hasRole(ANCHORER_ROLE, admin.address)).to.be.true;
    });

    it('initializes lastAnchoredTo to 0 and anchorCount to 0', async function () {
      expect(await contract.lastAnchoredTo()).to.equal(0);
      expect(await contract.anchorCount()).to.equal(0);
    });
  });

  describe('Role Management', function () {
    it('allows admin to grant ANCHORER_ROLE to another account', async function () {
      expect(await contract.hasRole(ANCHORER_ROLE, stranger.address)).to.be.false;
      await contract.connect(admin).grantRole(ANCHORER_ROLE, stranger.address);
      expect(await contract.hasRole(ANCHORER_ROLE, stranger.address)).to.be.true;
    });

    it('allows admin to revoke ANCHORER_ROLE', async function () {
      expect(await contract.hasRole(ANCHORER_ROLE, anchorer.address)).to.be.true;
      await contract.connect(admin).revokeRole(ANCHORER_ROLE, anchorer.address);
      expect(await contract.hasRole(ANCHORER_ROLE, anchorer.address)).to.be.false;
    });

    it('prevents non-admin accounts from granting roles', async function () {
      await expect(
        contract.connect(stranger).grantRole(ANCHORER_ROLE, stranger.address)
      ).to.be.reverted;
    });
  });

  describe('Access Control on anchor()', function () {
    it('allows accounts with ANCHORER_ROLE to anchor a batch', async function () {
      const tx = await contract.connect(anchorer).anchor(sampleRoot1, 1, 10, 10);
      const receipt = await tx.wait();
      expect(await contract.anchorCount()).to.equal(1);
      console.log(`       ⛽ Gas used for initial anchor: ${receipt.gasUsed.toString()}`);
    });

    it('reverts if caller does not have ANCHORER_ROLE', async function () {
      await expect(
        contract.connect(stranger).anchor(sampleRoot1, 1, 10, 10)
      ).to.be.reverted;
    });
  });

  describe('Contiguity Enforcement (No Gaps, No Overlaps)', function () {
    it('reverts if initial batch does not start at 1 (lastAnchoredTo + 1)', async function () {
      // Gap: starting at block 2 instead of 1
      await expect(
        contract.connect(anchorer).anchor(sampleRoot1, 2, 10, 9)
      ).to.be.revertedWith('Non-contiguous block range');
    });

    it('reverts if fromBlock is greater than toBlock', async function () {
      await expect(
        contract.connect(anchorer).anchor(sampleRoot1, 10, 5, 5)
      ).to.be.revertedWith('Invalid block range');
    });

    it('reverts if Merkle root is empty bytes32(0)', async function () {
      await expect(
        contract.connect(anchorer).anchor(ethers.ZeroHash, 1, 5, 5)
      ).to.be.revertedWith('Invalid Merkle root');
    });

    it('reverts if leafCount is zero', async function () {
      await expect(
        contract.connect(anchorer).anchor(sampleRoot1, 1, 5, 0)
      ).to.be.revertedWith('Leaf count must be positive');
    });

    it('reverts on overlap (second batch starting <= lastAnchoredTo)', async function () {
      // Batch 1: blocks 1 to 10
      await contract.connect(anchorer).anchor(sampleRoot1, 1, 10, 10);

      // Overlap: starting at block 10
      await expect(
        contract.connect(anchorer).anchor(sampleRoot2, 10, 20, 11)
      ).to.be.revertedWith('Non-contiguous block range');
    });

    it('reverts on gap (second batch starting > lastAnchoredTo + 1)', async function () {
      // Batch 1: blocks 1 to 10
      await contract.connect(anchorer).anchor(sampleRoot1, 1, 10, 10);

      // Gap: starting at block 12 instead of 11
      await expect(
        contract.connect(anchorer).anchor(sampleRoot2, 12, 20, 9)
      ).to.be.revertedWith('Non-contiguous block range');
    });

    it('allows sequential contiguous batches and updates lastAnchoredTo', async function () {
      // Batch 1: blocks 1 to 10
      await contract.connect(anchorer).anchor(sampleRoot1, 1, 10, 10);
      expect(await contract.lastAnchoredTo()).to.equal(10);

      // Batch 2: blocks 11 to 25
      const tx2 = await contract.connect(anchorer).anchor(sampleRoot2, 11, 25, 15);
      const r2 = await tx2.wait();
      expect(await contract.lastAnchoredTo()).to.equal(25);
      console.log(`       ⛽ Gas used for second anchor: ${r2.gasUsed.toString()}`);

      // Batch 3: blocks 26 to 26 (single block batch)
      await contract.connect(anchorer).anchor(sampleRoot3, 26, 26, 1);
      expect(await contract.lastAnchoredTo()).to.equal(26);
      expect(await contract.anchorCount()).to.equal(3);
    });
  });

  describe('Events & View Functions', function () {
    it('emits Anchored event with correct parameters', async function () {
      await expect(contract.connect(anchorer).anchor(sampleRoot1, 1, 10, 10))
        .to.emit(contract, 'Anchored')
        .withArgs(0, sampleRoot1, 1, 10, 10, anchorer.address);
    });

    it('getAnchor returns accurate recorded anchor details', async function () {
      await contract.connect(anchorer).anchor(sampleRoot1, 1, 10, 10);
      const a = await contract.getAnchor(0);

      expect(a.merkleRoot).to.equal(sampleRoot1);
      expect(a.fromBlock).to.equal(1);
      expect(a.toBlock).to.equal(10);
      expect(a.leafCount).to.equal(10);
      expect(a.anchoredAt).to.be.greaterThan(0);
    });

    it('reverts when querying non-existent anchor id', async function () {
      await expect(contract.getAnchor(999)).to.be.revertedWith('Anchor does not exist');
    });
  });
});
