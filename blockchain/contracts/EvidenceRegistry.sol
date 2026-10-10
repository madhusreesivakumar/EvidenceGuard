// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EvidenceRegistry
 * @dev Simple Solidity smart contract for anchoring evidence SHA-256 hashes 
 * and metadata on Ethereum Sepolia Testnet for tamper-evident verification.
 */
contract EvidenceRegistry {
    
    // Struct to store complete evidence record on-chain
    struct Evidence {
        string evidenceId;
        string sha256Hash;
        string evidenceName;
        string evidenceType;
        string description;
        uint256 timestamp;
        address uploader;
        bool exists;
    }

    // Mapping from unique evidenceId string to Evidence record
    mapping(string => Evidence) private _evidences;

    // Array to store all registered evidence IDs for listing/enumeration
    string[] private _evidenceIds;

    // Event emitted when new evidence is registered
    event EvidenceRegistered(
        string indexed evidenceId,
        string sha256Hash,
        string evidenceName,
        address indexed uploader,
        uint256 timestamp
    );

    /**
     * @notice Register a new evidence record on-chain
     * @param evidenceId Unique application-generated evidence ID
     * @param sha256Hash SHA-256 hash of the evidence file
     * @param evidenceName Name/Title of the evidence file
     * @param evidenceType Type/Extension of the evidence (e.g. PDF, Image, Video)
     * @param description Brief optional details about the evidence
     */
    function registerEvidence(
        string memory evidenceId,
        string memory sha256Hash,
        string memory evidenceName,
        string memory evidenceType,
        string memory description
    ) external {
        require(bytes(evidenceId).length > 0, "Evidence ID cannot be empty");
        require(bytes(sha256Hash).length > 0, "SHA-256 hash cannot be empty");
        require(!_evidences[evidenceId].exists, "Evidence ID already registered");

        _evidences[evidenceId] = Evidence({
            evidenceId: evidenceId,
            sha256Hash: sha256Hash,
            evidenceName: evidenceName,
            evidenceType: evidenceType,
            description: description,
            timestamp: block.timestamp,
            uploader: msg.sender,
            exists: true
        });

        _evidenceIds.push(evidenceId);

        emit EvidenceRegistered(
            evidenceId,
            sha256Hash,
            evidenceName,
            msg.sender,
            block.timestamp
        );
    }

    /**
     * @notice Check if evidence with given ID exists on-chain
     * @param evidenceId Unique ID of the evidence
     */
    function evidenceExists(string memory evidenceId) external view returns (bool) {
        return _evidences[evidenceId].exists;
    }

    /**
     * @notice Retrieve details of registered evidence by evidence ID
     * @param evidenceId Unique ID of the evidence
     */
    function getEvidence(string memory evidenceId) external view returns (
        string memory id,
        string memory sha256Hash,
        string memory evidenceName,
        string memory evidenceType,
        string memory description,
        uint256 timestamp,
        address uploader
    ) {
        require(_evidences[evidenceId].exists, "Evidence not found on-chain");
        Evidence storage e = _evidences[evidenceId];
        return (
            e.evidenceId,
            e.sha256Hash,
            e.evidenceName,
            e.evidenceType,
            e.description,
            e.timestamp,
            e.uploader
        );
    }

    /**
     * @notice Returns total number of registered evidence records
     */
    function getEvidenceCount() external view returns (uint256) {
        return _evidenceIds.length;
    }

    /**
     * @notice Returns evidence ID at specified index
     */
    function getEvidenceIdByIndex(uint256 index) external view returns (string memory) {
        require(index < _evidenceIds.length, "Index out of bounds");
        return _evidenceIds[index];
    }
}
