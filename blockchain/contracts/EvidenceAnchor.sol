// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title EvidenceAnchor
 * @dev Anchors periodic Merkle roots of the EvidenceGuard hash-chain ledger to Ethereum.
 *
 * Requirements:
 * - Stores hashes and block bounds only; NEVER stores personal data, file names, or evidence IDs.
 * - Enforces contiguous block intervals: fromBlock == lastAnchoredTo + 1 (no gaps, no overlaps).
 * - Restricts anchoring to accounts with ANCHORER_ROLE.
 * - Allows DEFAULT_ADMIN_ROLE to grant or revoke ANCHORER_ROLE.
 */
contract EvidenceAnchor is AccessControl {
    bytes32 public constant ANCHORER_ROLE = keccak256("ANCHORER_ROLE");

    struct Anchor {
        bytes32 merkleRoot;
        uint64 fromBlock;
        uint64 toBlock;
        uint64 leafCount;
        uint64 anchoredAt;
    }

    Anchor[] private _anchors;
    uint64 public lastAnchoredTo;

    event Anchored(
        uint256 indexed id,
        bytes32 indexed root,
        uint64 fromBlock,
        uint64 toBlock,
        uint64 leafCount,
        address sender
    );

    /**
     * @dev Initializes contract, granting DEFAULT_ADMIN_ROLE and ANCHORER_ROLE to deployer.
     */
    constructor(address initialAdmin) {
        address admin = initialAdmin != address(0) ? initialAdmin : msg.sender;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ANCHORER_ROLE, admin);
    }

    /**
     * @notice Anchors a batch of blocks by recording their Merkle root and block sequence range.
     * @param root The Merkle root hash of the block batch.
     * @param fromBlock The starting block index (inclusive).
     * @param toBlock The ending block index (inclusive).
     * @param leafCount The number of blocks/leaves in the Merkle tree.
     */
    function anchor(
        bytes32 root,
        uint64 fromBlock,
        uint64 toBlock,
        uint64 leafCount
    ) external onlyRole(ANCHORER_ROLE) {
        require(root != bytes32(0), "Invalid Merkle root");
        require(fromBlock <= toBlock, "Invalid block range");
        require(fromBlock == lastAnchoredTo + 1, "Non-contiguous block range");
        require(leafCount > 0, "Leaf count must be positive");

        uint64 anchoredAt = uint64(block.timestamp);

        _anchors.push(Anchor({
            merkleRoot: root,
            fromBlock: fromBlock,
            toBlock: toBlock,
            leafCount: leafCount,
            anchoredAt: anchoredAt
        }));

        lastAnchoredTo = toBlock;
        uint256 id = _anchors.length - 1;

        emit Anchored(id, root, fromBlock, toBlock, leafCount, msg.sender);
    }

    /**
     * @notice Returns total number of anchors recorded.
     */
    function anchorCount() external view returns (uint256) {
        return _anchors.length;
    }

    /**
     * @notice Returns details of a specific anchor by id.
     * @param id The zero-based anchor index.
     */
    function getAnchor(uint256 id) external view returns (
        bytes32 merkleRoot,
        uint64 fromBlock,
        uint64 toBlock,
        uint64 leafCount,
        uint64 anchoredAt
    ) {
        require(id < _anchors.length, "Anchor does not exist");
        Anchor storage a = _anchors[id];
        return (a.merkleRoot, a.fromBlock, a.toBlock, a.leafCount, a.anchoredAt);
    }
}
