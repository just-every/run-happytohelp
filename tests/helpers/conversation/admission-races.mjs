import {modelWriterRaces} from './model-races.mjs'
import {importWriterRaces} from './import-races.mjs'
import {lostFinalReplyResponse} from './lost-response.mjs'

export async function admissionRaces(){
 await modelWriterRaces()
 await importWriterRaces()
 await lostFinalReplyResponse()
}
