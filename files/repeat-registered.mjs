// Each import registers the unchanged journey through node:test. Its default
// top-level concurrency is one; --test-concurrency=1 also serializes test files.
for(let iteration=1;iteration<=20;iteration++){
 await import(new URL('file:///workspace/run-happytohelp/tests/journeys/workflows-browser.mjs?repeat='+iteration));
}
