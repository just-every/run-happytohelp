import worker from '../../journeys/kit/app-worker'
import {withLocalOwner} from '../../../src/dev/owner-entry'
export {ConversationSocket} from '../../journeys/kit/app-worker'
export default withLocalOwner(worker)
