'use strict';

/**
 * Daily Telegram business report digest (POS desktop / server mode).
 * Interval is frequent; runDailyDigestTick enforces schedule_time + once-per-day gate.
 */
function createReportDigestScheduler({
  getDb,
  enabled = true,
  intervalMs = 15 * 60 * 1000,
}) {
  let timer = null;
  let startupTimer = null;

  async function tick(source = 'scheduler') {
    try {
      const db = typeof getDb === 'function' ? getDb() : null;
      if (!db) return;
      try {
        require('../config/loadRootEnv.cjs').loadRootEnv();
      } catch {
        // ignore
      }
      const { runDailyDigestTick, resolveBotToken } = require('../../public-api/lib/reportNotify.cjs');
      const botToken = resolveBotToken({});
      const stats = await runDailyDigestTick(db, {
        botToken,
        source,
      });
      if (
        stats?.skipped &&
        (stats.reason === 'before_schedule' ||
          stats.reason === 'already_ran_today' ||
          stats.reason === 'lock_held' ||
          stats.reason === 'disabled' ||
          stats.reason === 'merged_into_evening_package')
      ) {
        // still try AI below (own enable + last_run gate)
      } else if (stats?.sent > 0 || (stats && !stats.skipped)) {
        console.log(
          `[report-digest] ${source}: sent=${stats.sent || 0} failed=${stats.failed || 0}${stats?.reason ? ` reason=${stats.reason}` : ''}`,
        );
      }

      // Phase 0.5: morning brief (~08:00) — short Top 3 focus, separate from evening
      try {
        const { runMorningBriefTick } = require('../../public-api/lib/storeAiAnalysis.cjs');
        const morningStats = await runMorningBriefTick(db, { botToken, source });
        if (
          morningStats?.skipped &&
          (morningStats.reason === 'before_schedule' ||
            morningStats.reason === 'already_ran_today' ||
            morningStats.reason === 'lock_held' ||
            morningStats.reason === 'disabled' ||
            morningStats.reason === 'morning_brief_disabled' ||
            morningStats.reason === 'after_evening_window')
        ) {
          // continue to evening digest / AI
        } else if (morningStats?.sent > 0 || (morningStats && !morningStats.skipped)) {
          console.log(
            `[report-morning] ${source}: sent=${morningStats.sent || 0}${morningStats?.reason ? ` reason=${morningStats.reason}` : ''}`,
          );
        }
      } catch (morningErr) {
        console.warn('[report-morning] tick failed:', morningErr?.message || morningErr);
      }

      // Phase 1: AI store analysis — evening schedule_time, after daily digest attempt
      try {
        const {
          runAiAnalysisTick,
          runWeeklyAiTick,
          resolveOpenAiConfig,
        } = require('../../public-api/lib/storeAiAnalysis.cjs');
        const { apiKey, model } = resolveOpenAiConfig({});
        const aiStats = await runAiAnalysisTick(db, {
          botToken,
          source,
          apiKey,
          model,
        });
        if (
          aiStats?.skipped &&
          (aiStats.reason === 'before_schedule' ||
            aiStats.reason === 'already_ran_today' ||
            aiStats.reason === 'lock_held' ||
            aiStats.reason === 'disabled' ||
            aiStats.reason === 'ai_disabled')
        ) {
          // continue to weekly
        } else if (aiStats?.sent > 0 || (aiStats && !aiStats.skipped)) {
          console.log(
            `[report-ai] ${source}: sent=${aiStats.sent || 0} mode=${aiStats.mode || '?'}${aiStats?.fallbackReason ? ` fallback=${aiStats.fallbackReason}` : ''}${aiStats?.eveningPackage ? ' evening_package=1' : ''}`,
          );
        }

        const weeklyStats = await runWeeklyAiTick(db, {
          botToken,
          source,
          apiKey,
          model,
        });
        if (
          weeklyStats?.skipped &&
          (weeklyStats.reason === 'before_schedule' ||
            weeklyStats.reason === 'wrong_weekday' ||
            weeklyStats.reason === 'already_ran_this_week' ||
            weeklyStats.reason === 'lock_held' ||
            weeklyStats.reason === 'disabled' ||
            weeklyStats.reason === 'weekly_ai_disabled')
        ) {
          // continue to daily poster
        } else if (weeklyStats?.sent > 0 || (weeklyStats && !weeklyStats.skipped)) {
          console.log(
            `[report-weekly] ${source}: sent=${weeklyStats.sent || 0}${weeklyStats?.weekKey ? ` week=${weeklyStats.weekKey}` : ''}`,
          );
        }
      } catch (aiErr) {
        console.warn('[report-ai] tick failed:', aiErr?.message || aiErr);
      }

      // Daily marketing poster (public channel) — own enable + schedule + once/day
      try {
        const { runDailyPosterTick } = require('../../public-api/lib/dailyStorePoster.cjs');
        const posterStats = await runDailyPosterTick(db, { source });
        if (
          posterStats?.skipped &&
          (posterStats.reason === 'before_schedule' ||
            posterStats.reason === 'already_ran_today' ||
            posterStats.reason === 'lock_held' ||
            posterStats.reason === 'disabled' ||
            posterStats.reason === 'no_credentials')
        ) {
          // quiet
        } else if (posterStats?.sent > 0 || (posterStats && !posterStats.skipped)) {
          console.log(
            `[daily-poster] ${source}: sent=${posterStats.sent || 0} rubric=${posterStats.rubric || '?'}${posterStats?.reason ? ` reason=${posterStats.reason}` : ''}`,
          );
        }
      } catch (posterErr) {
        console.warn('[daily-poster] tick failed:', posterErr?.message || posterErr);
      }
    } catch (e) {
      console.warn('[report-digest] tick failed:', e?.message || e);
    }
  }

  function start() {
    if (!enabled) return;
    startupTimer = setTimeout(() => void tick('startup'), 55_000);
    timer = setInterval(() => void tick('interval'), intervalMs);
  }

  function stop() {
    if (startupTimer) clearTimeout(startupTimer);
    if (timer) clearInterval(timer);
    startupTimer = null;
    timer = null;
  }

  return { start, stop, tick };
}

module.exports = { createReportDigestScheduler };
