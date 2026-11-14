import {slackNoticeJourney} from '/workspace/run-happytohelp/tests/helpers/notify/slack-notices.mjs';
await slackNoticeJourney();
console.log('PASS slackNoticeJourney');
