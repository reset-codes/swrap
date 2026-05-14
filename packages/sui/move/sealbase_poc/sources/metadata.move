/// POC-only metadata anchor for SEALBASE Walrus blobs.
/// NOT production. Fields are intentionally small and the module has no upgrade path.
module sealbase_poc::metadata {
    use sui::event;
    use sui::object::{Self, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use std::option::{Self, Option};
    use std::vector;

    /// record_type encoding
    const RECORD_TYPE_FORM: u8 = 1;
    const RECORD_TYPE_SUBMISSION: u8 = 2;

    /// Errors
    const EInvalidRecordType: u64 = 1;
    const EInvalidBlobId: u64 = 2;
    const EInvalidSchemaHash: u64 = 3;

    /// Owned on-chain anchor. Stores ONLY references/hashes — never plaintext.
    public struct MetadataRecord has key, store {
        id:             UID,
        blob_id:        vector<u8>,   // Walrus blob id as UTF-8 bytes
        schema_hash:    vector<u8>,   // sha256 of canonical JSON — 32 bytes
        record_type:    u8,           // 1 = form, 2 = submission
        form_blob_id:   Option<vector<u8>>, // set iff record_type == 2
        owner_address:  address,
        created_at_ms:  u64,
    }

    /// Event emitted on anchor so clients can index without scanning owned objects.
    public struct MetadataAnchored has copy, drop {
        record_id:     address,
        blob_id:       vector<u8>,
        schema_hash:   vector<u8>,
        record_type:   u8,
        form_blob_id:  Option<vector<u8>>,
        owner_address: address,
        created_at_ms: u64,
    }

    /// Entry function called by the Metadata_Anchor from `@poc/sui`.
    public entry fun anchor_record(
        blob_id:      vector<u8>,
        schema_hash:  vector<u8>,
        record_type:  u8,
        form_blob_id: Option<vector<u8>>,
        ctx:          &mut TxContext,
    ) {
        assert!(record_type == RECORD_TYPE_FORM || record_type == RECORD_TYPE_SUBMISSION, EInvalidRecordType);
        assert!(vector::length(&blob_id) > 0, EInvalidBlobId);
        assert!(vector::length(&schema_hash) == 32, EInvalidSchemaHash);
        if (record_type == RECORD_TYPE_SUBMISSION) {
            assert!(option::is_some(&form_blob_id), EInvalidRecordType);
        } else {
            assert!(option::is_none(&form_blob_id), EInvalidRecordType);
        };

        let owner = tx_context::sender(ctx);
        let now   = tx_context::epoch_timestamp_ms(ctx);
        let record = MetadataRecord {
            id:             object::new(ctx),
            blob_id,
            schema_hash,
            record_type,
            form_blob_id,
            owner_address:  owner,
            created_at_ms:  now,
        };
        event::emit(MetadataAnchored {
            record_id:     object::uid_to_address(&record.id),
            blob_id:       record.blob_id,
            schema_hash:   record.schema_hash,
            record_type:   record.record_type,
            form_blob_id:  record.form_blob_id,
            owner_address: record.owner_address,
            created_at_ms: record.created_at_ms,
        });
        transfer::public_transfer(record, owner);
    }

    /// Seal_Approve (R7.8) — decentralized access control logic.
    /// Key servers execute this function via dry_run to authorize decryption.
    /// For the POC, we approve any request that reaches this function.
    public entry fun seal_approve(_id: vector<u8>) {
        // Success = approved. In production, this would check `_id` against
        // on-chain MetadataRecord ownership or an ACL.
    }
}
