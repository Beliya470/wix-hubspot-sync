/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('sync_origin', ['wix', 'hubspot', 'form', 'manual']);
  pgm.createType('sync_status', ['started', 'skipped', 'succeeded', 'failed']);

  pgm.createTable('sync_log', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    installation_id: {
      type: 'uuid',
      notNull: true,
      references: 'installations(id)',
      onDelete: 'CASCADE',
    },
    // Origin tells us which system kicked off the work. Combined with the
    // dedupe window in sync_engine, an inbound webhook can recognise that an
    // event was caused by a write we just performed.
    origin: { type: 'sync_origin', notNull: true },
    direction: { type: 'sync_direction', notNull: true },
    correlation_id: { type: 'uuid', notNull: true },
    wix_contact_id: { type: 'text', notNull: false },
    hubspot_contact_id: { type: 'text', notNull: false },
    status: { type: 'sync_status', notNull: true },
    // Stable hash of the payload we wrote. Used as an idempotency token so
    // that repeating the same write is a no-op.
    payload_hash: { type: 'text', notNull: false },
    error_message: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('sync_log', 'installation_id');
  pgm.createIndex('sync_log', 'correlation_id');
  pgm.createIndex('sync_log', ['installation_id', 'hubspot_contact_id', 'created_at']);
  pgm.createIndex('sync_log', ['installation_id', 'wix_contact_id', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('sync_log');
  pgm.dropType('sync_status');
  pgm.dropType('sync_origin');
};
