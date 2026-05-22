/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createType('sync_direction', ['wix_to_hubspot', 'hubspot_to_wix', 'bidirectional']);

  pgm.createTable('field_mappings', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    installation_id: {
      type: 'uuid',
      notNull: true,
      references: 'installations(id)',
      onDelete: 'CASCADE',
    },
    wix_field: { type: 'text', notNull: true },
    hubspot_property: { type: 'text', notNull: true },
    direction: { type: 'sync_direction', notNull: true },
    // Transform identifier such as 'trim' or 'lowercase'. Null means identity.
    transform: { type: 'text', notNull: false },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Stops the same Wix field from being mapped twice for one installation.
  pgm.addConstraint('field_mappings', 'field_mappings_unique_wix_per_install', {
    unique: ['installation_id', 'wix_field'],
  });

  pgm.createIndex('field_mappings', 'installation_id');
};

exports.down = (pgm) => {
  pgm.dropTable('field_mappings');
  pgm.dropType('sync_direction');
};
