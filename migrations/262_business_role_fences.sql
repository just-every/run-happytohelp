-- Business actions share the integration authority epoch with credential custody.
CREATE TRIGGER business_epoch_member_roles_insert AFTER INSERT ON member_roles BEGIN UPDATE integration_authority_epoch SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER business_epoch_member_roles_update AFTER UPDATE ON member_roles BEGIN UPDATE integration_authority_epoch SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER business_epoch_member_roles_delete AFTER DELETE ON member_roles BEGIN UPDATE integration_authority_epoch SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER business_epoch_project_roles_insert AFTER INSERT ON project_roles BEGIN UPDATE integration_authority_epoch SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER business_epoch_project_roles_update AFTER UPDATE ON project_roles BEGIN UPDATE integration_authority_epoch SET revision=revision+1 WHERE id=1; END;
CREATE TRIGGER business_epoch_project_roles_delete AFTER DELETE ON project_roles BEGIN UPDATE integration_authority_epoch SET revision=revision+1 WHERE id=1; END;
