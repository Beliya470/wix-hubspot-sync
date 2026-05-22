/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('hubspot_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    installation_id: {
      type: 'uuid',
      notNull: true,
      references: 'installations(id)',
      onDelete: 'CASCADE',
      unique: true,
    },
    // Ciphertext columns store AES-256-GCM output as base64. Encryption is
    // applied in the app layer (see backend/src/crypto.ts) because the key
    // lives in the process env, not in Postgres.
    access_token_ciphertext: { type: 'text', notNull: true },
    access_token_iv: { type: 'text', notNull: true },
    access_token_tag: { type: 'text', notNull: true },
    refresh_token_ciphertext: { type: 'text', notNull: true },
    refresh_token_iv: { type: 'text', notNull: true },
    refresh_token_tag: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    portal_id: { type: 'bigint', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createIndex('hubspot_tokens', 'portal_id');
};

exports.down = (pgm) => {
  pgm.dropTable('hubspot_tokens');
};
