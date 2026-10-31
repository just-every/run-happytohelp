import assert from 'node:assert/strict'
import {archivePolicy} from '../../scripts/installer/portability-policy.mjs'

const archived=archivePolicy.exportRow('helpscout_connections',{project_id:'p',secret_ciphertext:'secret',claim:'claim',claim_until:99,cursor:'retained'});assert.equal(archived.secret_ciphertext,null);assert.equal(archived.cursor,'retained');assert.equal(archivePolicy.importRow('helpscout_connections',{...archived,secret_ciphertext:'old-secret'}).secret_ciphertext,null)
