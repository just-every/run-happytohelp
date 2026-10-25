/** Token operations must not revive a contact's erased conversation. */
export const contactAvailableSql=(conversation='c')=>`EXISTS(SELECT 1 FROM contacts privacy_contact WHERE privacy_contact.id=${conversation}.contact_id AND privacy_contact.project_id=${conversation}.project_id AND COALESCE(json_extract(privacy_contact.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(privacy_contact.metadata_json,'$.is_erased'),0)!=1)`

