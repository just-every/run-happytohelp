# Exact-head Verify jobs

Run Edit Run fleet, 2026-11-17 UTC.

Run 44107579411, head 64f10a3948135a164d878c7313be6c45aafacf8f. Job states read at 2026-11-17T15:22:16Z: 14 succeeded, 2 intentionally skipped, none failed, all completed on the exact candidate SHA. This includes all eight push shards, source/build/contract/size checks, full-push-proof and the aggregate verify job.

The repaired identity-and-repair-browser shard is job 134125102101, success at 15:05:36Z. The repaired support-workflow-browser shard is job 134125102038, success at 15:11:07Z. The final aggregate verify job is 134143553075, success at 15:20:00Z. No failed-job retry was required.

The longest remaining support-and-recovery shard completed at 15:19:41Z. The extended wait was the full workflow’s actual runtime; this repair does not change its scheduling or timeout configuration.

The final overall workflow read at 2026-11-17T15:27:34Z confirmed completed/success on the exact SHA. ci-final.json and receipt.json retain that actual response and terminal custody.
