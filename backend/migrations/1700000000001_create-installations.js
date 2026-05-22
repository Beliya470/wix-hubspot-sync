/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('installations', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    wix_instance_id: { type: 'text', notNull: true, unique: true },
    hubspot_portal_id: { type: 'bigint', notNull: false },
    status: { type: 'text', notNull: true, default: 'pending' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('installations', 'hubspot_portal_id');
};

exports.down = (pgm) => {
  pgm.dropTable('installations');
};
