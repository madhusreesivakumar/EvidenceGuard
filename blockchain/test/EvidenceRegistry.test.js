const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("EvidenceRegistry Smart Contract", function () {
  let contract;
  let owner;
  let addr1;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    const EvidenceRegistry = await ethers.getContractFactory("EvidenceRegistry");
    contract = await EvidenceRegistry.deploy();
    await contract.waitForDeployment();
  });

  it("should register new evidence and emit EvidenceRegistered event", async function () {
    const evId = "EVD-2026-0001";
    const hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
    const name = "Crime_Scene_Photo.png";
    const type = "Image";
    const desc = "Main entrance surveillance frame";

    await expect(contract.connect(owner).registerEvidence(evId, hash, name, type, desc))
      .to.emit(contract, "EvidenceRegistered");

    expect(await contract.evidenceExists(evId)).to.be.true;
    
    const data = await contract.getEvidence(evId);
    expect(data[0]).to.equal(evId);
    expect(data[1]).to.equal(hash);
    expect(data[2]).to.equal(name);
    expect(data[3]).to.equal(type);
    expect(data[4]).to.equal(desc);
    expect(data[6]).to.equal(owner.address);
  });

  it("should prevent duplicate evidence IDs", async function () {
    const evId = "EVD-2026-0002";
    const hash = "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3";

    await contract.registerEvidence(evId, hash, "Doc.pdf", "Document", "Initial upload");

    await expect(
      contract.registerEvidence(evId, hash, "Doc2.pdf", "Document", "Duplicate upload")
    ).to.be.revertedWith("Evidence ID already registered");
  });
});
