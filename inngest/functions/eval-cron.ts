// Automated eval cron. Runs every 3 days at 9 AM local time. Iterates
// every eval_dataset the user has defined, runs each one via the headless
// runner, compares the new pass rate against the previous run, and logs
// a warning event when a dataset drops by more than the threshold.
//
// Why 3 days: daily noise outweighs signal; weekly is too sparse to
// catch regressions before they bake in. 3-day cadence catches drift
// within one work week and stays under the Claude credit budget.
//
// To trigger manually for testing:
//   In the Inngest dev UI (npm run inngest), click "Trigger" on this fn.
//   Or send the event: inngest.send({ name: 'evals/requested' })

import { inngest, EVENTS } from '../client'
import { supabase } from '@/lib/supabase'
import { runDataset } from '@/lib/eval/run-dataset'

const REGRESSION_THRESHOLD_PP = 5

export const evalCron = inngest.createFunction(
  { id: 'eval-cron', name: 'Eval cron · every 3 days' },
  [
    // 9 AM every 3 days local-to-UTC offset handled by Inngest's
    // assumption (UTC). Subash is on Pacific, so 9 AM PT ≈ 16 UTC.
    { cron: '0 16 */3 * *' },
    { event: EVENTS.evalsRequested },
  ],
  async ({ step, logger }) => {
    const datasets = await step.run('list-datasets', async () => {
      const { data, error } = await supabase
        .from('eval_datasets')
        .select('id, user_id, name, prompt_id, description')
        .order('created_at', { ascending: true })
      if (error) throw new Error(`list datasets: ${error.message}`)
      return data ?? []
    })

    if (datasets.length === 0) {
      logger.info('No eval datasets to run. Cron exiting cleanly.')
      return { datasetsRun: 0, regressions: 0 }
    }

    logger.info(`Running ${datasets.length} eval dataset(s)`)

    const results: Array<{
      datasetName: string
      promptId: string
      passRate: number | null
      passed: number
      failed: number
      errored: number
      total: number
      previousPassRate: number | null
      deltaPP: number | null
      regressed: boolean
    }> = []

    for (const ds of datasets) {
      const summary = await step.run(`run-${ds.name}`, async () => {
        return runDataset({
          userId: ds.user_id,
          datasetId: ds.id,
          datasetName: ds.name,
          promptId: ds.prompt_id,
          notes: `cron · 3-day automated · ${new Date().toISOString().slice(0, 10)}`,
        })
      })

      const previousPassRate = await step.run(`prev-${ds.name}`, async () => {
        const { data, error } = await supabase
          .from('eval_runs')
          .select('passed, failed, started_at')
          .eq('dataset_id', ds.id)
          .not('ended_at', 'is', null)
          .order('started_at', { ascending: false })
          .range(1, 1)
          .maybeSingle()
        if (error || !data) return null
        const denom = data.passed + data.failed
        return denom > 0 ? data.passed / denom : null
      })

      const deltaPP =
        summary.passRate !== null && previousPassRate !== null
          ? (summary.passRate - previousPassRate) * 100
          : null
      const regressed = deltaPP !== null && deltaPP < -REGRESSION_THRESHOLD_PP

      if (regressed) {
        await step.run(`alert-${ds.name}`, async () => {
          await supabase.from('agent_events').insert({
            user_id: ds.user_id,
            kind: 'eval.regression',
            payload: {
              dataset: ds.name,
              prompt_id: ds.prompt_id,
              pass_rate: summary.passRate,
              previous_pass_rate: previousPassRate,
              delta_pp: deltaPP,
              passed: summary.passed,
              failed: summary.failed,
              errored: summary.errored,
              run_id: summary.runId,
            },
          })
          logger.warn(
            `[eval-cron] regression on ${ds.name}: ${(previousPassRate! * 100).toFixed(1)}% → ${(summary.passRate! * 100).toFixed(1)}% (Δ${deltaPP!.toFixed(1)}pp)`
          )
        })
      } else {
        logger.info(
          `[eval-cron] ${ds.name}: ${summary.passed}/${summary.passed + summary.failed} pass · ` +
            (deltaPP !== null ? `Δ${deltaPP >= 0 ? '+' : ''}${deltaPP.toFixed(1)}pp` : 'first run')
        )
      }

      results.push({
        datasetName: ds.name,
        promptId: ds.prompt_id,
        passRate: summary.passRate,
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        total: summary.total,
        previousPassRate,
        deltaPP,
        regressed,
      })
    }

    await step.run('log-summary', async () => {
      const sampleUser = datasets[0].user_id
      await supabase.from('agent_events').insert({
        user_id: sampleUser,
        kind: 'eval.cron_completed',
        payload: {
          datasets_run: results.length,
          regressions: results.filter(r => r.regressed).length,
          summary: results.map(r => ({
            dataset: r.datasetName,
            pass_rate: r.passRate,
            delta_pp: r.deltaPP,
          })),
        },
      })
    })

    return {
      datasetsRun: results.length,
      regressions: results.filter(r => r.regressed).length,
      results,
    }
  }
)
