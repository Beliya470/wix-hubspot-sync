/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('contact_id_map', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    installation_id: {
      type: 'uuid',
      notNull: true,
      references: 'installations(id)',
      onDelete: 'CASCADE',
    },
    wix_contact_id: { type: 'text', notNull: true },
    hubspot_contact_id: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // The (wix_contact_id, hubspot_contact_id) pair is the link between systems
  // and must be unique inside an installation.
  pgm.addConstraint('contact_id_map', 'contact_id_map_unique_pair', {
    unique: ['installation_id', 'wix_contact_id', 'hubspot_contact_id'],
  });

  // These two extra unique indexes guarantee that no Wix contact is bound to
  // more than one HubSpot contact, and vice versa.
  pgm.addConstraint('contact_id_map', 'contact_id_map_unique_wix', {
    unique: ['installation_id', 'wix_contact_id'],
  });
  pgm.addConstraint('contact_id_map', 'contact_id_map_unique_hubspot', {
    unique: ['installation_id', 'hubspot_contact_id'],
  });
};

exports.down = (pgm) => {
  pgm.dropTable('contact_id_map');
};
